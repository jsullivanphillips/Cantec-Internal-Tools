"""Monitoring company directory API."""

from __future__ import annotations

import pytest

from app import create_app
from app.db_models import MonitoringCompany, db


@pytest.fixture
def monitoring_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    tables = [MonitoringCompany.__table__]

    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["username"] = "office.one"
                sess["authenticated"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


def test_create_and_list_monitoring_companies(monitoring_client):
    client, _app = monitoring_client
    create = client.post(
        "/api/monitoring_companies",
        json={"name": "Acme Monitoring", "primary_phone": "604-555-0100"},
    )
    assert create.status_code == 201
    body = create.get_json()
    assert body["company"]["name"] == "Acme Monitoring"
    assert body["company"]["primary_phone"] == "604-555-0100"

    dup = client.post("/api/monitoring_companies", json={"name": "acme monitoring"})
    assert dup.status_code == 200
    assert dup.get_json()["reused_existing"] is True

    listing = client.get("/api/monitoring_companies")
    assert listing.status_code == 200
    names = [row["name"] for row in listing.get_json()["companies"]]
    assert "Acme Monitoring" in names


def test_patch_monitoring_company(monitoring_client):
    client, app = monitoring_client
    with app.app_context():
        mc = MonitoringCompany(id=1, name="Old Name", name_normalized="old name", active=True)
        db.session.add(mc)
        db.session.commit()
        mc_id = int(mc.id)

    res = client.patch(
        f"/api/monitoring_companies/{mc_id}",
        json={"name": "New Name", "secondary_phone": "604-555-0200"},
    )
    assert res.status_code == 200
    assert res.get_json()["company"]["name"] == "New Name"
    assert res.get_json()["company"]["secondary_phone"] == "604-555-0200"
