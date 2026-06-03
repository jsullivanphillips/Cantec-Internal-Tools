"""Field submission snapshot on portal field end."""

from __future__ import annotations

from datetime import date

import pytest

from app import create_app
from app.db_models import (
    Key,
    MonitoringCompany,
    MonthlyRoute,
    MonthlyRouteLocation,
    MonthlyRouteRun,
    MonthlyRouteRunFieldSubmission,
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
from tests.run_workflow_helpers import portal_start_run, seed_prepared_started_run

TABLES = [
    Key.__table__,
    MonitoringCompany.__table__,
    MonthlyRoute.__table__,
    MonthlyRouteLocation.__table__,
    MonthlyRouteRun.__table__,
    MonthlyRouteRunFieldSubmission.__table__,
    MonthlyRouteTestHistory.__table__,
    MonthlyRouteWorksheetAuditEvent.__table__,
    MonthlySite.__table__,
    MonthlyTestingSite.__table__,
    MonthlyTestingSiteMonth.__table__,
    MonthlyStopClockEvent.__table__,
    MonthlyTestingSiteDeficiency.__table__,
]


@pytest.fixture
def submission_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=TABLES)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["tech_portal_unlocked"] = True
                sess["username"] = "office_tester"
                sess["authenticated"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(TABLES)))


def _seed_route():
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


