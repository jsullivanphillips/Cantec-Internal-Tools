"""Office GET ``/api/monthly_routes/routes/:id/run_details``."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app.db_models import (
    Key,
    MonitoringCompany,
    MonthlyLocation,
    MonthlyLocationComment,
    MonthlyLocationDeficiency,
    MonthlyLocationMonth,
    MonthlyRoute,
    MonthlyRouteComment,
    MonthlyRouteRun,
    MonthlyRouteRunTimingMonth,
    MonthlyRouteWorksheetAuditEvent,
    MonthlyStopClockEvent,
    db
)
from tests.monthly_location_helpers import (
    WORKSHEET_TABLES,
    make_location,
    make_location_month,
    seed_route_with_one_stop,
    seed_route_with_two_stops
)

from app import create_app
from app.monthly.service_trade_route_run_timing import SYNC_STATUS_OK

PACIFIC_TZ = ZoneInfo("America/Vancouver")


@pytest.fixture
def run_details_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    tables = WORKSHEET_TABLES

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
    loc = make_location(
        id=101,
        address="123 Test St",
        label="123 Test St",
        property_management_company="Acme",
        property_management_company_normalized="acme",
        monthly_route_id=1,
        annual_month="May",
    )
    mlm = MonthlyLocationMonth(
        id=5001,
        monthly_location_id=101,
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
    db.session.add_all([route, loc, mlm, run])
    db.session.commit()
    return route, loc, mlm, run


REVIEW_URL = "/api/monthly_routes/routes/1/run_details/review?month=2026-05-01"
BASE_URL = "/api/monthly_routes/routes/1/run_details?month=2026-05-01"


def _review_stop_for_location(client, location_id: int) -> dict:
    review = client.get(REVIEW_URL)
    assert review.status_code == 200
    stop = next(
        (s for s in review.get_json()["stops"] if int(s["location_id"]) == int(location_id)),
        None
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
    assert "service_trade_run_job" in body
    assert body["service_trade_run_job"] == {
        "service_trade_job_id": None,
        "service_trade_job_url": None,
        "sync_status": None,
    }
    assert isinstance(body["locations"], list)
    assert body["review_summary"]["stop_count"] >= 1
    assert "notable_stops" not in body
    assert "field_changes_by_location" not in body


def test_get_run_details_includes_cached_service_trade_job(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        db.session.add(
            MonthlyRouteRunTimingMonth(
                id=77,
                monthly_route_id=1,
                month_first=date(2026, 5, 1),
                service_trade_job_id=88001,
                sync_status=SYNC_STATUS_OK,
            )
        )
        db.session.commit()

    res = client.get(BASE_URL)
    assert res.status_code == 200
    job = res.get_json()["service_trade_run_job"]
    assert job["service_trade_job_id"] == 88001
    assert job["service_trade_job_url"] == "https://app.servicetrade.com/job/88001"
    assert job["sync_status"] == SYNC_STATUS_OK


def test_route_detail_service_trade_run_jobs_by_month_helper(run_details_client):
    _, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        db.session.add(
            MonthlyRouteRunTimingMonth(
                id=78,
                monthly_route_id=1,
                month_first=date(2026, 5, 1),
                service_trade_job_id=88002,
                sync_status=SYNC_STATUS_OK,
            )
        )
        db.session.commit()

        from app.monthly.route_run_timing import service_trade_run_jobs_by_month_for_route

        by_month = service_trade_run_jobs_by_month_for_route(1)
        assert by_month["2026-05-01"]["service_trade_job_id"] == 88002
        assert by_month["2026-05-01"]["service_trade_job_url"] == "https://app.servicetrade.com/job/88002"


def test_run_details_locations_include_all_worksheet_stops(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        loc2 = make_location(
            id=102,
            address="456 Other Ave",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            monthly_route_id=1,
            route_stop_order=1,
        )
        db.session.add(
            MonthlyLocationMonth(
                id=5002,
                monthly_location_id=102,
                month_date=date(2026, 5, 1),
                test_monthly_route_id=1,
            )
        )
        db.session.add(loc2)
        db.session.commit()

    res = client.get(BASE_URL)
    assert res.status_code == 200
    locations = res.get_json()["locations"]
    loc_ids = {int(loc["location_id"]) for loc in locations}
    assert 101 in loc_ids
    assert 102 in loc_ids
    total_stops = len(locations)
    assert total_stops == res.get_json()["review_summary"]["stop_count"]
    assert total_stops >= 2


def test_run_details_locations_multi_stop_single_entry(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        loc_secondary = make_location(
            id=88002,
            address="123 Test St",
            label="Annex panel",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            monthly_route_id=1,
            route_stop_order=1,
            ring_detail="B",
        )
        db.session.add(loc_secondary)
        db.session.add(
            MonthlyLocationMonth(
                id=88003,
                monthly_location_id=88002,
                month_date=date(2026, 5, 1),
                test_monthly_route_id=1,
            )
        )
        db.session.commit()

    res = client.get(BASE_URL)
    assert res.status_code == 200
    locations = res.get_json()["locations"]
    loc_ids = {int(row["location_id"]) for row in locations}
    assert 101 in loc_ids
    assert 88002 in loc_ids
    assert len(locations) >= 2


def test_run_details_locations_include_panel_fields(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        loc = db.session.get(MonthlyLocation, 101)
        assert loc is not None
        loc.facp_detail = "Notifier NFS2"
        loc.panel_location = "Electrical room"
        mlm = db.session.get(MonthlyLocationMonth, 5001)
        assert mlm is not None
        mlm.panel = "Notifier NFS2"
        mlm.panel_location = "Electrical room"
        db.session.commit()

    res = client.get(BASE_URL)
    assert res.status_code == 200
    row = next(loc for loc in res.get_json()["locations"] if int(loc["location_id"]) == 101)
    assert row["panel"] == "Notifier NFS2"
    assert row["panel_location"] == "Electrical room"


def test_run_details_locations_deficiency_summaries(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        ts_id = 101
        mlm = db.session.get(MonthlyLocationMonth, 5001)
        assert mlm is not None
        mlm.test_outcome = "passed_with_problems"
        mlm.confirmed_no_deficiencies = True
        db.session.add(
            MonthlyLocationDeficiency(
                id=99001,
                monthly_location_id=ts_id,
                created_run_id=9001,
                title="Bad battery",
                severity="deficient",
                status="new",
                service_trade_deficiency_id=777001,
            )
        )
        db.session.commit()

    res = client.get(BASE_URL)
    assert res.status_code == 200
    entry = next(loc for loc in res.get_json()["locations"] if int(loc["location_id"]) == 101)
    stop = entry
    assert stop["has_active_deficiencies"] is True
    assert len(stop["deficiency_summaries"]) == 1
    assert stop["deficiency_summaries"][0]["title"] == "Bad battery"
    assert stop["deficiency_summaries"][0]["service_trade_deficiency_id"] == 777001
    assert stop["confirmed_no_deficiencies"] is False
    assert entry["attention_flags"]["has_active_deficiencies"] is True


def test_run_details_deficiency_summaries_scoped_to_field_run(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        ts_id = 101
        mlm = db.session.get(MonthlyLocationMonth, 5001)
        assert mlm is not None
        mlm.test_outcome = "passed_with_problems"
        db.session.add(
            MonthlyLocationDeficiency(
                id=99001,
                monthly_location_id=ts_id,
                created_run_id=9001,
                title="Reported this run",
                severity="deficient",
                status="new"
            )
        )
        db.session.add(
            MonthlyLocationDeficiency(
                id=99002,
                monthly_location_id=ts_id,
                created_run_id=8000,
                title="Carry-over new",
                severity="deficient",
                status="new"
)
        )
        db.session.add(
            MonthlyLocationDeficiency(
                id=99003,
                monthly_location_id=ts_id,
                created_run_id=8000,
                title="Verified on visit",
                severity="deficient",
                status="verified",
                updated_at=datetime(2026, 5, 2, 10, 0, tzinfo=PACIFIC_TZ)
)
        )
        db.session.add(
            MonthlyLocationDeficiency(
                id=99004,
                monthly_location_id=ts_id,
                created_run_id=8000,
                title="Verified before run",
                severity="deficient",
                status="verified",
                updated_at=datetime(2026, 5, 1, 10, 0, tzinfo=PACIFIC_TZ)
)
        )
        db.session.commit()

    res = client.get(BASE_URL)
    assert res.status_code == 200
    stop = next(
        loc
        for loc in res.get_json()["locations"]
        if int(loc["location_id"]) == 101
    )
    titles = {row["title"] for row in stop["deficiency_summaries"]}
    assert titles == {"Reported this run", "Verified on visit"}
    assert stop["has_active_deficiencies"] is True
    assert res.get_json()["locations"][0]["attention_flags"]["needs_attention"] is True


def test_run_details_new_comment_fields_on_stop(run_details_client):
    """Office review flags newly added comment fields for red highlight."""
    client, app = run_details_client
    with app.app_context():
        _, _, mlm, run = _seed_basic_route_data()
        field_time = datetime(2026, 5, 2, 10, 0, tzinfo=PACIFIC_TZ)
        mlm.run_comments = "Technician noted smoke smell"
        mlm.testing_procedures = "Check panel"
        db.session.add(
            MonthlyRouteWorksheetAuditEvent(
                id=88001,
                monthly_route_id=1,
                location_id=101,
                location_month_row_id=int(mlm.id),
                month_date=date(2026, 5, 1),
                field_name="testing_procedures",
                old_value="",
                new_value="Check panel",
                source="technician_app",
                changed_at=field_time
)
        )
        db.session.add(
            MonthlyRouteWorksheetAuditEvent(
                id=88002,
                monthly_route_id=1,
                location_id=101,
                location_month_row_id=int(mlm.id),
                month_date=date(2026, 5, 1),
                field_name="inspection_tech_notes",
                old_value="Old office note",
                new_value="",
                source="technician_app",
                changed_at=field_time
)
        )
        db.session.commit()
        assert run.started_at is not None

    res = client.get(BASE_URL)
    assert res.status_code == 200
    stop = next(
        loc
        for loc in res.get_json()["locations"]
        if int(loc["location_id"]) == 101
    )
    assert "run_comments" in stop["new_comment_fields"]
    assert "testing_procedures" in stop["new_comment_fields"]
    assert "inspection_tech_notes" not in stop["new_comment_fields"]


def test_run_details_field_changes_on_location(run_details_client):
    """Run review locations include per-field audit deltas for red highlighting."""
    client, app = run_details_client
    with app.app_context():
        _, _, mlm, run = _seed_basic_route_data()
        field_time = datetime(2026, 5, 2, 10, 0, tzinfo=PACIFIC_TZ)
        mlm.key_number = "NEW-KEY"
        db.session.add(
            MonthlyRouteWorksheetAuditEvent(
                id=88010,
                monthly_route_id=1,
                location_id=101,
                location_month_row_id=int(mlm.id),
                month_date=date(2026, 5, 1),
                field_name="key_number",
                old_value="OLD-KEY",
                new_value="NEW-KEY",
                source="technician_app",
                changed_at=field_time,
            )
        )
        db.session.commit()
        assert run.started_at is not None

    res = client.get(BASE_URL)
    assert res.status_code == 200
    stop = next(
        loc
        for loc in res.get_json()["locations"]
        if int(loc["location_id"]) == 101
    )
    assert stop["key_number"] == "NEW-KEY"
    key_changes = [c for c in stop["field_changes"] if c["field_name"] == "key_number"]
    assert len(key_changes) == 1
    assert key_changes[0]["old_value"] == "OLD-KEY"
    assert key_changes[0]["new_value"] == "NEW-KEY"


def test_run_details_worksheet_stop_for_site_modal(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        loc = db.session.get(MonthlyLocation, 101)
        assert loc is not None
        ts_id = 101

    res = client.get(f"/api/monthly_routes/routes/1/run_details/locations/{ts_id}?month=2026-05-01")
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
        loc2 = make_location(
            id=102,
            address="456 Other Ave",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            monthly_route_id=1,
            route_stop_order=1,
        )
        db.session.add(loc2)
        db.session.add(
            MonthlyLocationMonth(
                id=5002,
                monthly_location_id=102,
                month_date=date(2026, 5, 1),
                result_status="skipped",
                skip_reason="gate locked",
                test_monthly_route_id=1
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
        cleared = db.session.get(MonthlyLocationMonth, 5001)
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
        mlm = db.session.get(MonthlyLocationMonth, 5001)
        assert mlm is not None
        assert (mlm.result_status or "").strip().lower() == "tested"

    res = client.get(REVIEW_URL)
    assert res.status_code == 200
    notable = res.get_json()["stops"]
    assert len(notable) == 1
    assert notable[0]["location_id"] == 101
    assert (notable[0].get("result_status") or "").strip().lower() == "tested"


def test_run_details_notable_stops_includes_annual_month_without_technician_action(
    run_details_client
):
    """Annual-month sites appear in run review even with no skip/test outcome recorded."""
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        loc_annual = make_location(
            id=103,
            address="789 Annual Ln",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            monthly_route_id=1,
            annual_month="May",
        )
        db.session.add(loc_annual)
        db.session.add(
            MonthlyLocationMonth(
                id=92004,
                monthly_location_id=103,
                month_date=date(2026, 5, 1),
                test_monthly_route_id=1,
            )
        )
        db.session.commit()

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
    assert body["counts"]["skipped_count"] == 1
    assert body["counts"]["all_good_count"] == 1


def test_run_details_counts_annual_month_site_not_when_tested(run_details_client):
    """Tested outcome wins over annual month on the same site."""
    client, app = run_details_client
    with app.app_context():
        route, loc, mlm, _run = _seed_basic_route_data()
        assert loc.annual_month == "May"
        assert (mlm.result_status or "").strip().lower() == "tested"
        loc_annual_only = MonthlyLocation(
            id=104,
            address="100 Annual Only",
            address_normalized="100 annual only",
            property_management_company="Acme",
            property_management_company_normalized="acme",
        label="100 Annual Only",
        label_normalized="100 annual only",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=route.id,
            annual_month="May"
)
        db.session.add(loc_annual_only)
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/1/run_details?month=2026-05-01")
    assert res.status_code == 200
    counts = res.get_json()["counts"]
    assert counts["all_good_count"] == 1
    assert counts["skipped_count"] == 0


def test_run_details_skipped_count_includes_annual_and_legacy_skips(run_details_client):
    """Skipped KPI matches run-review filter (portal, legacy, and annual-month sites)."""
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        loc_annual = make_location(
            id=103,
            address="789 Annual Ln",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            monthly_route_id=1,
            annual_month="May",
        )
        loc_other = make_location(
            id=104,
            address="456 Other Ave",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            monthly_route_id=1,
            route_stop_order=1,
        )
        db.session.add_all([loc_annual, loc_other])
        db.session.add(
            MonthlyLocationMonth(
                id=92005,
                monthly_location_id=103,
                month_date=date(2026, 5, 1),
                test_monthly_route_id=1,
            )
        )
        db.session.add(
            MonthlyLocationMonth(
                id=92006,
                monthly_location_id=104,
                month_date=date(2026, 5, 1),
                test_monthly_route_id=1,
                result_status="skipped",
                skip_reason="other: no access",
                test_outcome="skipped",
                skip_category="other",
            )
        )
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/1/run_details?month=2026-05-01")
    assert res.status_code == 200
    counts = res.get_json()["counts"]
    assert counts["all_good_count"] == 1
    assert counts["skipped_count"] == 2


def test_run_details_notable_stops_includes_run_comments_only(run_details_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        mlm = db.session.get(MonthlyLocationMonth, 5001)
        assert mlm is not None
        mlm.run_comments = "Found bad battery"
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


def test_run_details_field_changes_omit_office_prep_audits(run_details_client):
    """Field-changes card shows only post-field-start technician deltas, not office prep."""
    client, app = run_details_client
    with app.app_context():
        _, _, mlm, run = _seed_basic_route_data()
        started = run.started_at
        assert started is not None
        prep_time = datetime(2026, 5, 1, 10, 0, tzinfo=PACIFIC_TZ)
        field_time = datetime(2026, 5, 2, 9, 0, tzinfo=PACIFIC_TZ)
        db.session.add_all(
            [
                MonthlyRouteWorksheetAuditEvent(
                    id=1,
                    monthly_route_id=1,
                    location_id=101,
                    location_month_row_id=int(mlm.id),
                    month_date=date(2026, 5, 1),
                    field_name="testing_procedures",
                    old_value="ok",
                    new_value=None,
                    source="office_manual",
                    changed_at=prep_time
),
                MonthlyRouteWorksheetAuditEvent(
                    id=2,
                    monthly_route_id=1,
                    location_id=101,
                    location_month_row_id=int(mlm.id),
                    month_date=date(2026, 5, 1),
                    field_name="office_attention",
                    old_value=False,
                    new_value=True,
                    source="technician_app",
                    changed_at=prep_time
),
                MonthlyRouteWorksheetAuditEvent(
                    id=3,
                    monthly_route_id=1,
                    location_id=101,
                    location_month_row_id=int(mlm.id),
                    month_date=date(2026, 5, 1),
                    field_name="inspection_tech_notes",
                    old_value="TEST COMMENT JSP",
                    new_value=None,
                    source="technician_app",
                    changed_at=prep_time
),
                MonthlyRouteWorksheetAuditEvent(
                    id=4,
                    monthly_route_id=1,
                    location_id=101,
                    location_month_row_id=int(mlm.id),
                    month_date=date(2026, 5, 1),
                    field_name="ring",
                    old_value="Ring A",
                    new_value="Ring B",
                    source="technician_app",
                    changed_at=field_time
),
            ]
        )
        db.session.commit()

    base = client.get(BASE_URL)
    assert base.status_code == 200
    stop = base.get_json()["locations"][0]
    assert stop.get("has_field_edits") is True
    detail = client.get(
        f"/api/monthly_routes/routes/1/run_details/review/locations/{stop['testing_site_id']}?month=2026-05-01"
    )
    assert detail.status_code == 200
    changes = detail.get_json()["changes"]
    labels = {c["label"] for c in changes}
    assert labels == {"Ring"}
    assert "Testing procedures" not in labels
    assert "Location comments" not in labels


def test_get_run_details_field_changes_after_patch(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _, _, mlm, _ = _seed_basic_route_data()
        expected = mlm.updated_at.isoformat() if mlm.updated_at else None

    patch_res = client.patch(
        "/api/monthly_routes/routes/1/worksheet/rows/101?month=2026-05-01",
        json={
            "expected_updated_at": expected,
            "client_mutation_id": "mut-run-details-1",
            "changes": {"testing_procedures": "TURN OFF BREAKER", "time_in": "9:48"},
        }
)
    assert patch_res.status_code == 200

    stop = _review_stop_for_location(client, 101)
    ts_id = int(stop["testing_site_id"])
    detail = client.get(
        f"/api/monthly_routes/routes/1/run_details/review/locations/{ts_id}?month=2026-05-01"
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
        _, _, mlm, _ = _seed_basic_route_data()
        for idx, field_name in enumerate(("time_in", "time_out", "result_status"), start=1):
            db.session.add(
                MonthlyRouteWorksheetAuditEvent(
                    id=idx,
                    monthly_route_id=1,
                    location_id=101,
                    location_month_row_id=int(mlm.id),
                    month_date=date(2026, 5, 1),
                    field_name=field_name,
                    old_value=None,
                    new_value="tested" if field_name == "result_status" else "9:00",
                    source="technician_app"
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
        f"/api/monthly_routes/routes/1/run_details/review/locations/{stop['testing_site_id']}?month=2026-05-01"
    )
    assert detail.status_code == 200
    assert detail.get_json()["changes"] == []


def test_run_details_field_changes_omits_reset_run_audit(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _, _, mlm, _ = _seed_basic_route_data()
        db.session.add(
            MonthlyRouteWorksheetAuditEvent(
                id=1,
                monthly_route_id=1,
                location_id=101,
                location_month_row_id=int(mlm.id),
                month_date=date(2026, 5, 1),
                field_name="reset_run",
                old_value={
                    "result_status": "tested",
                    "time_in": "9:00",
                    "time_out": "10:00",
                },
                new_value=None,
                source="technician_app"
)
        )
        db.session.commit()

    review = client.get(REVIEW_URL)
    assert review.status_code == 200
    stop = _review_stop_for_location(client, 101)
    detail = client.get(
        f"/api/monthly_routes/routes/1/run_details/review/locations/{stop['testing_site_id']}?month=2026-05-01"
    )
    assert detail.status_code == 200
    assert detail.get_json()["changes"] == []


def test_run_details_field_changes_omits_stop_reset_audit(run_details_client):
    """Per-stop portal reset (``stop_reset`` audit) must not count as a field update."""
    client, app = run_details_client
    with app.app_context():
        _, _, mlm, _ = _seed_basic_route_data()
        db.session.add(
            MonthlyRouteWorksheetAuditEvent(
                id=2,
                monthly_route_id=1,
                location_id=101,
                location_month_row_id=int(mlm.id),
                month_date=date(2026, 5, 1),
                field_name="stop_reset",
                old_value=None,
                new_value={"testing_site_id": 1},
                source="technician_app"
)
        )
        db.session.commit()

    base = client.get(BASE_URL)
    assert base.status_code == 200
    loc = next(
        (row for row in base.get_json()["locations"] if int(row["location_id"]) == 101),
        None
)
    assert loc is not None
    assert loc["attention_flags"]["has_field_edits"] is False
    assert loc["has_field_edits"] is False

    review = client.get(REVIEW_URL)
    assert review.status_code == 200
    stop = _review_stop_for_location(client, 101)
    detail = client.get(
        f"/api/monthly_routes/routes/1/run_details/review/locations/{stop['testing_site_id']}?month=2026-05-01"
    )
    assert detail.status_code == 200
    assert detail.get_json()["changes"] == []


def test_run_details_field_changes_lists_all_distinct_fields_per_location(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _, _, mlm, _ = _seed_basic_route_data()
        db.session.add(
            MonthlyRouteWorksheetAuditEvent(
                id=10,
                monthly_route_id=1,
                location_id=101,
                location_month_row_id=int(mlm.id),
                month_date=date(2026, 5, 1),
                field_name="ring",
                old_value="A",
                new_value="B",
                source="technician_app"
)
        )
        db.session.add(
            MonthlyRouteWorksheetAuditEvent(
                id=11,
                monthly_route_id=1,
                location_id=101,
                location_month_row_id=int(mlm.id),
                month_date=date(2026, 5, 1),
                field_name="door_code",
                old_value="1",
                new_value="2",
                source="technician_app"
)
        )
        db.session.add(
            MonthlyRouteWorksheetAuditEvent(
                id=12,
                monthly_route_id=1,
                location_id=101,
                location_month_row_id=int(mlm.id),
                month_date=date(2026, 5, 1),
                field_name="annual_month",
                old_value="May",
                new_value="June",
                source="technician_app"
)
        )
        db.session.commit()

    stop = _review_stop_for_location(client, 101)
    detail = client.get(
        f"/api/monthly_routes/routes/1/run_details/review/locations/{stop['testing_site_id']}?month=2026-05-01"
    )
    assert detail.status_code == 200
    labels = {c["label"] for c in detail.get_json()["changes"]}
    assert labels == {"Ring", "Door code", "Annual"}


def test_run_details_field_changes_groups_two_locations(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _, _, mlm1, _ = _seed_basic_route_data()
        loc2 = make_location(
            id=102,
            address="456 Other Ave",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            monthly_route_id=1,
            route_stop_order=1,
        )
        mlm2 = MonthlyLocationMonth(
                id=5002,
                monthly_location_id=102,
            month_date=date(2026, 5, 1),
            result_status="tested",
            test_monthly_route_id=1
)
        db.session.add_all([loc2, mlm2])
        db.session.commit()
        expected1 = mlm1.updated_at.isoformat() if mlm1.updated_at else None
        expected2 = mlm2.updated_at.isoformat() if mlm2.updated_at else None

    assert (
        client.patch(
            "/api/monthly_routes/routes/1/worksheet/rows/101?month=2026-05-01",
            json={
                "expected_updated_at": expected1,
                "client_mutation_id": "mut-run-details-loc1",
                "changes": {"testing_procedures": "PROC A"},
            }
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
            }
).status_code
        == 200
    )

    stop1 = _review_stop_for_location(client, 101)
    stop2 = _review_stop_for_location(client, 102)
    detail1 = client.get(
        f"/api/monthly_routes/routes/1/run_details/review/locations/{stop1['testing_site_id']}?month=2026-05-01"
    )
    detail2 = client.get(
        f"/api/monthly_routes/routes/1/run_details/review/locations/{stop2['testing_site_id']}?month=2026-05-01"
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
    
    client, app = run_details_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc = MonthlyLocation(
            id=101,
            address="123 Test St",
            address_normalized="123 test st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
        label="123 Test St",
        label_normalized="123 test st",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            route_stop_order=1
)
        mlm = MonthlyLocationMonth(
                id=5001,
                monthly_location_id=101,
            month_date=date(2026, 5, 1),
            result_status="tested",
            test_monthly_route_id=1
)
        db.session.add_all([route, loc, mlm])
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/1/run_details?month=2026-05-01")
    assert res.status_code == 200
    body = res.get_json()
    assert body["run"] is None
    assert body["month_date"] == "2026-05-01"

    from app.routes.monthly_routes import _runs_by_month_for_route

    with app.app_context():
        assert _runs_by_month_for_route(1).get("2026-05-01") is None


def test_runs_by_month_includes_worksheet_stop_counts(run_details_client):
    """Route detail runs_by_month includes tested/total stop counts at worksheet grain."""
    client, app = run_details_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc_primary = make_location(
            id=101,
            address="123 Test St",
            label="123 Test St",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            monthly_route_id=1,
            route_stop_order=0,
            annual_month="May",
        )
        loc_annex = make_location(
            id=88002,
            address="123 Test St",
            label="Annex panel",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            monthly_route_id=1,
            route_stop_order=1,
        )
        loc_pending = make_location(
            id=88003,
            address="123 Test St",
            label="Garage panel",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            monthly_route_id=1,
            route_stop_order=2,
        )
        run = MonthlyRouteRun(
            id=9001,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            started_at=datetime(2026, 5, 2, 8, 0, tzinfo=PACIFIC_TZ),
            status="open",
            source="technician_app",
        )
        db.session.add_all([route, loc_primary, loc_annex, loc_pending, run])
        db.session.add_all(
            [
                MonthlyLocationMonth(
                    id=92001,
                    monthly_location_id=101,
                    month_date=date(2026, 5, 1),
                    test_monthly_route_id=1,
                    run_id=9001,
                    test_outcome="all_good",
                ),
                MonthlyLocationMonth(
                    id=92002,
                    monthly_location_id=88002,
                    month_date=date(2026, 5, 1),
                    test_monthly_route_id=1,
                    run_id=9001,
                    result_status="skipped",
                    skip_reason="annual_booked",
                ),
                MonthlyLocationMonth(
                    id=92003,
                    monthly_location_id=88003,
                    month_date=date(2026, 5, 1),
                    test_monthly_route_id=1,
                    run_id=9001,
                ),
            ]
        )
        db.session.commit()

        from app.monthly.run_details_review import run_month_worksheet_stop_counts
        from app.routes.monthly_routes import _runs_by_month_for_route

        counts = run_month_worksheet_stop_counts(1, date(2026, 5, 1))
        assert counts == {"stops_on_route_count": 3, "stops_tested_count": 1}

        run_row = _runs_by_month_for_route(1)["2026-05-01"]
        assert run_row["stops_on_route_count"] == 3
        assert run_row["stops_tested_count"] == 1
        assert run_row["workflow_stage_label"] == "Field in progress"


def test_get_run_details_draft_future_month_without_run_file(run_details_client):
    """Office may open run details for a future month before any run file exists."""
    
    client, app = run_details_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc = MonthlyLocation(
            id=101,
            address="123 Test St",
            address_normalized="123 test st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
        label="123 Test St",
        label_normalized="123 test st",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            route_stop_order=1
)
        db.session.add_all([route, loc])
        db.session.commit()

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
        loc = MonthlyLocation(
            id=101,
            address="123 Test St",
            address_normalized="123 test st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
        label="123 Test St",
        label_normalized="123 test st",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            route_stop_order=1,
            keys="K-42",
            ring_detail="Ring B",
            annual_month="June"
)
        run = MonthlyRouteRun(
            id=9002,
            monthly_route_id=1,
            month_date=date(2026, 6, 1),
            status="open",
            source="office_manual",
            prepared_at=datetime(2026, 5, 28, 9, 0, tzinfo=PACIFIC_TZ)
)
        db.session.add_all([route, loc, run])
        db.session.commit()
        loc = db.session.get(MonthlyLocation, 101)
        assert loc is not None
        loc.door_code = "4821#"
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/1/run_details?month=2026-06-01")
    assert res.status_code == 200
    stop = res.get_json()["locations"][0]
    assert stop.get("key_number") == "K-42"
    assert stop.get("ring") == "Ring B"
    assert stop.get("door_code") == "4821#"
    assert stop.get("annual_month") == "June"


def test_office_prep_patch_materializes_stop_and_saves_key(run_details_client):
    """Office PATCH during prep phase creates MTSM rows and persists field edits."""
    client, app = run_details_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc = MonthlyLocation(
            id=101,
            address="123 Test St",
            address_normalized="123 test st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
        label="123 Test St",
        label_normalized="123 test st",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            route_stop_order=1,
            keys="OLD-KEY"
)
        run = MonthlyRouteRun(
            id=9003,
            monthly_route_id=1,
            month_date=date(2026, 6, 1),
            status="open",
            source="office_manual",
            prepared_at=datetime(2026, 5, 28, 9, 0, tzinfo=PACIFIC_TZ)
)
        db.session.add_all([route, loc, run])
        db.session.commit()
        ts_id = int(loc.id)

    res = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/locations/{ts_id}?month=2026-06-01",
        json={"changes": {"key_number": "NEW-KEY"}}
)
    assert res.status_code == 200
    assert res.get_json().get("ok") is True

    with app.app_context():
        mtsm = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=ts_id,
            month_date=date(2026, 6, 1)
).one()
        assert (mtsm.key_number or "").strip() == "NEW-KEY"

    details = client.get("/api/monthly_routes/routes/1/run_details?month=2026-06-01")
    stop = details.get_json()["locations"][0]
    assert stop.get("key_number") == "NEW-KEY"


def test_run_details_prep_fields_fallback_when_empty_mtsm_snapshot(run_details_client):
    """Empty MTSM snapshot rows still show library master on run details (prep phase)."""
    client, app = run_details_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc = MonthlyLocation(
            id=101,
            address="123 Test St",
            address_normalized="123 test st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
        label="123 Test St",
        label_normalized="123 test st",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            route_stop_order=1,
            keys="MA 5611 K2",
            ring_detail="Ring B",
            annual_month="June",
            inspection_tech_notes="Site notes from library"
)
        run = MonthlyRouteRun(
            id=9004,
            monthly_route_id=1,
            month_date=date(2026, 6, 1),
            status="open",
            source="office_manual",
            prepared_at=datetime(2026, 5, 28, 9, 0, tzinfo=PACIFIC_TZ)
)
        db.session.add_all([route, loc, run])
        db.session.commit()
        ts_id = int(loc.id)
        ts = MonthlyLocation.query.get(ts_id)
        assert ts is not None
        ts.annual_month = "June"
        ts.keys = "MA 5611 K2"
        ts.ring_detail = "Ring B"
        ts.inspection_tech_notes = "Site notes from library"
        db.session.add(
            MonthlyLocationMonth(
                id=91050,
                monthly_location_id=ts_id,
                month_date=date(2026, 6, 1),
                test_monthly_route_id=1,
                run_id=9004
)
        )
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/1/run_details?month=2026-06-01")
    assert res.status_code == 200
    stop = res.get_json()["locations"][0]
    assert stop.get("key_number") == "MA 5611 K2"
    assert stop.get("ring") == "Ring B"
    assert stop.get("annual_month") == "June"
    assert stop.get("inspection_tech_notes") == "Site notes from library"


def test_library_month_cell_no_worksheet_link_without_run_file(run_details_client):
    """Ledger-only history must not expose worksheet links on the location detail API."""
    client, app = run_details_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc = MonthlyLocation(
            id=101,
            address="123 Test St",
            address_normalized="123 test st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
        label="123 Test St",
        label_normalized="123 test st",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1
)
        mlm = MonthlyLocationMonth(
                id=5001,
                monthly_location_id=101,
            month_date=date(2026, 5, 1),
            result_status="tested",
            test_monthly_route_id=1
)
        db.session.add_all([route, loc, mlm])
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
        loc = db.session.get(MonthlyLocation, 101)
        assert loc is not None
        run = MonthlyRouteRun.query.filter_by(monthly_route_id=1, month_date=date(2026, 5, 1)).one()
        now = datetime.now(PACIFIC_TZ)
        run.prepared_at = now
        run.field_ended_at = now
        run.office_review_completed_at = now
        db.session.commit()

    complete = client.post(
        "/api/monthly_routes/routes/1/runs/complete",
        json={"month_date": "2026-05-01"}
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
        json={"billing_status": "do_not_bill"}
)
    assert res.status_code == 200
    body = res.get_json()
    assert body["ok"] is True
    assert body["location_id"] == 101
    assert body["billing_status"] == "do_not_bill"

    with app.app_context():
        mlm = db.session.get(MonthlyLocationMonth, 5001)
        assert mlm is not None
        assert mlm.billing_status == "do_not_bill"


def test_patch_location_billing_status_before_field_end(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()

    res = client.patch(
        "/api/monthly_routes/routes/1/locations/101/billing_status?month=2026-05-01",
        json={"billing_status": "do_not_bill"}
)
    assert res.status_code == 409
    assert res.get_json()["code"] == "billing_before_field_end"


def test_patch_location_billing_status_legacy_locked(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        run = db.session.get(MonthlyRouteRun, 9001)
        assert run is not None
        run.field_ended_at = datetime(2026, 5, 2, 17, 0, tzinfo=PACIFIC_TZ)
        mlm = db.session.get(MonthlyLocationMonth, 5001)
        assert mlm is not None
        mlm.billing_status = "legacy"
        db.session.commit()

    res = client.patch(
        "/api/monthly_routes/routes/1/locations/101/billing_status?month=2026-05-01",
        json={"billing_status": "bill"}
)
    assert res.status_code == 400
    assert res.get_json()["code"] == "billing_legacy_locked"


def test_patch_location_billing_status_invalid(run_details_client):
    client, app = run_details_client
    with app.app_context():
        _seed_basic_route_data()
        run = db.session.get(MonthlyRouteRun, 9001)
        assert run is not None
        run.field_ended_at = datetime(2026, 5, 2, 17, 0, tzinfo=PACIFIC_TZ)
        db.session.commit()

    res = client.patch(
        "/api/monthly_routes/routes/1/locations/101/billing_status?month=2026-05-01",
        json={"billing_status": "legacy"}
)
    assert res.status_code == 400
    assert res.get_json()["code"] == "billing_legacy_locked"


def test_run_details_locations_use_bounded_query_count(run_details_client):
    """Regression: run_details must batch enrichments instead of per-stop queries."""
    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    client, app = run_details_client
    with app.app_context():
        route, _loc, _mlm, run = _seed_basic_route_data()
        for idx in range(2, 12):
            lid = 100 + idx
            addr = f"{idx} Batch St"
            db.session.add(
                make_location(
                    id=lid,
                    address=addr,
                    property_management_company="Acme",
                    property_management_company_normalized="acme",
                    monthly_route_id=int(route.id),
                    route_stop_order=idx,
                )
            )
            db.session.add(
                MonthlyLocationMonth(
                    id=8000 + idx,
                    monthly_location_id=lid,
                    month_date=date(2026, 5, 1),
                    result_status="tested",
                    test_monthly_route_id=int(route.id),
                    run_id=int(run.id),
                )
            )
        db.session.commit()

    query_count = 0

    def _count_query(*_args, **_kwargs) -> None:
        nonlocal query_count
        query_count += 1

    event.listen(Engine, "before_cursor_execute", _count_query)
    try:
        res = client.get(BASE_URL)
    finally:
        event.remove(Engine, "before_cursor_execute", _count_query)

    assert res.status_code == 200
    assert len(res.get_json()["locations"]) >= 10
    assert query_count < 200, f"run_details issued {query_count} SQL queries"
