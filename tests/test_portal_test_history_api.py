"""Portal test history index API for the site history modal."""

from __future__ import annotations

from datetime import date, datetime

import pytest

from app import create_app
from app.db_models import MonthlyLocationMonth, MonthlyRouteRun, db
from tests.monthly_location_helpers import WORKSHEET_TABLES, seed_route_with_one_stop


@pytest.fixture
def portal_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=WORKSHEET_TABLES)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["tech_portal_unlocked"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(WORKSHEET_TABLES)))


def test_test_history_index_requires_portal_unlock(portal_client):
    client, _app = portal_client
    with client.session_transaction() as sess:
        sess.pop("tech_portal_unlocked", None)
    res = client.get("/api/technician_portal/locations/101/test_history_index")
    assert res.status_code == 401


def test_test_history_index_not_found(portal_client):
    client, _app = portal_client
    res = client.get("/api/technician_portal/locations/999/test_history_index")
    assert res.status_code == 404


def test_test_history_index_no_history(portal_client):
    client, app = portal_client
    with app.app_context():
        _route_id, location_id = seed_route_with_one_stop()

    res = client.get(f"/api/technician_portal/locations/{location_id}/test_history_index")
    assert res.status_code == 200
    body = res.get_json()
    assert body["months"] == {}
    assert body["latest_submission_month"] is None
    assert body["monthly_route_id"] == 1


def test_test_history_index_run_without_field_end(portal_client):
    client, app = portal_client
    with app.app_context():
        route_id, location_id = seed_route_with_one_stop()
        run = MonthlyRouteRun(
            id=9001,
            monthly_route_id=route_id,
            month_date=date(2026, 4, 1),
        )
        mlm = MonthlyLocationMonth(
            id=5001,
            monthly_location_id=location_id,
            month_date=date(2026, 4, 1),
            result_status="tested",
            run_id=9001,
            test_monthly_route_id=route_id,
        )
        db.session.add_all([run, mlm])
        db.session.commit()

    res = client.get(f"/api/technician_portal/locations/{location_id}/test_history_index")
    assert res.status_code == 200
    body = res.get_json()
    assert body["months"]["2026-04-01"]["has_field_submission"] is False
    assert body["months"]["2026-04-01"]["route_id"] == route_id
    assert body["latest_submission_month"] is None


def test_test_history_index_with_field_submission(portal_client):
    client, app = portal_client
    with app.app_context():
        route_id, location_id = seed_route_with_one_stop()
        run_april = MonthlyRouteRun(
            id=9001,
            monthly_route_id=route_id,
            month_date=date(2026, 4, 1),
            field_ended_at=datetime(2026, 4, 30, 17, 0),
        )
        run_may = MonthlyRouteRun(
            id=9002,
            monthly_route_id=route_id,
            month_date=date(2026, 5, 1),
            field_ended_at=datetime(2026, 5, 31, 17, 0),
        )
        mlm_april = MonthlyLocationMonth(
            id=5001,
            monthly_location_id=location_id,
            month_date=date(2026, 4, 1),
            result_status="tested",
            run_id=9001,
            test_monthly_route_id=route_id,
        )
        mlm_may = MonthlyLocationMonth(
            id=5002,
            monthly_location_id=location_id,
            month_date=date(2026, 5, 1),
            result_status="tested",
            run_id=9002,
            test_monthly_route_id=route_id,
        )
        db.session.add_all([run_april, run_may, mlm_april, mlm_may])
        db.session.commit()

    res = client.get(f"/api/technician_portal/locations/{location_id}/test_history_index")
    assert res.status_code == 200
    body = res.get_json()
    assert body["months"]["2026-04-01"]["has_field_submission"] is True
    assert body["months"]["2026-05-01"]["has_field_submission"] is True
    assert body["latest_submission_month"] == "2026-05-01"
