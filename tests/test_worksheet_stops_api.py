"""Portal worksheet v2 stops API (``MonthlyTestingSiteMonth`` grain)."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import (
    Key,
    MonitoringCompany,
    MonthlyRoute,
    MonthlyRouteLocation,
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
def stops_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    tables = [
        Key.__table__,
        MonitoringCompany.__table__,
        MonthlyRoute.__table__,
        MonthlyRouteLocation.__table__,
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
                sess["tech_portal_unlocked"] = True
                sess["username"] = "office_tester"
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


def _seed_route_with_two_stops() -> tuple[int, int, int]:
    """Route 1, one location, two testing sites (second stop is non-primary)."""
    route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
    loc = MonthlyRouteLocation(
        id=101,
        address="123 Test St",
        address_normalized="123 test st",
        property_management_company="Acme",
        property_management_company_normalized="acme",
        building="Tower A",
        building_normalized="tower a",
        status_normalized="active",
        status_raw="Active",
        monthly_route_id=1,
        route_stop_order=0,
        keys="KEY-A",
        ring_detail="R-1",
    )
    db.session.add_all([route, loc])
    db.session.commit()
    sync_testing_sites_from_legacy(loc)
    ts_primary = (
        MonthlyTestingSite.query.filter_by(monthly_site_id=MonthlySite.query.one().id)
        .order_by(MonthlyTestingSite.sort_order.asc(), MonthlyTestingSite.id.asc())
        .first()
    )
    site = MonthlySite.query.one()
    ts_second = MonthlyTestingSite(
        id=9002,
        monthly_site_id=int(site.id),
        sort_order=1,
        label="Annex panel",
        keys="KEY-A",
        ring_detail="R-1B",
    )
    db.session.add(ts_second)
    db.session.commit()
    return 1, int(ts_primary.id), int(ts_second.id)


def test_get_worksheet_includes_stops_preview(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    # Pacific "current" month is June so May GET stays preview-only (no auto run file).
    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = stops_client
    with app.app_context():
        _seed_route_with_two_stops()

    res = client.get("/api/monthly_routes/routes/1/worksheet?month=2026-05-01&tech_portal=1")
    assert res.status_code == 200
    body = res.get_json()
    assert body.get("run") is None
    stops = body.get("stops") or []
    assert len(stops) == 2
    assert [s["stop_number"] for s in stops] == [1, 2]
    assert stops[0]["display_address"] == "123 Test St"
    assert stops[0]["history_month_row_id"] == 0


def test_portal_start_materializes_stops(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_primary, ts_second = _seed_route_with_two_stops()

    from tests.run_workflow_helpers import portal_start_run

    portal_start_run(client)

    res = client.get("/api/monthly_routes/routes/1/worksheet?month=2026-05-01&tech_portal=1")
    body = res.get_json()
    assert body["run"]["started_at"] is not None
    stops = body["stops"]
    assert len(stops) == 2
    assert [s["stop_number"] for s in stops] == [1, 2]
    by_id = {int(s["testing_site_id"]): s for s in stops}
    assert by_id[ts_primary]["history_month_row_id"] > 0
    assert by_id[ts_second]["history_month_row_id"] > 0
    for stop in stops:
        assert "clock_events" in stop
        assert "test_outcome" in stop
        assert "portal_read_only" in stop

    with app.app_context():
        assert MonthlyTestingSiteMonth.query.filter_by(month_date=date(2026, 5, 1)).count() == 2


def test_may_stops_carry_testing_procedures_from_april_history(stops_client, monkeypatch):
    """April CSV/history procedures must appear on a new May portal run without April MTSM rows."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_primary, _ = _seed_route_with_two_stops()
        db.session.add(
            MonthlyRouteRun(
                id=7101,
                monthly_route_id=route_id,
                month_date=date(2026, 4, 1),
                status="completed",
                source="csv_import",
            )
        )
        db.session.add(
            MonthlyRouteTestHistory(
                id=8101,
                location_id=101,
                month_date=date(2026, 4, 1),
                result_status="tested",
                testing_procedures="Test FACP and pull stations",
                inspection_tech_notes="Use rear entrance",
                test_monthly_route_id=route_id,
                run_id=7101,
            )
        )
        db.session.add(
            MonthlyRouteTestHistory(
                id=8102,
                location_id=101,
                month_date=date(2026, 5, 1),
                result_status=None,
                test_monthly_route_id=route_id,
            )
        )
        db.session.commit()

    from tests.run_workflow_helpers import portal_start_run

    portal_start_run(client)

    res = client.get("/api/monthly_routes/routes/1/worksheet?month=2026-05-01&tech_portal=1")
    assert res.status_code == 200
    stops = res.get_json().get("stops") or []
    primary = next(s for s in stops if int(s["testing_site_id"]) == ts_primary)
    assert primary["testing_procedures"] == "Test FACP and pull stations"
    assert primary["inspection_tech_notes"] == "Use rear entrance"


