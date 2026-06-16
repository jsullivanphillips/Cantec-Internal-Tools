"""Route key audit API."""

from __future__ import annotations

import pytest

from app import create_app
from app.db_models import Key, KeyAddress, KeyStatus, MonthlyLocation, MonthlyRoute, db
from tests.monthly_location_helpers import make_location


@pytest.fixture
def key_audit_client(monkeypatch, tmp_path):
    db_file = tmp_path / "key_audit.db"
    uri = f"sqlite:///{db_file.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", uri)
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = uri
    tables = [
        Key.__table__,
        KeyAddress.__table__,
        KeyStatus.__table__,
        MonthlyRoute.__table__,
        MonthlyLocation.__table__,
    ]
    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        yield app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


def _seed_route_audit_scenario():
    route = MonthlyRoute(id=1, route_number=7, weekday_iso=2, week_occurrence=1)
    bag = Key(id=1, keycode="R7", route="R7")
    on_bag = Key(id=2, keycode="GOOD 1", route="R7")
    wrong_route = Key(id=3, keycode="WRONG 1", route="R3")
    extra = Key(id=4, keycode="EXTRA 1", route="R7")
    loc_linked = make_location(
        id=101,
        address="10 Oak",
        keys="GOOD 1",
        key_id=2,
        monthly_route_id=1,
        route_stop_order=0,
    )
    loc_unlinked = make_location(
        id=102,
        address="20 Oak",
        keys="MISSING 9",
        key_id=None,
        monthly_route_id=1,
        route_stop_order=1,
    )
    loc_wrong = make_location(
        id=103,
        address="30 Oak",
        keys="WRONG 1",
        key_id=3,
        monthly_route_id=1,
        route_stop_order=2,
    )
    loc_no_key = make_location(
        id=104,
        address="40 Oak",
        keys="No keys",
        key_id=None,
        monthly_route_id=1,
        route_stop_order=3,
    )
    db.session.add_all(
        [
            route,
            bag,
            on_bag,
            wrong_route,
            extra,
            loc_linked,
            loc_unlinked,
            loc_wrong,
            loc_no_key,
        ]
    )
    db.session.add(
        KeyStatus(
            id=1,
            key_id=2,
            status="Signed Out",
            key_location="Other tech",
            is_on_monthly=False,
        )
    )
    db.session.commit()


def test_key_audit_buckets(key_audit_client):
    with key_audit_client.app_context(), key_audit_client.test_client() as client:
        _seed_route_audit_scenario()
        with client.session_transaction() as sess:
            sess["username"] = "office.test"
            sess["authenticated"] = True
        res = client.get("/api/monthly_routes/routes/1/key_audit")
        assert res.status_code == 200
        body = res.get_json()
        c = body["counts"]
        assert c["stops_requiring_key"] == 3
        assert c["unlinked"] == 1
        assert c["wrong_route"] == 1
        assert c["extra_in_bag"] == 1
        assert c["unavailable"] == 1
        assert body["bag_code"] == "R7"
