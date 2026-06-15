"""GET /api/monthly_routes/dashboard — office monthlies landing payload."""

from __future__ import annotations

from datetime import date

import pytest

from app import create_app
from app.db_models import MonthlyRoute, db
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location, seed_route_with_one_stop
from tests.run_workflow_helpers import seed_prepared_started_run

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


def test_dashboard_route_without_run_omits_current_month_run(dashboard_client, monkeypatch):
    client, app = dashboard_client
    _patch_dashboard_month(monkeypatch)
    with app.app_context():
        seed_route_with_one_stop(route_id=1, route_number=2)

    res = client.get("/api/monthly_routes/dashboard")
    assert res.status_code == 200
    body = res.get_json()
    assert body["month_date"] == "2026-06-01"
    row = next(r for r in body["routes"] if r["route"]["id"] == 1)
    assert "current_month_run" not in row


def test_dashboard_includes_workflow_stage_for_current_month_run(dashboard_client, monkeypatch):
    client, app = dashboard_client
    _patch_dashboard_month(monkeypatch)
    with app.app_context():
        seed_route_with_one_stop(route_id=1, route_number=2)
        seed_prepared_started_run(1, DASHBOARD_MONTH, run_id=6001, prepared=True, started=False)

    res = client.get("/api/monthly_routes/dashboard")
    assert res.status_code == 200
    row = next(r for r in res.get_json()["routes"] if r["route"]["id"] == 1)
    assert row["current_month_run"]["workflow_stage"] == "prepared"
    assert row["current_month_run"]["run_id"] == 6001


def test_dashboard_field_ended_run_is_awaiting_office_review(dashboard_client, monkeypatch):
    client, app = dashboard_client
    _patch_dashboard_month(monkeypatch)
    with app.app_context():
        seed_route_with_one_stop(route_id=1, route_number=2)
        seed_prepared_started_run(
            1,
            DASHBOARD_MONTH,
            run_id=6002,
            prepared=True,
            started=True,
            field_ended=True,
        )

    res = client.get("/api/monthly_routes/dashboard")
    row = next(r for r in res.get_json()["routes"] if r["route"]["id"] == 1)
    assert row["current_month_run"]["workflow_stage"] == "awaiting_office_review"


def test_dashboard_completed_run(dashboard_client, monkeypatch):
    client, app = dashboard_client
    _patch_dashboard_month(monkeypatch)
    with app.app_context():
        seed_route_with_one_stop(route_id=1, route_number=2)
        seed_prepared_started_run(
            1,
            DASHBOARD_MONTH,
            run_id=6003,
            prepared=True,
            started=True,
            field_ended=True,
            review_complete=True,
            completed=True,
        )

    res = client.get("/api/monthly_routes/dashboard")
    row = next(r for r in res.get_json()["routes"] if r["route"]["id"] == 1)
    assert row["current_month_run"]["workflow_stage"] == "completed"


def test_dashboard_includes_annual_count_for_current_month(dashboard_client, monkeypatch):
    client, app = dashboard_client
    _patch_dashboard_month(monkeypatch)
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        june_annual = make_location(
            id=101,
            address="June Annual St",
            label="June Annual St",
            monthly_route_id=1,
            annual_month="June",
        )
        may_annual = make_location(
            id=102,
            address="May Annual St",
            label="May Annual St",
            monthly_route_id=1,
            annual_month="May",
        )
        no_annual = make_location(
            id=103,
            address="Monthly Only St",
            label="Monthly Only St",
            monthly_route_id=1,
            annual_month=None,
        )
        db.session.add_all([route, june_annual, may_annual, no_annual])
        db.session.commit()

    res = client.get("/api/monthly_routes/dashboard")
    assert res.status_code == 200
    row = next(r for r in res.get_json()["routes"] if r["route"]["id"] == 1)
    assert row["route"]["location_count"] == 3
    assert row["route"]["annual_count"] == 1


def test_dashboard_accepts_month_date_query_param(dashboard_client, monkeypatch):
    client, app = dashboard_client
    _patch_dashboard_month(monkeypatch)
    july = date(2026, 7, 1)
    with app.app_context():
        seed_route_with_one_stop(route_id=1, route_number=2)
        seed_prepared_started_run(1, july, run_id=7001, prepared=True, started=False)

    res = client.get("/api/monthly_routes/dashboard?month_date=2026-07-01")
    assert res.status_code == 200
    body = res.get_json()
    assert body["month_date"] == "2026-07-01"
    row = next(r for r in body["routes"] if r["route"]["id"] == 1)
    assert row["current_month_run"]["workflow_stage"] == "prepared"

    current = client.get("/api/monthly_routes/dashboard")
    current_row = next(r for r in current.get_json()["routes"] if r["route"]["id"] == 1)
    assert "current_month_run" not in current_row


def test_dashboard_rejects_invalid_month_date(dashboard_client, monkeypatch):
    client, _app = dashboard_client
    _patch_dashboard_month(monkeypatch)
    res = client.get("/api/monthly_routes/dashboard?month_date=not-a-month")
    assert res.status_code == 400


def test_dashboard_excludes_routes_without_active_locations(dashboard_client, monkeypatch):
    client, app = dashboard_client
    _patch_dashboard_month(monkeypatch)
    with app.app_context():
        route = MonthlyRoute(id=99, route_number=99, weekday_iso=0, week_occurrence=1)
        loc = make_location(
            id=9901,
            address="Inactive St",
            label="Inactive St",
            monthly_route_id=99,
            status_normalized="inactive",
            status_raw="Inactive",
        )
        db.session.add_all([route, loc])
        db.session.commit()

    res = client.get("/api/monthly_routes/dashboard")
    ids = [r["route"]["id"] for r in res.get_json()["routes"]]
    assert 99 not in ids