def test_portal_regenerate_paperwork_refreshes_stale_procedures(stops_client, monkeypatch):
    """Regenerate updates snapshot fields but keeps clock-in progress."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_primary, _ = _seed_route_with_two_stops()
        ts = db.session.get(MonthlyTestingSite, ts_primary)
        loc = db.session.get(MonthlyRouteLocation, 101)
        assert ts is not None and loc is not None
        ts.testing_procedures = None
        loc.testing_procedures = None
        db.session.add(
            MonthlyRouteRun(
                id=7201,
                monthly_route_id=route_id,
                month_date=date(2026, 5, 1),
                started_at=datetime(2026, 5, 2, 8, 0, tzinfo=PACIFIC_TZ),
                status="open",
                source="technician_app",
            )
        )
        db.session.add(
            MonthlyRouteTestHistory(
                id=8201,
                location_id=101,
                month_date=date(2026, 4, 1),
                testing_procedures="April CSV procedures",
                test_monthly_route_id=route_id,
            )
        )
        db.session.add(
            MonthlyTestingSiteMonth(
                id=93001,
                monthly_testing_site_id=ts_primary,
                month_date=date(2026, 5, 1),
                test_monthly_route_id=route_id,
                run_id=7201,
                testing_procedures="Stale May procedures",
                sheet_time_in_raw="08:15",
            )
        )
        db.session.commit()

    regen = client.post("/api/technician_portal/routes/1/regenerate_paperwork")
    assert regen.status_code == 200
    assert regen.get_json()["stops_refreshed"] >= 1

    res = client.get("/api/monthly_routes/routes/1/worksheet?month=2026-05-01&tech_portal=1")
    stop = next(
        s for s in res.get_json().get("stops") or [] if int(s["testing_site_id"]) == ts_primary
    )
    assert stop["testing_procedures"] == "April CSV procedures"
    assert stop["time_in"] == "08:15"


def test_portal_worksheet_open_refreshes_stale_procedures(stops_client, monkeypatch):
    """Initial worksheet open with refresh_paperwork=1 updates snapshot fields but keeps clock-in."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_primary, _ = _seed_route_with_two_stops()
        ts = db.session.get(MonthlyTestingSite, ts_primary)
        loc = db.session.get(MonthlyRouteLocation, 101)
        assert ts is not None and loc is not None
        ts.testing_procedures = None
        loc.testing_procedures = None
        db.session.add(
            MonthlyRouteRun(
                id=7203,
                monthly_route_id=route_id,
                month_date=date(2026, 5, 1),
                started_at=datetime(2026, 5, 2, 8, 0, tzinfo=PACIFIC_TZ),
                status="open",
                source="technician_app",
            )
        )
        db.session.add(
            MonthlyRouteTestHistory(
                id=8203,
                location_id=101,
                month_date=date(2026, 4, 1),
                testing_procedures="April CSV procedures",
                test_monthly_route_id=route_id,
            )
        )
        db.session.add(
            MonthlyTestingSiteMonth(
                id=93003,
                monthly_testing_site_id=ts_primary,
                month_date=date(2026, 5, 1),
                test_monthly_route_id=route_id,
                run_id=7203,
                testing_procedures="Stale May procedures",
                sheet_time_in_raw="08:15",
            )
        )
        db.session.commit()

    res = client.get(
        "/api/monthly_routes/routes/1/worksheet"
        "?month=2026-05-01&tech_portal=1&refresh_paperwork=1"
    )
    assert res.status_code == 200
    stop = next(
        s for s in res.get_json().get("stops") or [] if int(s["testing_site_id"]) == ts_primary
    )
    assert stop["testing_procedures"] == "April CSV procedures"
    assert stop["time_in"] == "08:15"


def test_portal_worksheet_background_get_skips_paperwork_refresh(stops_client, monkeypatch):
    """Worksheet GET without refresh_paperwork leaves stale snapshot paperwork in place."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_primary, _ = _seed_route_with_two_stops()
        db.session.add(
            MonthlyRouteRun(
                id=7204,
                monthly_route_id=route_id,
                month_date=date(2026, 5, 1),
                started_at=datetime(2026, 5, 2, 8, 0, tzinfo=PACIFIC_TZ),
                status="open",
                source="technician_app",
            )
        )
        db.session.add(
            MonthlyTestingSiteMonth(
                id=93004,
                monthly_testing_site_id=ts_primary,
                month_date=date(2026, 5, 1),
                test_monthly_route_id=route_id,
                run_id=7204,
                testing_procedures="Stale May procedures",
            )
        )
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/1/worksheet?month=2026-05-01&tech_portal=1")
    assert res.status_code == 200
    stop = next(
        s for s in res.get_json().get("stops") or [] if int(s["testing_site_id"]) == ts_primary
    )
    assert stop["testing_procedures"] == "Stale May procedures"


def test_portal_regenerate_paperwork_blocked_when_completed(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        _seed_route_with_two_stops()
        db.session.add(
            MonthlyRouteRun(
                id=7202,
                monthly_route_id=1,
                month_date=date(2026, 5, 1),
                status="completed",
                completed_at=datetime(2026, 5, 28, 17, 0, tzinfo=PACIFIC_TZ),
                source="office_manual",
            )
        )
        db.session.commit()

    regen = client.post("/api/technician_portal/routes/1/regenerate_paperwork")
    assert regen.status_code == 409
    assert regen.get_json().get("code") == "run_completed"


def test_patch_stop_clock_in_conflict(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        _seed_route_with_two_stops()
        ts_ids = [int(r.id) for r in MonthlyTestingSite.query.order_by(MonthlyTestingSite.id.asc()).all()]
        run = MonthlyRouteRun(
            id=5001,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            started_at=datetime(2026, 5, 2, 8, 0, tzinfo=PACIFIC_TZ),
            status="open",
            source="technician_app",
        )
        db.session.add(run)
        db.session.commit()
        from app.monthly.worksheet_stops import ensure_worksheet_stops_for_route_month

        ensure_worksheet_stops_for_route_month(1, date(2026, 5, 1), run)
        db.session.commit()
        ts_a, ts_b = ts_ids[0], ts_ids[1]

    qs = "month=2026-05-01&tech_portal=1"
    r1 = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/stops/{ts_a}?{qs}",
        json={"changes": {"time_in": "08:00"}},
    )
    assert r1.status_code == 200

    r2 = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/stops/{ts_b}?{qs}",
        json={"changes": {"time_in": "09:00"}},
    )
    assert r2.status_code == 409
    assert r2.get_json().get("code") == "open_clock_in_conflict"


def test_patch_skip_then_clock_in_clears_skip(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        _seed_route_with_two_stops()
        ts_id = int(MonthlyTestingSite.query.order_by(MonthlyTestingSite.id.asc()).first().id)
        run = MonthlyRouteRun(
            id=5002,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            started_at=datetime(2026, 5, 2, 8, 0, tzinfo=PACIFIC_TZ),
            status="open",
            source="technician_app",
        )
        db.session.add(run)
        db.session.commit()
        from app.monthly.worksheet_stops import ensure_worksheet_stops_for_route_month

        ensure_worksheet_stops_for_route_month(1, date(2026, 5, 1), run)
        db.session.commit()

    qs = "month=2026-05-01&tech_portal=1"
    skip = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/stops/{ts_id}?{qs}",
        json={"changes": {"result_status": "skipped", "skip_reason": "no access"}},
    )
    assert skip.status_code == 200
    assert skip.get_json()["stop"]["result_status"] == "skipped"

    clock = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/stops/{ts_id}?{qs}",
        json={"changes": {"time_in": "10:15"}},
    )
    assert clock.status_code == 200
    stop = clock.get_json()["stop"]
    assert stop["skip_reason"] is None
    assert stop["result_status"] is None
    assert stop["time_in"] == "10:15"


def test_patch_clear_building_name_on_stop(stops_client, monkeypatch):
    """Clearing MTSM-only snapshot fields must not 500 when history lacks those columns."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        _seed_route_with_two_stops()
        ts_id = int(MonthlyTestingSite.query.order_by(MonthlyTestingSite.id.asc()).first().id)
        run = MonthlyRouteRun(
            id=5004,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            started_at=datetime(2026, 5, 2, 8, 0, tzinfo=PACIFIC_TZ),
            status="open",
            source="technician_app",
        )
        db.session.add(run)
        db.session.commit()
        from app.monthly.worksheet_stops import ensure_worksheet_stops_for_route_month

        ensure_worksheet_stops_for_route_month(1, date(2026, 5, 1), run)
        db.session.commit()
        mtsm = MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=ts_id,
            month_date=date(2026, 5, 1),
        ).one()
        mtsm.building_name = "Tower A"
        db.session.commit()

    qs = "month=2026-05-01&tech_portal=1"
    res = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/stops/{ts_id}?{qs}",
        json={"changes": {"building_name": None}},
    )
    assert res.status_code == 200
    assert res.get_json()["stop"]["building_name"] is None


