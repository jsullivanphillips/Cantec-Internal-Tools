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
    MonthlyTestingSite,
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
    ]

    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["tech_portal_unlocked"] = True
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

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        _seed_route_with_two_stops()

    res = client.get("/api/monthly_routes/routes/1/worksheet?month=2026-05-01&tech_portal=1")
    assert res.status_code == 200
    body = res.get_json()
    assert body.get("run") is None
    stops = body.get("stops") or []
    assert len(stops) == 2
    assert stops[0]["display_address"] == "123 Test St"
    assert stops[0]["history_month_row_id"] == 0


def test_portal_start_materializes_stops(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        route_id, ts_primary, ts_second = _seed_route_with_two_stops()

    post = client.post("/api/technician_portal/routes/1/runs")
    assert post.status_code == 200

    res = client.get("/api/monthly_routes/routes/1/worksheet?month=2026-05-01&tech_portal=1")
    body = res.get_json()
    assert body["run"]["started_at"] is not None
    stops = body["stops"]
    assert len(stops) == 2
    by_id = {int(s["testing_site_id"]): s for s in stops}
    assert by_id[ts_primary]["history_month_row_id"] > 0
    assert by_id[ts_second]["history_month_row_id"] > 0

    with app.app_context():
        assert MonthlyTestingSiteMonth.query.filter_by(month_date=date(2026, 5, 1)).count() == 2


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
