"""Office pre-run message and site highlight flags."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import MonthlyRoute, MonthlyRouteRun, db

PACIFIC_TZ = ZoneInfo("America/Vancouver")


@pytest.fixture
def prep_message_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    tables = [MonthlyRoute.__table__, MonthlyRouteRun.__table__]

    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["authenticated"] = True
                sess["username"] = "office_tester"
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


def _seed_route_run(app, *, started: bool = False, prepared: bool = True) -> None:
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=1, weekday_iso=0, week_occurrence=1)
        now = datetime.now(PACIFIC_TZ)
        run = MonthlyRouteRun(
            id=100,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            status="open",
            source="office_manual",
            prepared_at=now if prepared else None,
            started_at=now if started else None,
        )
        db.session.add_all([route, run])
        db.session.commit()


def test_patch_pre_run_message_in_prep_phase(prep_message_client):
    client, app = prep_message_client
    _seed_route_run(app)
    res = client.patch(
        "/api/monthly_routes/routes/1/runs",
        json={"month_date": "2026-05-01", "pre_run_message": "Check 123 Main"},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["run"]["pre_run_message"] == "Check 123 Main"


def test_patch_pre_run_message_blocked_after_field_start(prep_message_client):
    client, app = prep_message_client
    _seed_route_run(app, started=True)
    res = client.patch(
        "/api/monthly_routes/routes/1/runs",
        json={"month_date": "2026-05-01", "pre_run_message": "Too late"},
    )
    assert res.status_code == 409
    assert res.get_json().get("code") == "run_prep_locked"