def test_patch_clock_in_with_explicit_null_result_status(stops_client, monkeypatch):
    """Portal clock-in sends null result_status; server must not wipe time_in."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        _seed_route_with_two_stops()
        ts_id = int(MonthlyTestingSite.query.order_by(MonthlyTestingSite.id.asc()).first().id)
        run = MonthlyRouteRun(
            id=5003,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            started_at=datetime(2026, 5, 2, 8, 0, tzinfo=PACIFIC_TZ),
            status="open",
            source="technician_app",
        )
        db.session.add(run)
        db.session.commit()
        from app.monthly.worksheet_stops import ensure_worksheet_stops_for_route_month

        ensure_worksheet_stops_for_route_month(1, date(2026, 5, 1), run)
        db.session.commit()

    qs = "month=2026-05-01&tech_portal=1"
    res = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/stops/{ts_id}?{qs}",
        json={
            "changes": {
                "time_in": "08:30",
                "time_out": None,
                "result_status": None,
                "skip_reason": None,
            }
        },
    )
    assert res.status_code == 200
    assert res.get_json()["stop"]["time_in"] == "08:30"


def test_worksheet_stop_display_uses_run_month_panel_not_library_master(stops_client, monkeypatch):
    """Historical run months keep their snapshot even when library master panel changes."""
    from app.monthly.worksheet_stops import serialize_worksheet_stop
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_id, _ = _seed_route_with_two_stops()
        loc = db.session.get(MonthlyRouteLocation, 101)
        ts = db.session.get(MonthlyTestingSite, ts_id)
        assert loc is not None and ts is not None
        ts.panel = "PACPRO P24A"
        ts.facp_detail = "PACPRO P24A"
        ts.panel_location = "Basement electrical room"
        db.session.add(
            MonthlyRouteRun(
                id=7002,
                monthly_route_id=route_id,
                month_date=date(2026, 4, 1),
                status="completed",
                source="csv_import",
            )
        )
        db.session.add(
            MonthlyTestingSiteMonth(
                id=91001,
                monthly_testing_site_id=ts_id,
                month_date=date(2026, 4, 1),
                test_monthly_route_id=route_id,
                panel="Simplex 4100ES",
                facp="Simplex 4100ES",
                panel_location="Electrical room",
                result_status="tested",
            )
        )
        db.session.commit()

        stop = serialize_worksheet_stop(
            ts,
            loc,
            db.session.get(MonthlyTestingSiteMonth, 91001),
            route_id=route_id,
            month_first=date(2026, 4, 1),
            stop_number=1,
        )
        assert stop["panel"] == "Simplex 4100ES"
        assert stop["panel_location"] == "Electrical room"

    res = client.get("/api/monthly_routes/routes/1/worksheet?month=2026-04-01&tech_portal=1")
    assert res.status_code == 200
    stops = res.get_json().get("stops") or []
    primary = next(s for s in stops if int(s["testing_site_id"]) == ts_id)
    assert primary["panel"] == "Simplex 4100ES"
    assert primary["panel_location"] == "Electrical room"


def test_worksheet_stop_display_uses_run_month_notes_not_library_master(stops_client, monkeypatch):
    """``MonthlyTestingSiteMonth`` sheet notes must not be replaced by library master on read."""
    from app.monthly.worksheet_stops import serialize_worksheet_stop
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_id, _ = _seed_route_with_two_stops()
        loc = db.session.get(MonthlyRouteLocation, 101)
        ts = db.session.get(MonthlyTestingSite, ts_id)
        assert loc is not None and ts is not None
        ts.testing_procedures = "Library procedures"
        ts.inspection_tech_notes = "Library notes"
        loc.testing_procedures = "Library procedures"
        loc.inspection_tech_notes = "Library notes"

        db.session.add(
            MonthlyRouteRun(
                id=7001,
                monthly_route_id=route_id,
                month_date=date(2026, 4, 1),
                status="completed",
                source="csv_import",
            )
        )
        db.session.add(
            MonthlyTestingSiteMonth(
                id=91010,
                monthly_testing_site_id=ts_id,
                month_date=date(2026, 4, 1),
                test_monthly_route_id=route_id,
                testing_procedures="April procedures",
                inspection_tech_notes="April notes",
                result_status="tested",
            )
        )
        db.session.add(
            MonthlyTestingSiteMonth(
                id=91011,
                monthly_testing_site_id=ts_id,
                month_date=date(2026, 5, 1),
                test_monthly_route_id=route_id,
                testing_procedures="May procedures",
                inspection_tech_notes="May notes",
            )
        )
        db.session.commit()

        april = serialize_worksheet_stop(
            ts,
            loc,
            db.session.get(MonthlyTestingSiteMonth, 91010),
            route_id=route_id,
            month_first=date(2026, 4, 1),
            stop_number=1,
        )
        assert april["testing_procedures"] == "April procedures"
        assert april["inspection_tech_notes"] == "April notes"

    res = client.get("/api/monthly_routes/routes/1/worksheet?month=2026-04-01&tech_portal=1")
    assert res.status_code == 200
    stops = res.get_json().get("stops") or []
    primary = next(s for s in stops if int(s["testing_site_id"]) == ts_id)
    assert primary["testing_procedures"] == "April procedures"
    assert primary["inspection_tech_notes"] == "April notes"


def test_ensure_worksheet_stops_preserves_prep_monitoring_notes(stops_client, monkeypatch):
    """run_details prep load must not re-seed existing stop-month rows and wipe edits."""
    from app.monthly.worksheet_stops import ensure_worksheet_stops_for_route_month
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_id, _ = _seed_route_with_two_stops()
        run = MonthlyRouteRun(
            id=5021,
            monthly_route_id=route_id,
            month_date=date(2026, 7, 1),
            status="open",
            source="office_manual",
        )
        db.session.add(run)
        db.session.add(
            MonthlyTestingSiteMonth(
                id=92011,
                monthly_testing_site_id=ts_id,
                month_date=date(2026, 7, 1),
                test_monthly_route_id=route_id,
                run_id=5021,
                monitoring_notes="Old monitoring notes",
            )
        )
        db.session.commit()

    qs = "month=2026-07-01"
    patch = client.patch(
        f"/api/monthly_routes/routes/{route_id}/worksheet/stops/{ts_id}?{qs}",
        json={"changes": {"monitoring_notes": "Updated monitoring notes"}},
    )
    assert patch.status_code == 200

    with app.app_context():
        run = MonthlyRouteRun.query.filter_by(
            monthly_route_id=route_id,
            month_date=date(2026, 7, 1),
        ).one()
        ensure_worksheet_stops_for_route_month(route_id, date(2026, 7, 1), run)
        db.session.commit()
        mtsm = db.session.get(MonthlyTestingSiteMonth, 92011)
        assert mtsm.monitoring_notes == "Updated monitoring notes"

    get_res = client.get(f"/api/monthly_routes/routes/{route_id}/run_details?month=2026-07-01")
    assert get_res.status_code == 200
    body = get_res.get_json()
    stops = body["locations"][0]["stops"]
    hit = next(s for s in stops if int(s["testing_site_id"]) == ts_id)
    assert hit["monitoring_notes"] == "Updated monitoring notes"


def test_refresh_worksheet_stops_preserves_office_prep_fields(stops_client, monkeypatch):
    """Portal ``refresh_paperwork`` must not wipe office-edited stop-month snapshot fields."""
    from app.monthly.worksheet_stops import refresh_worksheet_stops_for_route_month
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_id, _ = _seed_route_with_two_stops()
        run = MonthlyRouteRun(
            id=5020,
            monthly_route_id=route_id,
            month_date=date(2026, 6, 1),
            started_at=datetime(2026, 6, 2, 8, 0, tzinfo=PACIFIC_TZ),
            status="open",
            source="office_manual",
        )
        db.session.add(run)
        db.session.add(
            MonthlyTestingSiteMonth(
                id=92010,
                monthly_testing_site_id=ts_id,
                month_date=date(2026, 6, 1),
                test_monthly_route_id=route_id,
                run_id=5020,
                run_comments="Bring ladder",
                testing_procedures="Office procedures",
                inspection_tech_notes="Office location notes",
                office_attention=True,
            )
        )
        db.session.commit()
        refresh_worksheet_stops_for_route_month(route_id, date(2026, 6, 1), run)
        db.session.commit()
        mtsm = db.session.get(MonthlyTestingSiteMonth, 92010)
        assert mtsm.run_comments == "Bring ladder"
        assert mtsm.testing_procedures == "Office procedures"
        assert mtsm.inspection_tech_notes == "Office location notes"
        assert mtsm.office_attention is True


def test_run_comments_not_copied_to_new_month(stops_client, monkeypatch):
    """Prior-month ``run_comments`` must not seed into a newly materialized month."""
    from app.monthly.worksheet_stops import ensure_worksheet_stops_for_route_month
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_id, _ = _seed_route_with_two_stops()
        db.session.add(
            MonthlyTestingSiteMonth(
                id=92001,
                monthly_testing_site_id=ts_id,
                month_date=date(2026, 5, 1),
                test_monthly_route_id=route_id,
                run_comments="Found bad battery",
                inspection_tech_notes="May location note",
            )
        )
        run_june = MonthlyRouteRun(
            id=5010,
            monthly_route_id=route_id,
            month_date=date(2026, 6, 1),
            started_at=datetime(2026, 6, 2, 8, 0, tzinfo=PACIFIC_TZ),
            status="open",
            source="technician_app",
        )
        db.session.add(run_june)
        db.session.commit()
        ensure_worksheet_stops_for_route_month(route_id, date(2026, 6, 1), run_june)
        db.session.commit()

        may = MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=ts_id,
            month_date=date(2026, 5, 1),
        ).one()
        june = MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=ts_id,
            month_date=date(2026, 6, 1),
        ).one()
        assert may.run_comments == "Found bad battery"
        assert june.run_comments is None

    res = client.get("/api/monthly_routes/routes/1/worksheet?month=2026-06-01&tech_portal=1")
    assert res.status_code == 200
    stop = next(
        s for s in res.get_json().get("stops") or [] if int(s["testing_site_id"]) == ts_id
    )
    assert stop["run_comments"] is None


def test_patch_run_comments_does_not_mirror_to_library_master(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        _seed_route_with_two_stops()
        ts_id = int(MonthlyTestingSite.query.order_by(MonthlyTestingSite.id.asc()).first().id)
        ts = db.session.get(MonthlyTestingSite, ts_id)
        assert ts is not None
        ts.inspection_tech_notes = "Library location notes"
        ts.testing_procedures = "Library procedures"
        run = MonthlyRouteRun(
            id=5011,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            started_at=datetime(2026, 5, 2, 8, 0, tzinfo=PACIFIC_TZ),
            status="open",
            source="technician_app",
        )
        db.session.add(run)
        db.session.commit()
        from app.monthly.worksheet_stops import ensure_worksheet_stops_for_route_month

        ensure_worksheet_stops_for_route_month(1, date(2026, 5, 1), run)
        db.session.commit()

    qs = "month=2026-05-01&tech_portal=1"
    res = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/stops/{ts_id}?{qs}",
        json={"changes": {"run_comments": "Replaced pull station today"}},
    )
    assert res.status_code == 200
    assert res.get_json()["stop"]["run_comments"] == "Replaced pull station today"

    with app.app_context():
        ts = db.session.get(MonthlyTestingSite, ts_id)
        assert ts is not None
        assert ts.inspection_tech_notes == "Library location notes"
        assert ts.testing_procedures == "Library procedures"


def test_patch_monitoring_notes_mirrors_to_testing_site_master(stops_client, monkeypatch):
    from app.monthly.worksheet_stops import ensure_worksheet_stops_for_route_month
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_id, _ = _seed_route_with_two_stops()
        run = MonthlyRouteRun(
            id=5013,
            monthly_route_id=route_id,
            month_date=date(2026, 5, 1),
            started_at=datetime(2026, 5, 2, 8, 0, tzinfo=PACIFIC_TZ),
            status="open",
            source="technician_app",
        )
        db.session.add(run)
        db.session.commit()
        ensure_worksheet_stops_for_route_month(route_id, date(2026, 5, 1), run)
        db.session.commit()

    qs = "month=2026-05-01&tech_portal=1"
    res = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/stops/{ts_id}?{qs}",
        json={"changes": {"monitoring_notes": "Acct 123 - fire and trouble only"}},
    )
    assert res.status_code == 200

    with app.app_context():
        ts = db.session.get(MonthlyTestingSite, ts_id)
        assert ts is not None
        assert ts.monitoring_notes == "Acct 123 - fire and trouble only"


def test_secondary_testing_site_patch_persists_to_next_run(stops_client, monkeypatch):
    from app.monthly.worksheet_stops import ensure_worksheet_stops_for_route_month
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        route_id, _, ts_second = _seed_route_with_two_stops()
        ts = db.session.get(MonthlyTestingSite, ts_second)
        assert ts is not None
        ts.panel = "Old secondary panel"
        ts.facp_detail = "Old secondary panel"
        ts.monitoring_notes = "Old secondary monitoring"
        run = MonthlyRouteRun(
            id=5014,
            monthly_route_id=route_id,
            month_date=date(2026, 5, 1),
            started_at=datetime(2026, 5, 2, 8, 0, tzinfo=PACIFIC_TZ),
            status="open",
            source="technician_app",
        )
        db.session.add(run)
        db.session.commit()
        ensure_worksheet_stops_for_route_month(route_id, date(2026, 5, 1), run)
        db.session.commit()

    qs = "month=2026-05-01&tech_portal=1"
    res = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/stops/{ts_second}?{qs}",
        json={
            "changes": {
                "panel": "New secondary panel",
                "monitoring_notes": "New secondary monitoring",
            }
        },
    )
    assert res.status_code == 200

    with app.app_context():
        ts = db.session.get(MonthlyTestingSite, ts_second)
        assert ts is not None
        assert ts.panel == "New secondary panel"
        assert ts.monitoring_notes == "New secondary monitoring"

        run_june = MonthlyRouteRun(
            id=5015,
            monthly_route_id=route_id,
            month_date=date(2026, 6, 1),
            started_at=datetime(2026, 6, 2, 8, 0, tzinfo=PACIFIC_TZ),
            status="open",
            source="technician_app",
        )
        db.session.add(run_june)
        db.session.commit()
        ensure_worksheet_stops_for_route_month(route_id, date(2026, 6, 1), run_june)
        db.session.commit()

        june = MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=ts_second,
            month_date=date(2026, 6, 1),
        ).one()
        assert june.panel == "New secondary panel"
        assert june.monitoring_notes == "New secondary monitoring"


def test_reset_run_clears_run_comments(stops_client, monkeypatch):
    from app.monthly.worksheet_stops import ensure_worksheet_stops_for_route_month
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_id, ts_second = _seed_route_with_two_stops()
        run = MonthlyRouteRun(
            id=5012,
            monthly_route_id=route_id,
            month_date=date(2026, 5, 1),
            started_at=datetime(2026, 5, 2, 8, 0, tzinfo=PACIFIC_TZ),
            status="open",
            source="technician_app",
        )
        db.session.add(run)
        db.session.commit()
        ensure_worksheet_stops_for_route_month(route_id, date(2026, 5, 1), run)
        db.session.commit()

        mtsm_a = MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=ts_id,
            month_date=date(2026, 5, 1),
        ).one()
        mtsm_b = MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=ts_second,
            month_date=date(2026, 5, 1),
        ).one()
        mtsm_a.run_comments = "Notes only on A"
        mtsm_b.run_comments = "Notes on B"
        mtsm_b.sheet_time_in_raw = "09:00"
        db.session.add(
            MonthlyStopClockEvent(
                id=1,
                monthly_testing_site_month_id=int(mtsm_a.id),
                sort_order=0,
                time_in_raw="8:00 AM",
                time_out_raw="8:30 AM",
            )
        )
        db.session.add(
            MonthlyStopClockEvent(
                id=2,
                monthly_testing_site_month_id=int(mtsm_b.id),
                sort_order=0,
                time_in_raw="9:00 AM",
                time_out_raw=None,
            )
        )
        db.session.commit()

    res = client.post("/api/monthly_routes/routes/1/worksheet/reset_run?month=2026-05-01", json={})
    assert res.status_code == 200

    with app.app_context():
        mtsm_a = MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=ts_id,
            month_date=date(2026, 5, 1),
        ).one()
        mtsm_b = MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=ts_second,
            month_date=date(2026, 5, 1),
        ).one()
        assert mtsm_a.run_comments is None
        assert mtsm_b.run_comments is None
        assert mtsm_b.sheet_time_in_raw is None
        assert MonthlyStopClockEvent.query.count() == 0


def test_stop_patch_writes_audit_for_each_property_field(stops_client, monkeypatch):
    """Each patched property field gets its own audit row (pre-sync snapshot as old_value)."""
    from app.monthly.worksheet_stops import ensure_worksheet_stops_for_route_month
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_id, _ = _seed_route_with_two_stops()
        loc = db.session.get(MonthlyRouteLocation, 101)
        assert loc is not None
        loc.annual_month = "May"
        run = MonthlyRouteRun(
            id=5099,
            monthly_route_id=route_id,
            month_date=date(2026, 5, 1),
            started_at=datetime(2026, 5, 2, 8, 0, tzinfo=PACIFIC_TZ),
            status="open",
            source="technician_app",
        )
        db.session.add(run)
        db.session.commit()
        ensure_worksheet_stops_for_route_month(route_id, date(2026, 5, 1), run)
        mtsm = MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=ts_id,
            month_date=date(2026, 5, 1),
        ).one()
        mtsm.ring = "RING-OLD"
        mtsm.door_code = "1111"
        mtsm.annual_month = "May"
        db.session.commit()

    qs = "month=2026-05-01&tech_portal=1"
    res = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/stops/{ts_id}?{qs}",
        json={
            "changes": {
                "ring": "RING-NEW",
                "door_code": "2222",
                "annual_month": "June",
            },
        },
    )
    assert res.status_code == 200

    with app.app_context():
        events = (
            MonthlyRouteWorksheetAuditEvent.query.filter_by(location_id=101)
            .order_by(MonthlyRouteWorksheetAuditEvent.id.asc())
            .all()
        )
        by_field = {e.field_name: e for e in events}
        assert by_field["ring"].old_value == "RING-OLD"
        assert by_field["ring"].new_value == "RING-NEW"
        assert by_field["door_code"].old_value == "1111"
        assert by_field["door_code"].new_value == "2222"
        assert by_field["annual_month"].old_value == "May"
        assert by_field["annual_month"].new_value == "June"


def test_patch_monitoring_password_mirrors_to_testing_site_master(stops_client, monkeypatch):
    from app.monthly.worksheet_stops import ensure_worksheet_stops_for_route_month
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_id, _ = _seed_route_with_two_stops()
        run = MonthlyRouteRun(
            id=5098,
            monthly_route_id=route_id,
            month_date=date(2026, 5, 1),
            started_at=datetime(2026, 5, 2, 8, 0, tzinfo=PACIFIC_TZ),
            status="open",
            source="technician_app",
        )
        db.session.add(run)
        db.session.commit()
        ensure_worksheet_stops_for_route_month(route_id, date(2026, 5, 1), run)
        db.session.commit()

    qs = "month=2026-05-01"
    res = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/stops/{ts_id}?{qs}",
        json={"changes": {"monitoring_password": "boats"}},
    )
    assert res.status_code == 200, res.get_data(as_text=True)
    stop = res.get_json()["stop"]
    assert stop["monitoring_password"] == "boats"

    with app.app_context():
        ts = db.session.get(MonthlyTestingSite, ts_id)
        assert ts is not None
        assert ts.monitoring_password == "boats"


def test_patch_monitoring_company_id_and_account(stops_client, monkeypatch):
    from app.monthly.worksheet_stops import ensure_worksheet_stops_for_route_month
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_id, _ = _seed_route_with_two_stops()
        mc = MonitoringCompany(id=1, name="Signal Co", name_normalized="signal co", active=True)
        db.session.add(mc)
        db.session.flush()
        mc_id = int(mc.id)
        run = MonthlyRouteRun(
            id=5099,
            monthly_route_id=route_id,
            month_date=date(2026, 5, 1),
            started_at=datetime(2026, 5, 2, 8, 0, tzinfo=PACIFIC_TZ),
            status="open",
            source="technician_app",
        )
        db.session.add(run)
        db.session.commit()
        ensure_worksheet_stops_for_route_month(route_id, date(2026, 5, 1), run)
        db.session.commit()

    qs = "month=2026-05-01&tech_portal=1"
    res = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/stops/{ts_id}?{qs}",
        json={
            "changes": {
                "monitoring_company_id": mc_id,
                "monitoring_account_number": "ACCT-42",
            },
        },
    )
    assert res.status_code == 200, res.get_data(as_text=True)
    stop = res.get_json()["stop"]
    assert stop["monitoring_company_id"] == mc_id
    assert stop["monitoring_account_number"] == "ACCT-42"
    assert stop["monitoring_company"] == "Signal Co"
    assert stop["monitoring_company_record"]["primary_phone"] is None

    with app.app_context():
        ts = db.session.get(MonthlyTestingSite, ts_id)
        assert ts is not None
        assert ts.monitoring_company_id == mc_id
        assert ts.monitoring_account_number == "ACCT-42"


def test_patch_office_attention_office_prep_only(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        _seed_route_with_two_stops()
        ts_id = int(MonthlyTestingSite.query.order_by(MonthlyTestingSite.id.asc()).first().id)
        run = MonthlyRouteRun(
            id=5010,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            status="open",
            source="office_manual",
        )
        db.session.add(run)
        db.session.commit()
        from app.monthly.worksheet_stops import ensure_worksheet_stops_for_route_month

        ensure_worksheet_stops_for_route_month(1, date(2026, 5, 1), run)
        db.session.commit()

    with client.session_transaction() as sess:
        sess["authenticated"] = True

    qs = "month=2026-05-01"
    ok = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/stops/{ts_id}?{qs}",
        json={"changes": {"office_attention": True}},
    )
    assert ok.status_code == 200
    assert ok.get_json()["stop"]["office_attention"] is True

    portal = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/stops/{ts_id}?{qs}&tech_portal=1",
        json={"changes": {"office_attention": False}},
    )
    assert portal.status_code == 403
    assert portal.get_json().get("code") == "office_attention_office_only"

    with app.app_context():
        run.started_at = datetime(2026, 5, 2, 8, 0, tzinfo=PACIFIC_TZ)
        db.session.add(run)
        db.session.commit()

    locked = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/stops/{ts_id}?{qs}",
        json={"changes": {"office_attention": False}},
    )
    assert locked.status_code == 409
    assert locked.get_json().get("code") == "run_prep_locked"


def test_patch_prior_month_out_of_order_dismissed_office_prep_only(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        _seed_route_with_two_stops()
        ts_id = int(MonthlyTestingSite.query.order_by(MonthlyTestingSite.id.asc()).first().id)
        run = MonthlyRouteRun(
            id=5011,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            status="open",
            source="office_manual",
        )
        db.session.add(run)
        db.session.commit()
        from app.monthly.worksheet_stops import ensure_worksheet_stops_for_route_month

        ensure_worksheet_stops_for_route_month(1, date(2026, 5, 1), run)
        db.session.commit()

    with client.session_transaction() as sess:
        sess["authenticated"] = True

    qs = "month=2026-05-01"
    ok = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/stops/{ts_id}?{qs}",
        json={"changes": {"prior_month_out_of_order_dismissed": True}},
    )
    assert ok.status_code == 200
    assert ok.get_json()["stop"]["prior_month_out_of_order_dismissed"] is True

    portal = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/stops/{ts_id}?{qs}&tech_portal=1",
        json={"changes": {"prior_month_out_of_order_dismissed": True}},
    )
    assert portal.status_code == 403
    assert portal.get_json().get("code") == "prior_month_out_of_order_dismissed_office_only"


def test_regenerate_prep_stops_reseeds_from_prior_month_and_clears_prep_flags(
    stops_client, monkeypatch
):
    """Office prep regenerate re-seeds from prior stop-month and clears office prep flags."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_id, _ = _seed_route_with_two_stops()
        ts = db.session.get(MonthlyTestingSite, ts_id)
        assert ts is not None
        ts.inspection_tech_notes = None
        ts.testing_procedures = None
        db.session.add(
            MonthlyRouteTestHistory(
                id=94001,
                location_id=101,
                month_date=date(2026, 5, 1),
                inspection_tech_notes="Old history notes",
                testing_procedures="Old history procedures",
                test_monthly_route_id=route_id,
            )
        )
        db.session.add(
            MonthlyTestingSiteMonth(
                id=94010,
                monthly_testing_site_id=ts_id,
                month_date=date(2026, 5, 1),
                test_monthly_route_id=route_id,
                inspection_tech_notes=None,
                testing_procedures="May procedures",
            )
        )
        run = MonthlyRouteRun(
            id=94020,
            monthly_route_id=route_id,
            month_date=date(2026, 6, 1),
            status="open",
            source="office_manual",
        )
        db.session.add(run)
        db.session.add(
            MonthlyTestingSiteMonth(
                id=94011,
                monthly_testing_site_id=ts_id,
                month_date=date(2026, 6, 1),
                test_monthly_route_id=route_id,
                run_id=94020,
                inspection_tech_notes="Stale resurrected notes",
                testing_procedures="Stale procedures",
                office_attention=True,
                run_comments="Keep me?",
                result_status="tested",
            )
        )
        db.session.commit()

    with client.session_transaction() as sess:
        sess["authenticated"] = True

    res = client.post(
        "/api/monthly_routes/routes/1/runs/regenerate_prep_stops",
        json={"month_date": "2026-06-01"},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["stops_regenerated"] >= 1
    assert body.get("stops_pruned", 0) >= 0

    with app.app_context():
        june = MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=ts_id,
            month_date=date(2026, 6, 1),
        ).one()
        assert june.testing_procedures == "May procedures"
        assert june.office_attention is False
        assert june.run_comments is None
        assert june.result_status is None


