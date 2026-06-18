"""Route-level display_name (office route detail label suffix)."""

from __future__ import annotations

import pytest

from app import create_app
from app.db_models import MonthlyRoute, MonthlyRouteComment, db
from app.monthly.route_display import (
    DISPLAY_NAME_MAX_LEN,
    monthly_route_display_label,
    monthly_route_schedule_label,
    normalize_route_display_name,
)
from tests.monthly_location_helpers import WORKSHEET_TABLES, seed_route_with_one_stop

DISPLAY_NAME_TABLES = [*WORKSHEET_TABLES, MonthlyRouteComment.__table__]


@pytest.fixture
def display_name_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=DISPLAY_NAME_TABLES)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["authenticated"] = True
                sess["username"] = "office_tester"
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(DISPLAY_NAME_TABLES)))


def test_normalize_route_display_name():
    assert normalize_route_display_name(None) is None
    assert normalize_route_display_name("  ") is None
    assert normalize_route_display_name("  Thrifty's 2  ") == "Thrifty's 2"
    assert len(normalize_route_display_name("x" * 300) or "") == DISPLAY_NAME_MAX_LEN


def test_monthly_route_display_label_format():
    route = MonthlyRoute(
        id=1,
        route_number=17,
        weekday_iso=0,
        week_occurrence=3,
        display_name="Thrifty's 2",
    )
    assert monthly_route_schedule_label(route) == "R17 · 3rd Monday"
    assert monthly_route_display_label(route) == "R17 · 3rd Monday · Thrifty's 2"
    route.display_name = None
    assert monthly_route_display_label(route) == "R17 · 3rd Monday"


def test_patch_display_name_sets_updates_and_clears(display_name_client):
    client, app = display_name_client
    with app.app_context():
        seed_route_with_one_stop(route_number=17)
        route = db.session.get(MonthlyRoute, 1)
        assert route is not None
        route.weekday_iso = 0
        route.week_occurrence = 3
        db.session.commit()

    res = client.patch(
        "/api/monthly_routes/routes/1",
        json={"display_name": "Thrifty's 2"},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["ok"] is True
    assert body["route"]["display_name"] == "Thrifty's 2"
    assert body["route"]["label"] == "R17 · 3rd Monday"
    assert body["route"]["display_label"] == "R17 · 3rd Monday · Thrifty's 2"

    with app.app_context():
        row = db.session.get(MonthlyRoute, 1)
        assert row is not None
        assert row.display_name == "Thrifty's 2"

    res_update = client.patch(
        "/api/monthly_routes/routes/1",
        json={"display_name": "  Updated name  "},
    )
    assert res_update.status_code == 200
    assert res_update.get_json()["route"]["display_name"] == "Updated name"

    res_clear = client.patch(
        "/api/monthly_routes/routes/1",
        json={"display_name": None},
    )
    assert res_clear.status_code == 200
    assert res_clear.get_json()["route"]["display_name"] is None
    assert res_clear.get_json()["route"]["display_label"] == "R17 · 3rd Monday"

    with app.app_context():
        row = db.session.get(MonthlyRoute, 1)
        assert row is not None
        assert row.display_name is None


def test_patch_display_name_requires_username(display_name_client):
    client, app = display_name_client
    with app.app_context():
        seed_route_with_one_stop()

    with client.session_transaction() as sess:
        sess.pop("username", None)

    res = client.patch(
        "/api/monthly_routes/routes/1",
        json={"display_name": "Should fail"},
    )
    assert res.status_code == 401


def test_patch_display_name_rejects_non_string(display_name_client):
    client, app = display_name_client
    with app.app_context():
        seed_route_with_one_stop()

    res = client.patch(
        "/api/monthly_routes/routes/1",
        json={"display_name": 123},
    )
    assert res.status_code == 400
