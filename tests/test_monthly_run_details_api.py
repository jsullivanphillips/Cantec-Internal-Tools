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
    MonthlyTestingSite,
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
    assert body["counts"]["sites_tested_count"] == 1
    assert body["counts"]["skipped_non_annual_count"] == 1
    assert body["counts"]["skipped_annual_count"] == 0
    notable = body["notable_stops"]
    assert any(int(s["location_id"]) == 102 for s in notable)


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

    res = client.get("/api/monthly_routes/routes/1/run_details?month=2026-05-01")
    assert res.status_code == 200
    body = res.get_json()
    assert "run_comments" not in body
    notable = body["notable_stops"]
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

    res = client.get("/api/monthly_routes/routes/1/run_details?month=2026-05-01")
    assert res.status_code == 200
    by_loc = res.get_json()["field_changes_by_location"]
    assert len(by_loc) == 1
    assert by_loc[0]["location_id"] == 101
    assert by_loc[0]["location_label"] == "123 Test St"
    names = {c["field_name"] for c in by_loc[0]["changes"]}
    assert "testing_procedures" in names
    assert "time_in" not in names
    notable = res.get_json()["notable_stops"]
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

    res = client.get("/api/monthly_routes/routes/1/run_details?month=2026-05-01")
    assert res.status_code == 200
    assert res.get_json()["field_changes_by_location"] == []
    assert res.get_json()["notable_stops"] == []


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

    res = client.get("/api/monthly_routes/routes/1/run_details?month=2026-05-01")
    assert res.status_code == 200
    assert res.get_json()["field_changes_by_location"] == []


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

    res = client.get("/api/monthly_routes/routes/1/run_details?month=2026-05-01")
    assert res.status_code == 200
    by_loc = res.get_json()["field_changes_by_location"]
    assert len(by_loc) == 2
    by_id = {row["location_id"]: row for row in by_loc}
    assert by_id[101]["location_label"] == "123 Test St"
    assert by_id[102]["location_label"] == "456 Other Ave"
    assert {c["field_name"] for c in by_id[101]["changes"]} == {"testing_procedures"}
    assert {c["field_name"] for c in by_id[102]["changes"]} == {"ring"}


def test_get_run_details_route_not_found(run_details_client):
    client, _app = run_details_client
    res = client.get("/api/monthly_routes/routes/999/run_details?month=2026-05-01")
    assert res.status_code == 404


def test_get_run_details_404_when_ledger_only_no_run_file(run_details_client):
    """Master-sheet history without ``MonthlyRouteRun`` must not expose run details."""
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

    res = client.get("/api/monthly_routes/routes/1/run_details?month=2026-05-01")
    assert res.status_code == 404
    assert res.get_json().get("code") == "run_not_found"

    from app.routes.monthly_routes import _runs_by_month_for_route

    with app.app_context():
        assert _runs_by_month_for_route(1).get("2026-05-01") is None


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

    complete = client.post(
        "/api/monthly_routes/routes/1/runs/complete",
        json={"month_date": "2026-05-01"},
    )
    assert complete.status_code == 200
    completed_run = complete.get_json()["run"]
    assert completed_run["status"] == "completed"
    assert completed_run["completed_at"] is not None
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