def test_regenerate_prep_stops_blocked_after_field_work_starts(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = stops_client
    with app.app_context():
        route_id, _, _ = _seed_route_with_two_stops()
        run = MonthlyRouteRun(
            id=94030,
            monthly_route_id=route_id,
            month_date=date(2026, 6, 1),
            started_at=datetime(2026, 6, 2, 8, 0, tzinfo=PACIFIC_TZ),
            status="open",
            source="technician_app",
        )
        db.session.add(run)
        db.session.commit()

    with client.session_transaction() as sess:
        sess["authenticated"] = True

    res = client.post(
        f"/api/monthly_routes/routes/{route_id}/runs/regenerate_prep_stops",
        json={"month_date": "2026-06-01"},
    )
    assert res.status_code == 409
    assert res.get_json().get("code") == "run_prep_locked"


def _prep_regen_auth(client) -> None:
    with client.session_transaction() as sess:
        sess["authenticated"] = True


def _prep_run(route_id: int, run_id: int, month: date) -> MonthlyRouteRun:
    run = MonthlyRouteRun(
        id=run_id,
        monthly_route_id=route_id,
        month_date=month,
        status="open",
        source="office_manual",
    )
    db.session.add(run)
    return run


def test_regenerate_prep_stops_prunes_cancelled_location(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_active, _ = _seed_route_with_two_stops()
        cancelled = MonthlyRouteLocation(
            id=102,
            address="999 Cancelled Ave",
            address_normalized="999 cancelled ave",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="cancelled",
            status_raw="Cancelled",
            monthly_route_id=route_id,
            route_stop_order=1,
        )
        db.session.add(cancelled)
        db.session.commit()
        sync_testing_sites_from_legacy(cancelled)
        ts_cancelled = (
            MonthlyTestingSite.query.join(MonthlySite)
            .filter(MonthlySite.legacy_monthly_route_location_id == 102)
            .one()
        )
        ts_cancelled_id = int(ts_cancelled.id)
        run = _prep_run(route_id, 94100, date(2026, 6, 1))
        db.session.add_all(
            [
                MonthlyTestingSiteMonth(
                    id=94101,
                    monthly_testing_site_id=ts_active,
                    month_date=date(2026, 6, 1),
                    test_monthly_route_id=route_id,
                    run_id=94100,
                ),
                MonthlyTestingSiteMonth(
                    id=94102,
                    monthly_testing_site_id=ts_cancelled_id,
                    month_date=date(2026, 6, 1),
                    test_monthly_route_id=route_id,
                    run_id=94100,
                ),
            ]
        )
        db.session.commit()

    _prep_regen_auth(client)
    res = client.post(
        f"/api/monthly_routes/routes/{route_id}/runs/regenerate_prep_stops",
        json={"month_date": "2026-06-01"},
    )
    assert res.status_code == 200
    assert res.get_json()["stops_pruned"] >= 1

    with app.app_context():
        assert (
            MonthlyTestingSiteMonth.query.filter_by(
                monthly_testing_site_id=ts_cancelled_id,
                month_date=date(2026, 6, 1),
            ).one_or_none()
            is None
        )
        assert (
            MonthlyTestingSiteMonth.query.filter_by(
                monthly_testing_site_id=ts_active,
                month_date=date(2026, 6, 1),
            ).one_or_none()
            is not None
        )


def test_regenerate_prep_stops_run_details_does_not_resurrect_cancelled(
    stops_client, monkeypatch
):
    """Prep run_details ensure must not recreate stop-month rows for cancelled sites."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_active, _ = _seed_route_with_two_stops()
        cancelled = MonthlyRouteLocation(
            id=102,
            address="999 Cancelled Ave",
            address_normalized="999 cancelled ave",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="cancelled",
            status_raw="Cancelled",
            monthly_route_id=route_id,
            route_stop_order=1,
        )
        db.session.add(cancelled)
        db.session.commit()
        sync_testing_sites_from_legacy(cancelled)
        ts_cancelled_id = int(
            MonthlyTestingSite.query.join(MonthlySite)
            .filter(MonthlySite.legacy_monthly_route_location_id == 102)
            .one()
            .id
        )
        run = _prep_run(route_id, 94140, date(2026, 6, 1))
        db.session.add_all(
            [
                MonthlyTestingSiteMonth(
                    id=94141,
                    monthly_testing_site_id=ts_active,
                    month_date=date(2026, 6, 1),
                    test_monthly_route_id=route_id,
                    run_id=94140,
                ),
                MonthlyTestingSiteMonth(
                    id=94142,
                    monthly_testing_site_id=ts_cancelled_id,
                    month_date=date(2026, 6, 1),
                    test_monthly_route_id=route_id,
                    run_id=94140,
                ),
            ]
        )
        db.session.commit()

    _prep_regen_auth(client)
    regen = client.post(
        f"/api/monthly_routes/routes/{route_id}/runs/regenerate_prep_stops",
        json={"month_date": "2026-06-01"},
    )
    assert regen.status_code == 200

    details = client.get(f"/api/monthly_routes/routes/{route_id}/run_details?month=2026-06-01")
    assert details.status_code == 200
    location_ids = {
        int(loc["location_id"]) for loc in (details.get_json().get("locations") or [])
    }
    assert 102 not in location_ids

    with app.app_context():
        assert (
            MonthlyTestingSiteMonth.query.filter_by(
                monthly_testing_site_id=ts_cancelled_id,
                month_date=date(2026, 6, 1),
            ).one_or_none()
            is None
        )


def test_regenerate_prep_stops_prunes_off_route_location(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_id, _ = _seed_route_with_two_stops()
        loc = db.session.get(MonthlyRouteLocation, 101)
        assert loc is not None
        run = _prep_run(route_id, 94110, date(2026, 6, 1))
        db.session.add(
            MonthlyTestingSiteMonth(
                id=94111,
                monthly_testing_site_id=ts_id,
                month_date=date(2026, 6, 1),
                test_monthly_route_id=route_id,
                run_id=94110,
            )
        )
        db.session.commit()
        loc.monthly_route_id = None
        db.session.commit()

    _prep_regen_auth(client)
    res = client.post(
        f"/api/monthly_routes/routes/{route_id}/runs/regenerate_prep_stops",
        json={"month_date": "2026-06-01"},
    )
    assert res.status_code == 200
    assert res.get_json()["stops_pruned"] == 1

    with app.app_context():
        assert (
            MonthlyTestingSiteMonth.query.filter_by(
                monthly_testing_site_id=ts_id,
                month_date=date(2026, 6, 1),
            ).one_or_none()
            is None
        )


def test_regenerate_prep_stops_adds_new_library_location(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_existing, _ = _seed_route_with_two_stops()
        new_loc = MonthlyRouteLocation(
            id=103,
            address="555 New St",
            address_normalized="555 new st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=route_id,
            route_stop_order=1,
        )
        _prep_run(route_id, 94120, date(2026, 6, 1))
        db.session.add(new_loc)
        db.session.add(
            MonthlyTestingSiteMonth(
                id=94121,
                monthly_testing_site_id=ts_existing,
                month_date=date(2026, 6, 1),
                test_monthly_route_id=route_id,
                run_id=94120,
            )
        )
        db.session.commit()
        sync_testing_sites_from_legacy(new_loc)
        ts_new = (
            MonthlyTestingSite.query.join(MonthlySite)
            .filter(MonthlySite.legacy_monthly_route_location_id == 103)
            .one()
        )

    _prep_regen_auth(client)
    res = client.post(
        f"/api/monthly_routes/routes/{route_id}/runs/regenerate_prep_stops",
        json={"month_date": "2026-06-01"},
    )
    assert res.status_code == 200
    assert res.get_json()["stops_regenerated"] >= 2

    with app.app_context():
        assert (
            MonthlyTestingSiteMonth.query.filter_by(
                monthly_testing_site_id=int(ts_new.id),
                month_date=date(2026, 6, 1),
            ).one_or_none()
            is not None
        )


def test_regenerate_prep_stops_applies_library_stop_order(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = stops_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc_a = MonthlyRouteLocation(
            id=101,
            address="AAA First St",
            address_normalized="aaa first st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            route_stop_order=0,
        )
        loc_b = MonthlyRouteLocation(
            id=102,
            address="BBB Second St",
            address_normalized="bbb second st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            route_stop_order=1,
        )
        db.session.add_all([route, loc_a, loc_b])
        db.session.commit()
        sync_testing_sites_from_legacy(loc_a)
        sync_testing_sites_from_legacy(loc_b)
        ts_a = (
            MonthlyTestingSite.query.join(MonthlySite)
            .filter(MonthlySite.legacy_monthly_route_location_id == 101)
            .one()
        )
        ts_b = (
            MonthlyTestingSite.query.join(MonthlySite)
            .filter(MonthlySite.legacy_monthly_route_location_id == 102)
            .one()
        )
        run = _prep_run(1, 94130, date(2026, 6, 1))
        db.session.add_all(
            [
                MonthlyTestingSiteMonth(
                    id=94131,
                    monthly_testing_site_id=int(ts_a.id),
                    month_date=date(2026, 6, 1),
                    test_monthly_route_id=1,
                    run_id=94130,
                    session_route_stop_order=1,
                ),
                MonthlyTestingSiteMonth(
                    id=94132,
                    monthly_testing_site_id=int(ts_b.id),
                    month_date=date(2026, 6, 1),
                    test_monthly_route_id=1,
                    run_id=94130,
                    session_route_stop_order=0,
                ),
            ]
        )
        db.session.commit()

    _prep_regen_auth(client)
    res = client.post(
        "/api/monthly_routes/routes/1/runs/regenerate_prep_stops",
        json={"month_date": "2026-06-01"},
    )
    assert res.status_code == 200
    assert res.get_json()["session_orders_updated"] >= 1

    with app.app_context():
        mtsm_a = db.session.get(MonthlyTestingSiteMonth, 94131)
        mtsm_b = db.session.get(MonthlyTestingSiteMonth, 94132)
        assert mtsm_a.session_route_stop_order == 0
        assert mtsm_b.session_route_stop_order == 1


def test_library_patch_syncs_open_prep_mtsm_from_master(stops_client):
    """Site details master edit should refresh open prep stop-month snapshots."""
    client, app = stops_client
    with app.app_context():
        route_id, ts_id, _ = _seed_route_with_two_stops()
        run = MonthlyRouteRun(
            id=95001,
            monthly_route_id=route_id,
            month_date=date(2026, 7, 1),
            status="open",
            source="technician_app",
            prepared_at=datetime(2026, 7, 1, 9, 0, tzinfo=PACIFIC_TZ),
        )
        mtsm = MonthlyTestingSiteMonth(
            id=95010,
            monthly_testing_site_id=ts_id,
            month_date=date(2026, 7, 1),
            run_id=95001,
            test_monthly_route_id=route_id,
            monitoring_notes="Stale prep notes",
            testing_procedures="Old procedures",
        )
        db.session.add_all([run, mtsm])
        db.session.commit()

    with client.session_transaction() as sess:
        sess["authenticated"] = True

    resp = client.patch(
        f"/api/monthly_sites/testing_sites/{ts_id}",
        json={
            "monitoring_notes": "Updated from library",
            "testing_procedures": "New procedures",
        },
    )
    assert resp.status_code == 200

    with app.app_context():
        refreshed = db.session.get(MonthlyTestingSiteMonth, 95010)
        assert refreshed is not None
        assert refreshed.monitoring_notes == "Updated from library"
        assert refreshed.testing_procedures == "New procedures"


def test_library_patch_skips_mtsm_after_field_work_starts(stops_client):
    client, app = stops_client
    with app.app_context():
        route_id, ts_id, _ = _seed_route_with_two_stops()
        run = MonthlyRouteRun(
            id=95002,
            monthly_route_id=route_id,
            month_date=date(2026, 7, 1),
            status="open",
            source="technician_app",
            started_at=datetime(2026, 7, 2, 8, 0, tzinfo=PACIFIC_TZ),
        )
        mtsm = MonthlyTestingSiteMonth(
            id=95011,
            monthly_testing_site_id=ts_id,
            month_date=date(2026, 7, 1),
            run_id=95002,
            test_monthly_route_id=route_id,
            monitoring_notes="Frozen during field work",
        )
        db.session.add_all([run, mtsm])
        db.session.commit()

    with client.session_transaction() as sess:
        sess["authenticated"] = True

    resp = client.patch(
        f"/api/monthly_sites/testing_sites/{ts_id}",
        json={"monitoring_notes": "Should not overwrite active run"},
    )
    assert resp.status_code == 200

    with app.app_context():
        refreshed = db.session.get(MonthlyTestingSiteMonth, 95011)
        assert refreshed is not None
        assert refreshed.monitoring_notes == "Frozen during field work"
