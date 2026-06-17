"""GET/POST dashboard bulk ServiceTrade job release endpoints."""

from __future__ import annotations

from datetime import date

import pytest

from app import create_app
from app.db_models import MonthlyRoute, MonthlyRouteRunTimingMonth, db
from tests.monthly_location_helpers import WORKSHEET_TABLES, seed_route_with_one_stop

DASHBOARD_MONTH = date(2026, 6, 1)


@pytest.fixture
def dashboard_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=WORKSHEET_TABLES)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["username"] = "office_tester"
                sess["authenticated"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(WORKSHEET_TABLES)))


def _patch_dashboard_month(monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: DASHBOARD_MONTH)


def test_st_job_release_status_requires_auth(dashboard_client, monkeypatch):
    client, _app = dashboard_client
    _patch_dashboard_month(monkeypatch)
    with client.session_transaction() as sess:
        sess["authenticated"] = False
    res = client.get("/api/monthly_routes/dashboard/st_job_release_status?month_date=2026-06-01")
    assert res.status_code == 401


def test_st_job_release_status_lists_eligible_scheduled_job(dashboard_client, monkeypatch):
    client, app = dashboard_client
    _patch_dashboard_month(monkeypatch)
    with app.app_context():
        seed_route_with_one_stop(route_id=1, route_number=2)
        route = db.session.get(MonthlyRoute, 1)
        assert route is not None
        route.service_trade_route_location_id = 5001
        db.session.add(
            MonthlyRouteRunTimingMonth(
                id=1,
                monthly_route_id=1,
                month_first=DASHBOARD_MONTH,
                service_trade_job_id=88001,
                sync_status="scheduled",
                service_trade_job_status="scheduled",
                service_trade_appointment_released=False,
            )
        )
        db.session.commit()

    res = client.get("/api/monthly_routes/dashboard/st_job_release_status?month_date=2026-06-01")
    assert res.status_code == 200
    body = res.get_json()
    assert body["eligible_count"] == 1
    assert body["action"] == "release"
    assert body["month_allowed"] is True


def test_st_job_release_status_past_month_not_allowed(dashboard_client, monkeypatch):
    client, _app = dashboard_client
    _patch_dashboard_month(monkeypatch)
    res = client.get("/api/monthly_routes/dashboard/st_job_release_status?month_date=2026-05-01")
    assert res.status_code == 200
    body = res.get_json()
    assert body["month_allowed"] is False
    assert body["action"] is None


def test_st_job_release_post_rejects_past_month(dashboard_client, monkeypatch):
    client, _app = dashboard_client
    _patch_dashboard_month(monkeypatch)
    res = client.post(
        "/api/monthly_routes/dashboard/st_job_release",
        json={"month_date": "2026-05-01", "action": "release"},
    )
    assert res.status_code == 400
    assert res.get_json()["code"] == "month_not_allowed"
