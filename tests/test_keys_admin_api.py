"""Staff-only keys CRUD API."""

from __future__ import annotations

import pytest

from app import create_app
from app.db_models import Key, KeyAddress, KeyStatus, MonthlyKeyBridge, MonthlyLocation, db


@pytest.fixture
def keys_admin_client(monkeypatch, tmp_path):
    db_file = tmp_path / "keys_admin.db"
    uri = f"sqlite:///{db_file.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", uri)
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = uri
    tables = [
        Key.__table__,
        KeyAddress.__table__,
        KeyStatus.__table__,
        MonthlyLocation.__table__,
        MonthlyKeyBridge.__table__,
    ]
    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        yield app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


def _staff(client):
    with client.session_transaction() as sess:
        sess["username"] = "office.test"
        sess["authenticated"] = True


def test_create_key_requires_staff(keys_admin_client):
    with keys_admin_client.test_client() as client:
        res = client.post(
            "/api/keys",
            json={"keycode": "ABC 100"},
        )
        assert res.status_code == 401


def test_create_and_patch_key(keys_admin_client):
    with keys_admin_client.app_context(), keys_admin_client.test_client() as client:
        _staff(client)
        res = client.post(
            "/api/keys",
            json={
                "keycode": "ABC 100",
                "barcode": 1001,
                "route": "R2",
                "addresses": ["10 Oak St"],
            },
        )
        assert res.status_code == 201
        body = res.get_json()
        assert body["key"]["keycode"] == "ABC 100"
        kid = body["key"]["id"]

        res2 = client.patch(f"/api/keys/{kid}", json={"area": "North"})
        assert res2.status_code == 200
        assert res2.get_json()["key"]["area"] == "North"


def test_duplicate_keycode_409(keys_admin_client):
    with keys_admin_client.app_context(), keys_admin_client.test_client() as client:
        _staff(client)
        client.post("/api/keys", json={"keycode": "DUP 1"})
        res = client.post("/api/keys", json={"keycode": "dup 1"})
        assert res.status_code == 409


def test_delete_blocked_by_monthly_location(keys_admin_client):
    from tests.monthly_location_helpers import make_location

    with keys_admin_client.app_context(), keys_admin_client.test_client() as client:
        key = Key(id=50, keycode="BLK 50")
        loc = make_location(id=1, address="1 Main", key_id=50)
        db.session.add_all([key, loc])
        db.session.commit()
        _staff(client)
        res = client.delete("/api/keys/50")
        assert res.status_code == 409
        assert res.get_json()["code"] == "monthly_location_linked"


def test_delete_blocked_by_bridge(keys_admin_client):
    with keys_admin_client.app_context(), keys_admin_client.test_client() as client:
        key = Key(id=60, keycode="BRG 60")
        db.session.add(key)
        db.session.add(
            MonthlyKeyBridge(
                key_id=60,
                source="monthly_location",
            )
        )
        db.session.commit()
        _staff(client)
        res = client.delete("/api/keys/60")
        assert res.status_code == 409
        assert res.get_json()["code"] == "key_bridge_blocked"


def test_delete_bridge_row_then_key(keys_admin_client):
    with keys_admin_client.app_context(), keys_admin_client.test_client() as client:
        key = Key(id=61, keycode="BRG 61")
        db.session.add(key)
        db.session.flush()
        bridge = MonthlyKeyBridge(key_id=61, source="monthly_location", display_address="1 Main")
        db.session.add(bridge)
        db.session.commit()
        bridge_id = int(bridge.id)
        _staff(client)

        blockers = client.get("/api/keys/61/delete_blockers").get_json()["blockers"]
        assert blockers["bridge_rows"] == 1
        assert len(blockers["bridge_row_details"]) == 1
        assert blockers["bridge_row_details"][0]["id"] == bridge_id

        res = client.delete(f"/api/keys/61/bridge_rows/{bridge_id}")
        assert res.status_code == 200
        assert res.get_json()["blockers"]["bridge_rows"] == 0

        res2 = client.delete("/api/keys/61")
        assert res2.status_code == 204


def test_delete_all_bridge_rows_requires_staff(keys_admin_client):
    with keys_admin_client.app_context(), keys_admin_client.test_client() as client:
        key = Key(id=62, keycode="BRG 62")
        db.session.add(key)
        db.session.add(MonthlyKeyBridge(key_id=62, source="monthly_location"))
        db.session.commit()
        res = client.delete("/api/keys/62/bridge_rows")
        assert res.status_code == 401


def test_delete_key_success(keys_admin_client):
    with keys_admin_client.app_context(), keys_admin_client.test_client() as client:
        db.session.add(Key(id=70, keycode="DEL 70"))
        db.session.commit()
        _staff(client)
        res = client.delete("/api/keys/70")
        assert res.status_code == 204
        assert Key.query.get(70) is None
