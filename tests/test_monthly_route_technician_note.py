"""Route-level technician_note (office route detail → portal worksheet header)."""

from __future__ import annotations

from datetime import date

import pytest

from app import create_app
from app.db_models import MonthlyRoute, MonthlyRouteComment, MonthlyRouteRun, db
from tests.monthly_location_helpers import WORKSHEET_TABLES, seed_route_with_one_stop

TECHNICIAN_NOTE_TABLES = [*WORKSHEET_TABLES, MonthlyRouteComment.__table__]


@pytest.fixture
def technician_note_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=TECHNICIAN_NOTE_TABLES)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["authenticated"] = True
                sess["username"] = "office_tester"
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(TECHNICIAN_NOTE_TABLES)))


def _seed_route(app) -> None:
    with app.app_context():
        seed_route_with_one_stop()
        run = MonthlyRouteRun(
            id=500,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            status="open",
            source="office_manual",
        )
        db.session.add(run)
        db.session.commit()


def test_patch_technician_note_sets_and_clears(technician_note_client):
    client, app = technician_note_client
    _seed_route(app)

    res = client.patch(
        "/api/monthly_routes/routes/1",
        json={"technician_note": "Plan extra time at stop 4"},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["ok"] is True
    assert body["route"]["technician_note"] == "Plan extra time at stop 4"

    with app.app_context():
        row = db.session.get(MonthlyRoute, 1)
        assert row is not None
        assert row.technician_note == "Plan extra time at stop 4"

    res_clear = client.patch(
        "/api/monthly_routes/routes/1",
        json={"technician_note": "   "},
    )
    assert res_clear.status_code == 200
    assert res_clear.get_json()["route"]["technician_note"] is None

    with app.app_context():
        row = db.session.get(MonthlyRoute, 1)
        assert row is not None
        assert row.technician_note is None


def test_worksheet_includes_technician_note_for_tech_portal(technician_note_client):
    client, app = technician_note_client
    with app.app_context():
        seed_route_with_one_stop(route_id=1, location_id=101, route_number=7)
        route = db.session.get(MonthlyRoute, 1)
        assert route is not None
        route.technician_note = "Check FACP at stop 2"
        run = MonthlyRouteRun(
            id=501,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            status="open",
            source="office_manual",
        )
        db.session.add(run)
        db.session.commit()

    res = client.get(
        "/api/monthly_routes/routes/1/worksheet?month=2026-05-01&tech_portal=1"
    )
    assert res.status_code == 200
    assert res.get_json()["route"]["technician_note"] == "Check FACP at stop 2"


def test_patch_technician_note_requires_username(technician_note_client):
    client, app = technician_note_client
    _seed_route(app)

    with client.session_transaction() as sess:
        sess.pop("username", None)

    res = client.patch(
        "/api/monthly_routes/routes/1",
        json={"technician_note": "Should fail"},
    )
    assert res.status_code == 401
