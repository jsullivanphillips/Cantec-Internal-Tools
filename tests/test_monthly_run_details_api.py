"""Office GET ``/api/monthly_routes/routes/:id/run_details``."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import (
    Key,
    MonitoringCompany,
    MonthlyRoute,
    MonthlyRouteComment,
    MonthlyRouteLocation,
    MonthlyRouteLocationComment,
    MonthlyRouteRun,
    MonthlyRouteTestHistory,
    MonthlyRouteWorksheetAuditEvent,
    MonthlySite,
    MonthlyStopClockEvent,
    MonthlyTestingSite,
    MonthlyTestingSiteDeficiency,
    MonthlyTestingSiteMonth,
    db,
)
from app.monthly.monthly_sites_sync import sync_testing_sites_from_legacy

PACIFIC_TZ = ZoneInfo("America/Vancouver")


@pytest.fixture
def run_details_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    tables = [
        Key.__table__,
        MonitoringCompany.__table__,
        MonthlyRoute.__table__,
        MonthlyRouteComment.__table__,
        MonthlyRouteLocation.__table__,
        MonthlyRouteLocationComment.__table__,
        MonthlyRouteRun.__table__,
        MonthlyRouteTestHistory.__table__,
        MonthlyRouteWorksheetAuditEvent.__table__,
        MonthlySite.__table__,
        MonthlyTestingSite.__table__,
        MonthlyTestingSiteMonth.__table__,
        MonthlyStopClockEvent.__table__,
        MonthlyTestingSiteDeficiency.__table__,
    ]

    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["username"] = "staff.one"
                sess["authenticated"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


def _seed_basic_route_data():
    route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
    loc = MonthlyRouteLocation(
        id=101,
        address="123 Test St",
        address_normalized="123 test st",
        property_management_company="Acme",
        property_management_company_normalized="acme",
        building=None,
        building_normalized="",
        status_normalized="active",
        status_raw="Active",
        monthly_route_id=1,
        annual_month="May",
    )
    hist = MonthlyRouteTestHistory(
        id=5001,
        location_id=101,
        month_date=date(2026, 5, 1),
        result_status="tested",
        test_monthly_route_id=1,
    )
    run = MonthlyRouteRun(
        id=9001,
        monthly_route_id=1,
        month_date=date(2026, 5, 1),
        started_at=datetime(2026, 5, 2, 8, 0, tzinfo=PACIFIC_TZ),
        status="open",
        source="technician_app",
    )
    db.session.add_all([route, loc, hist, run])
    db.session.commit()
    return route, loc, hist, run


REVIEW_URL = "/api/monthly_routes/routes/1/run_details/review?month=2026-05-01"
BASE_URL = "/api/monthly_routes/routes/1/run_details?month=2026-05-01"


def _review_stop_for_location(client, location_id: int) -> dict:
    review = client.get(REVIEW_URL)
    assert review.status_code == 200
    stop = next(
        (s for s in review.get_json()["stops"] if int(s["location_id"]) == int(location_id)),
        None,
    )
    assert stop is not None
    return stop


def test_get_run_details_base_payload_shape(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()

    res = client.get(BASE_URL)
    assert res.status_code == 200
    body = res.get_json()
    assert "billing_locations" in body
    assert "review_meta" in body
    assert "locations" in body
    assert "review_summary" in body
    assert isinstance(body["locations"], list)
    assert body["review_summary"]["stop_count"] >= 1
    assert "notable_stops" not in body
    assert "field_changes_by_location" not in body


def test_run_details_locations_include_all_worksheet_stops(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        loc2 = MonthlyRouteLocation(
            id=102,
            address="456 Other Ave",
            address_normalized="456 other ave",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
        )
        db.session.add(loc2)
        db.session.commit()

    res = client.get(BASE_URL)
    assert res.status_code == 200
    locations = res.get_json()["locations"]
    loc_ids = {int(loc["location_id"]) for loc in locations}
    assert 101 in loc_ids
    assert 102 in loc_ids
    total_stops = sum(len(loc["stops"]) for loc in locations)
    assert total_stops == res.get_json()["review_summary"]["stop_count"]
    assert total_stops >= 2


def test_run_details_locations_multi_stop_single_entry(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        loc = db.session.get(MonthlyRouteLocation, 101)
        assert loc is not None
        sync_testing_sites_from_legacy(loc)
        site = MonthlySite.query.filter_by(legacy_monthly_route_location_id=101).one()
        db.session.add(
            MonthlyTestingSite(
                id=88002,
                monthly_site_id=int(site.id),
                sort_order=1,
                label="Annex panel",
                ring_detail="B",
            )
        )
        db.session.commit()

    res = client.get(BASE_URL)
    assert res.status_code == 200
    entry = next(loc for loc in res.get_json()["locations"] if int(loc["location_id"]) == 101)
    assert len(entry["stops"]) >= 2
    assert entry["first_stop_number"] <= entry["last_stop_number"]


def test_run_details_locations_deficiency_summaries(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        loc = db.session.get(MonthlyRouteLocation, 101)
        assert loc is not None
        sync_testing_sites_from_legacy(loc)
        ts_id = int(MonthlyTestingSite.query.one().id)
        db.session.add(
            MonthlyTestingSiteDeficiency(
                id=99001,
                monthly_testing_site_id=ts_id,
                created_run_id=9001,
                title="Bad battery",
                severity="deficient",
                status="new",
            )
        )
        db.session.commit()

    res = client.get(BASE_URL)
    assert res.status_code == 200
    entry = next(loc for loc in res.get_json()["locations"] if int(loc["location_id"]) == 101)
    stop = entry["stops"][0]
    assert stop["has_active_deficiencies"] is True
    assert len(stop["deficiency_summaries"]) == 1
    assert stop["deficiency_summaries"][0]["title"] == "Bad battery"
    assert entry["attention_flags"]["has_active_deficiencies"] is True


def test_run_details_worksheet_stop_for_site_modal(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        loc = db.session.get(MonthlyRouteLocation, 101)
        assert loc is not None
        sync_testing_sites_from_legacy(loc)
        ts_id = int(MonthlyTestingSite.query.one().id)

    res = client.get(f"/api/monthly_routes/routes/1/run_details/stops/{ts_id}?month=2026-05-01")
    assert res.status_code == 200
    stop = res.get_json()["stop"]
    assert int(stop["testing_site_id"]) == ts_id
    assert stop["display_address"]
    assert "clock_events" in stop
    assert "deficiencies" in stop
    assert "panel" in stop


def test_get_run_details_counts_and_run_header(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        loc2 = MonthlyRouteLocation(
            id=102,
            address="456 Other Ave",
            address_normalized="456 other ave",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
        )
        db.session.add(loc2)
        db.session.add(
            MonthlyRouteTestHistory(
                id=5002,
                location_id=102,
                month_date=date(2026, 5, 1),
                result_status="skipped",
                skip_reason="gate locked",
                test_monthly_route_id=1,
            )
        )
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/1/run_details?month=2026-05-01")
    assert res.status_code == 200
    body = res.get_json()
    assert body["route"]["id"] == 1
    assert body["month_date"] == "2026-05-01"
    assert body["run"]["id"] == 9001
    assert body["counts"]["all_good_count"] == 1
    assert body["counts"]["skipped_count"] == 1
    assert body["counts"]["passed_with_problems_count"] == 0
    assert body["counts"]["failed_count"] == 0
    assert body["review_meta"]["stop_count"] >= 1
    review = client.get(REVIEW_URL)
    assert review.status_code == 200
    notable = review.get_json()["stops"]
    assert any(int(s["location_id"]) == 102 for s in notable)


def test_run_details_counts_ignore_cleared_history_rows(run_details_client):
    """Rows with NULL ``result_status`` after reset must not inflate tested KPIs."""
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        cleared = db.session.get(MonthlyRouteTestHistory, 5001)
        assert cleared is not None
        cleared.result_status = None
        cleared.source_value_raw = None
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/1/run_details?month=2026-05-01")
    assert res.status_code == 200
    assert res.get_json()["counts"]["all_good_count"] == 0


def test_run_details_review_includes_tested_stop_without_property_edits(run_details_client):
    """Tested stops with no audit edits appear in run review (minimal card on UI)."""
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        hist = db.session.get(MonthlyRouteTestHistory, 5001)
        assert hist is not None
        assert (hist.result_status or "").strip().lower() == "tested"

    res = client.get(REVIEW_URL)
    assert res.status_code == 200
    notable = res.get_json()["stops"]
    assert len(notable) == 1
    assert notable[0]["location_id"] == 101
    assert (notable[0].get("result_status") or "").strip().lower() == "tested"


def test_run_details_notable_stops_includes_annual_month_without_technician_action(
    run_details_client,
):
    """Annual-month sites appear in run review even with no skip/test outcome recorded."""
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        loc_annual = MonthlyRouteLocation(
            id=103,
            address="789 Annual Ln",
            address_normalized="789 annual ln",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            annual_month="May",
        )
        db.session.add(loc_annual)
        db.session.commit()
        sync_testing_sites_from_legacy(loc_annual)

    res = client.get(BASE_URL)
    assert res.status_code == 200
    body = res.get_json()
    review = client.get(REVIEW_URL)
    assert review.status_code == 200
    notable = review.get_json()["stops"]
    annual_stop = next((s for s in notable if int(s["location_id"]) == 103), None)
    assert annual_stop is not None
    assert annual_stop.get("annual_month") == "May"
    assert not (annual_stop.get("result_status") or "").strip()
    assert body["counts"]["skipped_count"] == 0
    assert body["counts"]["all_good_count"] == 1


def test_run_details_counts_annual_month_site_not_when_tested(run_details_client):
    """Tested outcome wins over annual month on the same site."""
    client, app = run_details_client
    with app.app_context():
        route, loc, hist, _run = _seed_basic_route_data()
        assert loc.annual_month == "May"
        assert (hist.result_status or "").strip().lower() == "tested"
        loc_annual_only = MonthlyRouteLocation(
            id=104,
            address="100 Annual Only",
            address_normalized="100 annual only",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=route.id,
            annual_month="May",
        )
        db.session.add(loc_annual_only)
        db.session.commit()
        sync_testing_sites_from_legacy(loc_annual_only)

    res = client.get("/api/monthly_routes/routes/1/run_details?month=2026-05-01")
    assert res.status_code == 200
    counts = res.get_json()["counts"]
    assert counts["all_good_count"] == 1
    assert counts["skipped_count"] == 0


def test_run_details_notable_stops_includes_run_comments_only(run_details_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        loc = db.session.get(MonthlyRouteLocation, 101)
        assert loc is not None
        sync_testing_sites_from_legacy(loc)
        ts_id = int(MonthlyTestingSite.query.one().id)
        db.session.add(
            MonthlyTestingSiteMonth(
                id=92001,
                monthly_testing_site_id=ts_id,
                month_date=date(2026, 5, 1),
                test_monthly_route_id=1,
                run_comments="Found bad battery",
            )
        )
        db.session.commit()

    res = client.get(BASE_URL)
    assert res.status_code == 200
    body = res.get_json()
    assert "notable_stops" not in body
    review = client.get(REVIEW_URL)
    assert review.status_code == 200
    notable = review.get_json()["stops"]
    assert len(notable) == 1
    assert notable[0]["location_id"] == 101
    assert notable[0]["run_comments"] == "Found bad battery"


def test_get_run_details_field_changes_after_patch(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _, _, hist, _ = _seed_basic_route_data()
        expected = hist.updated_at.isoformat() if hist.updated_at else None

    patch_res = client.patch(
        "/api/monthly_routes/routes/1/worksheet/rows/101?month=2026-05-01",
        json={
            "expected_updated_at": expected,
            "client_mutation_id": "mut-run-details-1",
            "changes": {"testing_procedures": "TURN OFF BREAKER", "time_in": "9:48"},
        },
    )
    assert patch_res.status_code == 200

    stop = _review_stop_for_location(client, 101)
    ts_id = int(stop["testing_site_id"])
    detail = client.get(
        f"/api/monthly_routes/routes/1/run_details/review/stops/{ts_id}?month=2026-05-01"
    )
    assert detail.status_code == 200
    changes = detail.get_json()["changes"]
    labels = {c["label"] for c in changes}
    assert "Testing procedures" in labels
    assert not any(c["label"] == "Time In" for c in changes)
    review = client.get(REVIEW_URL)
    assert review.status_code == 200
    notable = review.get_json()["stops"]
    assert len(notable) >= 1
    assert any(s["location_id"] == 101 for s in notable)


def test_run_details_field_changes_omits_test_workflow_only(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _, _, hist, _ = _seed_basic_route_data()
        for idx, field_name in enumerate(("time_in", "time_out", "result_status"), start=1):
            db.session.add(
                MonthlyRouteWorksheetAuditEvent(
                    id=idx,
                    monthly_route_id=1,
                    location_id=101,
                    history_row_id=int(hist.id),
                    month_date=date(2026, 5, 1),
                    field_name=field_name,
                    old_value=None,
                    new_value="tested" if field_name == "result_status" else "9:00",
                    source="technician_app",
                )
            )
        db.session.commit()

    review = client.get(REVIEW_URL)
    assert review.status_code == 200
    notable = review.get_json()["stops"]
    assert len(notable) == 1
    assert notable[0]["location_id"] == 101
    assert (notable[0].get("result_status") or "").strip().lower() == "tested"
    stop = notable[0]
    detail = client.get(
        f"/api/monthly_routes/routes/1/run_details/review/stops/{stop['testing_site_id']}?month=2026-05-01"
    )
    assert detail.status_code == 200
    assert detail.get_json()["changes"] == []


def test_run_details_field_changes_omits_reset_run_audit(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _, _, hist, _ = _seed_basic_route_data()
        db.session.add(
            MonthlyRouteWorksheetAuditEvent(
                id=1,
                monthly_route_id=1,
                location_id=101,
                history_row_id=int(hist.id),
                month_date=date(2026, 5, 1),
                field_name="reset_run",
                old_value={
                    "result_status": "tested",
                    "time_in": "9:00",
                    "time_out": "10:00",
                },
                new_value=None,
                source="technician_app",
            )
        )
        db.session.commit()

    review = client.get(REVIEW_URL)
    assert review.status_code == 200
    stop = _review_stop_for_location(client, 101)
    detail = client.get(
        f"/api/monthly_routes/routes/1/run_details/review/stops/{stop['testing_site_id']}?month=2026-05-01"
    )
    assert detail.status_code == 200
    assert detail.get_json()["changes"] == []


def test_run_details_field_changes_omits_stop_reset_audit(run_details_client):
    """Per-stop portal reset (``stop_reset`` audit) must not count as a field update."""
    client, app = run_details_client
    with app.app_context():
        _, _, hist, _ = _seed_basic_route_data()
        db.session.add(
            MonthlyRouteWorksheetAuditEvent(
                id=2,
                monthly_route_id=1,
                location_id=101,
                history_row_id=int(hist.id),
                month_date=date(2026, 5, 1),
                field_name="stop_reset",
                old_value=None,
                new_value={"testing_site_id": 1},
                source="technician_app",
            )
        )
        db.session.commit()

    base = client.get(BASE_URL)
    assert base.status_code == 200
    loc = next(
        (row for row in base.get_json()["locations"] if int(row["location_id"]) == 101),
        None,
    )
    assert loc is not None
    assert loc["attention_flags"]["has_field_edits"] is False
    assert loc["stops"][0]["has_field_edits"] is False

    review = client.get(REVIEW_URL)
    assert review.status_code == 200
    stop = _review_stop_for_location(client, 101)
    detail = client.get(
        f"/api/monthly_routes/routes/1/run_details/review/stops/{stop['testing_site_id']}?month=2026-05-01"
    )
    assert detail.status_code == 200
    assert detail.get_json()["changes"] == []


def test_run_details_field_changes_lists_all_distinct_fields_per_location(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _, _, hist, _ = _seed_basic_route_data()
        db.session.add(
            MonthlyRouteWorksheetAuditEvent(
                id=10,
                monthly_route_id=1,
                location_id=101,
                history_row_id=int(hist.id),
                month_date=date(2026, 5, 1),
                field_name="ring",
                old_value="A",
                new_value="B",
                source="technician_app",
            )
        )
        db.session.add(
            MonthlyRouteWorksheetAuditEvent(
                id=11,
                monthly_route_id=1,
                location_id=101,
                history_row_id=int(hist.id),
                month_date=date(2026, 5, 1),
                field_name="door_code",
                old_value="1",
                new_value="2",
                source="technician_app",
            )
        )
        db.session.add(
            MonthlyRouteWorksheetAuditEvent(
                id=12,
                monthly_route_id=1,
                location_id=101,
                history_row_id=int(hist.id),
                month_date=date(2026, 5, 1),
                field_name="annual_month",
                old_value="May",
                new_value="June",
                source="technician_app",
            )
        )
        db.session.commit()

    stop = _review_stop_for_location(client, 101)
    detail = client.get(
        f"/api/monthly_routes/routes/1/run_details/review/stops/{stop['testing_site_id']}?month=2026-05-01"
    )
    assert detail.status_code == 200
    labels = {c["label"] for c in detail.get_json()["changes"]}
    assert labels == {"Ring", "Door code", "Annual"}


def test_run_details_field_changes_groups_two_locations(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _, _, hist1, _ = _seed_basic_route_data()
        loc2 = MonthlyRouteLocation(
            id=102,
            address="456 Other Ave",
            address_normalized="456 other ave",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
        )
        hist2 = MonthlyRouteTestHistory(
            id=5002,
            location_id=102,
            month_date=date(2026, 5, 1),
            result_status="tested",
            test_monthly_route_id=1,
        )
        db.session.add_all([loc2, hist2])
        db.session.commit()
        expected1 = hist1.updated_at.isoformat() if hist1.updated_at else None
        expected2 = hist2.updated_at.isoformat() if hist2.updated_at else None

    assert (
        client.patch(
            "/api/monthly_routes/routes/1/worksheet/rows/101?month=2026-05-01",
            json={
                "expected_updated_at": expected1,
                "client_mutation_id": "mut-run-details-loc1",
                "changes": {"testing_procedures": "PROC A"},
            },
        ).status_code
        == 200
    )
    assert (
        client.patch(
            "/api/monthly_routes/routes/1/worksheet/rows/102?month=2026-05-01",
            json={
                "expected_updated_at": expected2,
                "client_mutation_id": "mut-run-details-loc2",
                "changes": {"ring": "RING-9"},
            },
        ).status_code
        == 200
    )

    stop1 = _review_stop_for_location(client, 101)
    stop2 = _review_stop_for_location(client, 102)
    detail1 = client.get(
        f"/api/monthly_routes/routes/1/run_details/review/stops/{stop1['testing_site_id']}?month=2026-05-01"
    )
    detail2 = client.get(
        f"/api/monthly_routes/routes/1/run_details/review/stops/{stop2['testing_site_id']}?month=2026-05-01"
    )
    assert detail1.status_code == 200
    assert detail2.status_code == 200
    labels1 = {c["label"] for c in detail1.get_json()["changes"]}
    labels2 = {c["label"] for c in detail2.get_json()["changes"]}
    assert labels1 == {"Testing procedures"}
    assert labels2 == {"Ring"}


def test_get_run_details_route_not_found(run_details_client):
    client, _app = run_details_client
    res = client.get("/api/monthly_routes/routes/999/run_details?month=2026-05-01")
    assert res.status_code == 404


def test_get_run_details_ledger_only_without_run_file(run_details_client):
    """Master-sheet history without ``MonthlyRouteRun`` still opens run details (legacy sheet)."""
    from app.monthly.monthly_sites_sync import sync_testing_sites_from_legacy

    client, app = run_details_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc = MonthlyRouteLocation(
            id=101,
            address="123 Test St",
            address_normalized="123 test st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            route_stop_order=1,
        )
        hist = MonthlyRouteTestHistory(
            id=5001,
            location_id=101,
            month_date=date(2026, 5, 1),
            result_status="tested",
            test_monthly_route_id=1,
        )
        db.session.add_all([route, loc, hist])
        db.session.commit()
        sync_testing_sites_from_legacy(loc)

    res = client.get("/api/monthly_routes/routes/1/run_details?month=2026-05-01")
    assert res.status_code == 200
    body = res.get_json()
    assert body["run"] is None
    assert body["month_date"] == "2026-05-01"

    from app.routes.monthly_routes import _runs_by_month_for_route

    with app.app_context():
        assert _runs_by_month_for_route(1).get("2026-05-01") is None


def test_get_run_details_draft_future_month_without_run_file(run_details_client):
    """Office may open run details for a future month before any run file exists."""
    from app.monthly.monthly_sites_sync import sync_testing_sites_from_legacy

    client, app = run_details_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc = MonthlyRouteLocation(
            id=101,
            address="123 Test St",
            address_normalized="123 test st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            route_stop_order=1,
        )
        db.session.add_all([route, loc])
        db.session.commit()
        sync_testing_sites_from_legacy(loc)

    res = client.get("/api/monthly_routes/routes/1/run_details?month=2026-06-01")
    assert res.status_code == 200
    body = res.get_json()
    assert body["run"] is None
    assert body["month_date"] == "2026-06-01"
    assert len(body.get("locations") or []) >= 1


def test_run_details_prep_fields_on_location_stops(run_details_client):
    """Prep-phase stop payload includes access and monitoring fields from library master."""
    client, app = run_details_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc = MonthlyRouteLocation(
            id=101,
            address="123 Test St",
            address_normalized="123 test st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            route_stop_order=1,
            keys="K-42",
            ring_detail="Ring B",
            annual_month="June",
        )
        run = MonthlyRouteRun(
            id=9002,
            monthly_route_id=1,
            month_date=date(2026, 6, 1),
            status="open",
            source="office_manual",
            prepared_at=datetime(2026, 5, 28, 9, 0, tzinfo=PACIFIC_TZ),
        )
        db.session.add_all([route, loc, run])
        db.session.commit()
        sync_testing_sites_from_legacy(loc)
        ts = MonthlyTestingSite.query.one()
        ts.door_code = "4821#"
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/1/run_details?month=2026-06-01")
    assert res.status_code == 200
    stops = res.get_json()["locations"][0]["stops"]
    assert len(stops) >= 1
    stop = stops[0]
    assert stop.get("key_number") == "K-42"
    assert stop.get("ring") == "Ring B"
    assert stop.get("door_code") == "4821#"
    assert stop.get("annual_month") == "June"


def test_office_prep_patch_materializes_stop_and_saves_key(run_details_client):
    """Office PATCH during prep phase creates MTSM rows and persists field edits."""
    client, app = run_details_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc = MonthlyRouteLocation(
            id=101,
            address="123 Test St",
            address_normalized="123 test st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            route_stop_order=1,
            keys="OLD-KEY",
        )
        run = MonthlyRouteRun(
            id=9003,
            monthly_route_id=1,
            month_date=date(2026, 6, 1),
            status="open",
            source="office_manual",
            prepared_at=datetime(2026, 5, 28, 9, 0, tzinfo=PACIFIC_TZ),
        )
        db.session.add_all([route, loc, run])
        db.session.commit()
        ts_rows = sync_testing_sites_from_legacy(loc)
        ts_id = int(ts_rows[0].id)

    res = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/stops/{ts_id}?month=2026-06-01",
        json={"changes": {"key_number": "NEW-KEY"}},
    )
    assert res.status_code == 200
    assert res.get_json().get("ok") is True

    with app.app_context():
        mtsm = MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=ts_id,
            month_date=date(2026, 6, 1),
        ).one()
        assert (mtsm.key_number or "").strip() == "NEW-KEY"

    details = client.get("/api/monthly_routes/routes/1/run_details?month=2026-06-01")
    stop = details.get_json()["locations"][0]["stops"][0]
    assert stop.get("key_number") == "NEW-KEY"


def test_run_details_prep_fields_fallback_when_empty_mtsm_snapshot(run_details_client):
    """Empty MTSM snapshot rows still show library master on run details (prep phase)."""
    client, app = run_details_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc = MonthlyRouteLocation(
            id=101,
            address="123 Test St",
            address_normalized="123 test st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            route_stop_order=1,
            keys="MA 5611 K2",
            ring_detail="Ring B",
            annual_month="June",
            inspection_tech_notes="Site notes from library",
        )
        run = MonthlyRouteRun(
            id=9004,
            monthly_route_id=1,
            month_date=date(2026, 6, 1),
            status="open",
            source="office_manual",
            prepared_at=datetime(2026, 5, 28, 9, 0, tzinfo=PACIFIC_TZ),
        )
        db.session.add_all([route, loc, run])
        db.session.commit()
        ts_rows = sync_testing_sites_from_legacy(loc)
        ts_id = int(ts_rows[0].id)
        ts = MonthlyTestingSite.query.get(ts_id)
        assert ts is not None
        ts.annual_month = "June"
        ts.keys = "MA 5611 K2"
        ts.ring_detail = "Ring B"
        ts.inspection_tech_notes = "Site notes from library"
        db.session.add(
            MonthlyTestingSiteMonth(
                id=91050,
                monthly_testing_site_id=ts_id,
                month_date=date(2026, 6, 1),
                test_monthly_route_id=1,
                run_id=9004,
            )
        )
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/1/run_details?month=2026-06-01")
    assert res.status_code == 200
    stop = res.get_json()["locations"][0]["stops"][0]
    assert stop.get("key_number") == "MA 5611 K2"
    assert stop.get("ring") == "Ring B"
    assert stop.get("annual_month") == "June"
    assert stop.get("inspection_tech_notes") == "Site notes from library"


def test_library_month_cell_no_worksheet_link_without_run_file(run_details_client):
    """Ledger-only history must not expose worksheet links on the location detail API."""
    client, app = run_details_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc = MonthlyRouteLocation(
            id=101,
            address="123 Test St",
            address_normalized="123 test st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
        )
        hist = MonthlyRouteTestHistory(
            id=5001,
            location_id=101,
            month_date=date(2026, 5, 1),
            result_status="tested",
            test_monthly_route_id=1,
        )
        db.session.add_all([route, loc, hist])
        db.session.commit()

    res = client.get("/api/monthly_routes/library/101")
    assert res.status_code == 200
    cell = res.get_json()["location"]["months"]["2026-05-01"]
    assert cell.get("worksheet_route_id") is None
    assert cell.get("run_id") is None


def test_complete_job_then_worksheet_matches_run_details(run_details_client, monkeypatch):
    """Office worksheet GET must reflect ``POST …/runs/complete`` the same as run_details."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        loc = db.session.get(MonthlyRouteLocation, 101)
        assert loc is not None
        sync_testing_sites_from_legacy(loc)
        run = MonthlyRouteRun.query.filter_by(monthly_route_id=1, month_date=date(2026, 5, 1)).one()
        now = datetime.now(PACIFIC_TZ)
        run.prepared_at = now
        run.field_ended_at = now
        run.office_review_completed_at = now
        db.session.commit()

    complete = client.post(
        "/api/monthly_routes/routes/1/runs/complete",
        json={"month_date": "2026-05-01"},
    )
    assert complete.status_code == 200
    completed_run = complete.get_json()["run"]
    assert completed_run["status"] == "completed"
    assert completed_run["completed_at"] is not None
    assert completed_run["workflow_stage"] == "completed"
    assert completed_run["is_historical"] is True

    details = client.get("/api/monthly_routes/routes/1/run_details?month=2026-05-01")
    assert details.status_code == 200
    assert details.get_json()["run"]["status"] == "completed"

    worksheet = client.get(
        "/api/monthly_routes/routes/1/worksheet?month=2026-05-01&include_stops=1"
    )
    assert worksheet.status_code == 200
    ws_run = worksheet.get_json()["run"]
    assert ws_run is not None
    assert ws_run["status"] == "completed"
    assert ws_run["completed_at"] is not None
    assert ws_run["is_historical"] is True