def test_field_end_creates_submission_and_get_api(submission_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = submission_client
    with app.app_context():
        _seed_route()
    portal_start_run(client)

    end = client.post("/api/technician_portal/routes/1/runs/end")
    assert end.status_code == 200

    with app.app_context():
        run = MonthlyRouteRun.query.filter_by(monthly_route_id=1, month_date=date(2026, 5, 1)).one()
        sub = MonthlyRouteRunFieldSubmission.query.filter_by(run_id=int(run.id)).one()
        assert isinstance(sub.payload_json, dict)
        stops = sub.payload_json.get("stops")
        assert isinstance(stops, list)
        assert len(stops) >= 1

    get_res = client.get(
        "/api/monthly_routes/routes/1/run_details/field_submission?month=2026-05-01"
    )
    assert get_res.status_code == 200
    body = get_res.get_json()
    assert body.get("field_work_reopened") is False
    assert isinstance(body.get("stops"), list)


def test_reopen_and_reend_overwrites_submission(submission_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = submission_client
    with app.app_context():
        _seed_route()
        seed_prepared_started_run(1, date(2026, 5, 1), field_ended=True)
        run = MonthlyRouteRun.query.one()
        sub = MonthlyRouteRunFieldSubmission(
            id=1,
            run_id=int(run.id),
            captured_at=run.field_ended_at,
            payload_json={"stops": [{"testing_site_id": 1, "run_comments": "old"}]},
        )
        db.session.add(sub)
        db.session.commit()
        old_captured = sub.captured_at

    reopen = client.post("/api/technician_portal/routes/1/runs/reopen_field")
    assert reopen.status_code == 200

    end = client.post("/api/technician_portal/routes/1/runs/end")
    assert end.status_code == 200

    with app.app_context():
        run = MonthlyRouteRun.query.one()
        sub = MonthlyRouteRunFieldSubmission.query.filter_by(run_id=int(run.id)).one()
        assert sub.captured_at >= old_captured
        stops = sub.payload_json.get("stops")
        assert isinstance(stops, list)


def test_get_backfills_submission_when_field_ended_without_snapshot(submission_client, monkeypatch):
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from app.routes import monthly_routes as mr_mod

    pacific = ZoneInfo("America/Vancouver")
    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = submission_client
    with app.app_context():
        _seed_route()
        now = datetime(2026, 6, 2, 14, 0, tzinfo=pacific)
        seed_prepared_started_run(1, date(2026, 6, 1), field_ended=True)
        run = MonthlyRouteRun.query.one()
        run.field_ended_at = now
        db.session.commit()
        assert MonthlyRouteRunFieldSubmission.query.filter_by(run_id=int(run.id)).one_or_none() is None

    get_res = client.get(
        "/api/monthly_routes/routes/1/run_details/field_submission?month=2026-06-01"
    )
    assert get_res.status_code == 200
    body = get_res.get_json()
    assert isinstance(body.get("stops"), list)
    assert len(body["stops"]) >= 1

    with app.app_context():
        run = MonthlyRouteRun.query.one()
        sub = MonthlyRouteRunFieldSubmission.query.filter_by(run_id=int(run.id)).one()
        assert sub.captured_at == run.field_ended_at


def test_worksheet_serves_frozen_submission_order(submission_client, monkeypatch):
    """Historical worksheet reads use the field submission snapshot, not live route order."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from app.routes import monthly_routes as mr_mod

    pacific = ZoneInfo("America/Vancouver")
    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = submission_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc_a = MonthlyRouteLocation(
            id=101,
            address="100 A St",
            address_normalized="100 a st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            route_stop_order=1,
        )
        loc_b = MonthlyRouteLocation(
            id=102,
            address="200 B St",
            address_normalized="200 b st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            route_stop_order=2,
        )
        loc_c = MonthlyRouteLocation(
            id=103,
            address="300 C St",
            address_normalized="300 c st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            route_stop_order=3,
        )
        db.session.add_all([route, loc_a, loc_b, loc_c])
        db.session.commit()
        sync_testing_sites_from_legacy(loc_a)
        sync_testing_sites_from_legacy(loc_b)
        sync_testing_sites_from_legacy(loc_c)
        def _testing_site_for_location(loc_id: int) -> MonthlyTestingSite:
            return (
                MonthlyTestingSite.query.join(MonthlySite)
                .filter(MonthlySite.legacy_monthly_route_location_id == loc_id)
                .one()
            )

        ts_a = _testing_site_for_location(101)
        ts_b = _testing_site_for_location(102)
        ts_c = _testing_site_for_location(103)

        now = datetime(2026, 6, 15, 12, 0, tzinfo=pacific)
        seed_prepared_started_run(1, date(2026, 6, 1), field_ended=True)
        run = MonthlyRouteRun.query.one()
        run.field_ended_at = now
        frozen_stops = [
            {
                "testing_site_id": int(ts_c.id),
                "location_id": 103,
                "stop_number": 1,
                "display_address": "300 C St",
                "month_date": "2026-06-01",
            },
            {
                "testing_site_id": int(ts_a.id),
                "location_id": 101,
                "stop_number": 2,
                "display_address": "100 A St",
                "month_date": "2026-06-01",
            },
            {
                "testing_site_id": int(ts_b.id),
                "location_id": 102,
                "stop_number": 3,
                "display_address": "200 B St",
                "month_date": "2026-06-01",
            },
        ]
        sub = MonthlyRouteRunFieldSubmission(
            id=1,
            run_id=int(run.id),
            captured_at=now,
            payload_json={"stops": frozen_stops},
        )
        db.session.add(sub)
        loc_a.route_stop_order = 2
        loc_b.route_stop_order = 3
        loc_c.route_stop_order = 1
        db.session.commit()
        frozen_ids = [int(ts_c.id), int(ts_a.id), int(ts_b.id)]

    ws = client.get("/api/monthly_routes/routes/1/worksheet?month=2026-06-01&include_stops=1")
    assert ws.status_code == 200
    body = ws.get_json()
    ws_ids = [int(s["testing_site_id"]) for s in body.get("stops") or []]
    assert ws_ids == frozen_ids

    hist = client.get(
        "/api/monthly_routes/routes/1/run_details/field_submission?month=2026-06-01"
    )
    assert hist.status_code == 200
    hist_ids = [int(s["testing_site_id"]) for s in hist.get_json().get("stops") or []]
    assert hist_ids == frozen_ids


def test_field_submission_includes_new_comment_fields(submission_client, monkeypatch):
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from app.routes import monthly_routes as mr_mod

    pacific = ZoneInfo("America/Vancouver")
    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = submission_client
    with app.app_context():
        _seed_route()
        portal_start_run(client)
        ts_id = int(MonthlyTestingSite.query.one().id)
        mtsm = MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=ts_id,
            month_date=date(2026, 5, 1),
        ).one()
        mtsm.run_comments = "Battery needs replacement"
        db.session.commit()

    end = client.post("/api/technician_portal/routes/1/runs/end")
    assert end.status_code == 200

    get_res = client.get(
        "/api/monthly_routes/routes/1/run_details/field_submission?month=2026-05-01"
    )
    assert get_res.status_code == 200
    stops = get_res.get_json().get("stops")
    assert isinstance(stops, list)
    assert len(stops) >= 1
    stop = stops[0]
    assert "run_comments" in (stop.get("new_comment_fields") or [])
