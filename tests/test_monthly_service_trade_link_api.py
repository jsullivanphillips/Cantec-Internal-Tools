"""PATCH /api/monthly_routes/library/:id/service_trade_link."""

from __future__ import annotations

import pytest

from app import create_app
from app.db_models import MonthlyLocation, db
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location


@pytest.fixture
def link_client(monkeypatch, tmp_path):
    db_file = tmp_path / "st_link.db"
    uri = f"sqlite:///{db_file.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", uri)
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = uri
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=WORKSHEET_TABLES)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["username"] = "staff"
                sess["authenticated"] = True
            yield client
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(WORKSHEET_TABLES)))


def _seed_location(**extra) -> int:
    loc = make_location(
        id=42,
        address="100 Test Ave",
        label="Tower A",
        **extra,
    )
    db.session.add(loc)
    db.session.commit()
    return int(loc.id)


def test_library_get_includes_service_trade_link_fields(link_client, monkeypatch):
    loc_id = _seed_location(service_trade_site_location_id=987654)
    res = link_client.get(f"/api/monthly_routes/library/{loc_id}")
    assert res.status_code == 200
    loc = res.get_json()["location"]
    assert loc["service_trade_site_location_id"] == 987654
    assert loc["service_trade_site_location_url"].endswith("/987654")


def test_service_trade_link_set_and_clear(link_client, monkeypatch):
    monkeypatch.setattr(
        "app.monthly.service_trade_site_match.verify_service_trade_location_exists",
        lambda st_id, **kwargs: True,
    )
    loc_id = _seed_location()

    set_res = link_client.patch(
        f"/api/monthly_routes/library/{loc_id}/service_trade_link",
        json={"service_trade_site_location_id": 123456},
    )
    assert set_res.status_code == 200, set_res.get_data(as_text=True)
    body = set_res.get_json()["location"]
    assert body["service_trade_site_location_id"] == 123456

    clear_res = link_client.patch(
        f"/api/monthly_routes/library/{loc_id}/service_trade_link",
        json={"service_trade_site_location_id": None},
    )
    assert clear_res.status_code == 200
    assert clear_res.get_json()["location"]["service_trade_site_location_id"] is None


def test_service_trade_link_allows_duplicate_id(link_client, monkeypatch):
    monkeypatch.setattr(
        "app.monthly.service_trade_site_match.verify_service_trade_location_exists",
        lambda st_id, **kwargs: True,
    )
    _seed_location(service_trade_site_location_id=555001)
    loc = make_location(
        id=43,
        address="200 Other Ave",
        label="Tower B",
    )
    db.session.add(loc)
    db.session.commit()
    loc_id = int(loc.id)

    res = link_client.patch(
        f"/api/monthly_routes/library/{loc_id}/service_trade_link",
        json={"service_trade_site_location_id": 555001},
    )
    assert res.status_code == 200, res.get_data(as_text=True)
    assert res.get_json()["location"]["service_trade_site_location_id"] == 555001


def test_service_trade_link_rejects_missing_location(link_client, monkeypatch):
    monkeypatch.setattr(
        "app.monthly.service_trade_site_match.verify_service_trade_location_exists",
        lambda st_id, **kwargs: False,
    )
    loc_id = _seed_location()

    res = link_client.patch(
        f"/api/monthly_routes/library/{loc_id}/service_trade_link",
        json={"service_trade_site_location_id": 999999},
    )
    assert res.status_code == 404
    assert res.get_json()["code"] == "service_trade_location_not_found"

    row = db.session.get(MonthlyLocation, loc_id)
    assert row is not None
    assert row.service_trade_site_location_id is None