def test_patch_location_billing_status_office_override(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        run = db.session.get(MonthlyRouteRun, 9001)
        assert run is not None
        run.field_ended_at = datetime(2026, 5, 2, 17, 0, tzinfo=PACIFIC_TZ)
        db.session.commit()

    res = client.patch(
        "/api/monthly_routes/routes/1/locations/101/billing_status?month=2026-05-01",
        json={"billing_status": "do_not_bill"},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["ok"] is True
    assert body["location_id"] == 101
    assert body["billing_status"] == "do_not_bill"

    with app.app_context():
        hist = db.session.get(MonthlyRouteTestHistory, 5001)
        assert hist is not None
        assert hist.billing_status == "do_not_bill"


def test_patch_location_billing_status_before_field_end(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()

    res = client.patch(
        "/api/monthly_routes/routes/1/locations/101/billing_status?month=2026-05-01",
        json={"billing_status": "do_not_bill"},
    )
    assert res.status_code == 409
    assert res.get_json()["code"] == "billing_before_field_end"


def test_patch_location_billing_status_legacy_locked(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        hist = db.session.get(MonthlyRouteTestHistory, 5001)
        assert hist is not None
        hist.billing_status = "legacy"
        db.session.commit()

    res = client.patch(
        "/api/monthly_routes/routes/1/locations/101/billing_status?month=2026-05-01",
        json={"billing_status": "bill"},
    )
    assert res.status_code == 400
    assert res.get_json()["code"] == "billing_legacy_locked"


def test_patch_location_billing_status_invalid(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()

    res = client.patch(
        "/api/monthly_routes/routes/1/locations/101/billing_status?month=2026-05-01",
        json={"billing_status": "legacy"},
    )
    assert res.status_code == 400
    assert res.get_json()["code"] == "billing_legacy_locked"
