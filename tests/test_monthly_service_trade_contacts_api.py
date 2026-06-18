"""Tests for cached ServiceTrade contacts library API."""

from __future__ import annotations

from app import create_app
from app.db_models import ServiceTradeSiteContact, db
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location


def _client(monkeypatch, tmp_path):
    db_file = tmp_path / "st_contacts_api.db"
    uri = f"sqlite:///{db_file.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", uri)
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = uri
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    tables = WORKSHEET_TABLES + [ServiceTradeSiteContact.__table__]
    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["username"] = "staff"
                sess["authenticated"] = True
            yield client
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


def test_get_contacts_unlinked_location(monkeypatch, tmp_path):
    for client in _client(monkeypatch, tmp_path):
        loc = make_location(id=1, address="100 Test Ave", label="Tower")
        db.session.add(loc)
        db.session.commit()

        res = client.get("/api/monthly_routes/library/1/service_trade_contacts")
        assert res.status_code == 200
        body = res.get_json()
        assert body["has_service_trade_link"] is False
        assert body["contacts"] == []


def test_get_contacts_returns_cached_rows(monkeypatch, tmp_path):
    for client in _client(monkeypatch, tmp_path):
        loc = make_location(
            id=2,
            address="200 Test Ave",
            label="Site B",
            service_trade_site_location_id=6470762,
        )
        db.session.add(loc)
        db.session.add(
            ServiceTradeSiteContact(
                id=1,
                service_trade_site_location_id=6470762,
                service_trade_contact_id=99,
                first_name="Casey",
                last_name="Lee",
                email="casey@example.com",
                phone="250-555-0100",
                contact_type="site contact",
                is_primary=True,
            )
        )
        db.session.add(
            ServiceTradeSiteContact(
                id=2,
                service_trade_site_location_id=6470762,
                service_trade_contact_id=100,
                first_name="Alex",
                last_name="Kim",
                mobile="250-555-0101",
                is_primary=False,
            )
        )
        db.session.commit()

        res = client.get("/api/monthly_routes/library/2/service_trade_contacts")
        assert res.status_code == 200
        body = res.get_json()
        assert body["has_service_trade_link"] is True
        assert body["service_trade_site_location_id"] == 6470762
        assert len(body["contacts"]) == 2
        assert body["contacts"][0]["is_primary"] is True
        assert body["contacts"][0]["email"] == "casey@example.com"


def test_get_contacts_location_not_found(monkeypatch, tmp_path):
    for client in _client(monkeypatch, tmp_path):
        res = client.get("/api/monthly_routes/library/999/service_trade_contacts")
        assert res.status_code == 404
