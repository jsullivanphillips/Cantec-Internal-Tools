"""Live technician training route (R99) seed, reset, and portal demo API."""

from __future__ import annotations

from datetime import date

import pytest

from app import create_app
from app.db_models import (
    MonthlyLocation,
    MonthlyLocationMonth,
    MonthlyRoute,
    MonthlyRouteRun,
    MonthlyStopClockEvent,
    db,
)
from app.monthly.technician_demo_route import (
    DEFAULT_DEMO_ROUTE_NUMBER,
    demo_route_seeded,
    ensure_technician_demo_route,
    get_technician_demo_route,
    reset_technician_demo_route_month,
    technician_demo_route_number,
)
from tests.monthly_location_helpers import WORKSHEET_TABLES

FIXED_MONTH = date(2026, 6, 1)


@pytest.fixture
def demo_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setattr(
        "app.monthly.technician_demo_route._current_pacific_month_first",
        lambda: FIXED_MONTH,
    )
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=WORKSHEET_TABLES)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["tech_portal_unlocked"] = True
                sess["portal_tech_id"] = "demo-tech"
                sess["portal_tech_name"] = "Demo Tech"
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(WORKSHEET_TABLES)))


def test_technician_demo_route_number_default():
    assert technician_demo_route_number() == DEFAULT_DEMO_ROUTE_NUMBER


def test_ensure_technician_demo_route_creates_route_stops_and_run(demo_client):
    _client, app = demo_client
    with app.app_context():
        route = ensure_technician_demo_route()
        assert int(route.route_number) == DEFAULT_DEMO_ROUTE_NUMBER
        assert route.display_name == "Training demo"

        stops = (
            MonthlyLocation.query.filter_by(monthly_route_id=int(route.id))
            .order_by(MonthlyLocation.route_stop_order.asc())
            .all()
        )
        assert len(stops) == 5
        assert all((loc.address or "").startswith("[DEMO]") for loc in stops)

        run = MonthlyRouteRun.query.filter_by(
            monthly_route_id=int(route.id),
            month_date=FIXED_MONTH,
        ).one()
        assert run.prepared_at is not None
        assert run.started_at is not None
        assert demo_route_seeded() is True


def test_demo_worksheet_returns_five_pending_stops(demo_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: FIXED_MONTH)

    client, app = demo_client
    with app.app_context():
        route = ensure_technician_demo_route()
        route_id = int(route.id)

    res = client.get(
        f"/api/monthly_routes/routes/{route_id}/worksheet?month={FIXED_MONTH.isoformat()}"
    )
    assert res.status_code == 200
    body = res.get_json()
    stops = body.get("stops") or body.get("locations") or []
    assert len(stops) == 5

    for stop in stops:
        assert not (stop.get("test_outcome") or "").strip()
        assert not (stop.get("result_status") or "").strip()
        assert not stop.get("clock_events")


def test_reset_restores_baseline_after_edits(demo_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: FIXED_MONTH)

    client, app = demo_client
    with app.app_context():
        route = ensure_technician_demo_route()
        route_id = int(route.id)
        first_stop = (
            MonthlyLocation.query.filter_by(
                monthly_route_id=route_id,
                route_stop_order=0,
            ).one()
        )
        first_stop_id = int(first_stop.id)
        row = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=first_stop_id,
            month_date=FIXED_MONTH,
        ).one()
        row.test_outcome = "failed"
        row.result_status = "tested"
        db.session.commit()

    reset_res = client.post(
        "/api/technician_portal/demo/reset",
        json={"confirm": True},
    )
    assert reset_res.status_code == 200
    assert reset_res.get_json().get("ok") is True

    with app.app_context():
        row = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=first_stop_id,
            month_date=FIXED_MONTH,
        ).one()
        assert row.test_outcome is None
        assert row.result_status is None


def test_portal_demo_info_when_seeded(demo_client):
    client, app = demo_client
    with app.app_context():
        ensure_technician_demo_route()

    res = client.get("/api/technician_portal/demo")
    assert res.status_code == 200
    body = res.get_json()
    assert body["seeded"] is True
    assert body["route"]["route_number"] == DEFAULT_DEMO_ROUTE_NUMBER
    assert body["route"]["location_count"] == 5
    assert body["office_paperwork_path"].startswith("/monthlies/routes/")
    assert len(body["training_steps"]) >= 3


def test_portal_demo_info_when_not_seeded(demo_client):
    client, _app = demo_client
    res = client.get("/api/technician_portal/demo")
    assert res.status_code == 200
    body = res.get_json()
    assert body["seeded"] is False
    assert body["route"] is None
    assert body["seed_hint"]


def test_portal_demo_reset_requires_confirm(demo_client):
    client, app = demo_client
    with app.app_context():
        ensure_technician_demo_route()

    res = client.post("/api/technician_portal/demo/reset", json={})
    assert res.status_code == 400
    assert res.get_json().get("code") == "confirm_required"


def test_reset_technician_demo_route_month_clears_clock_events(demo_client):
    _client, app = demo_client
    with app.app_context():
        ensure_technician_demo_route()
        route = get_technician_demo_route()
        assert route is not None
        assert MonthlyStopClockEvent.query.count() == 0

        row = (
            MonthlyLocationMonth.query.join(MonthlyLocation)
            .filter(
                MonthlyLocation.monthly_route_id == int(route.id),
                MonthlyLocation.route_stop_order == 0,
                MonthlyLocationMonth.month_date == FIXED_MONTH,
            )
            .one()
        )
        db.session.add(
            MonthlyStopClockEvent(
                id=1,
                monthly_location_month_id=int(row.id),
                sort_order=0,
                time_in_raw="8:00 AM",
                time_out_raw=None,
            )
        )
        db.session.commit()
        assert MonthlyStopClockEvent.query.count() == 1

        reset_technician_demo_route_month()

        assert MonthlyStopClockEvent.query.count() == 0


def test_existing_route_number_is_reused_for_demo_seed(demo_client):
    _client, app = demo_client
    with app.app_context():
        existing = MonthlyRoute(
            id=990,
            route_number=DEFAULT_DEMO_ROUTE_NUMBER,
            weekday_iso=2,
            week_occurrence=2,
            display_name="Real route using R99",
        )
        db.session.add(existing)
        db.session.commit()

        route = ensure_technician_demo_route()
        assert int(route.id) == 990
        assert route.display_name == "Training demo"
