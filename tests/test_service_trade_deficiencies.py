"""Tests for ServiceTrade deficiency lookup by monthly library location."""

from __future__ import annotations

import pytest

from app import create_app
from app.db_models import db
from app.monthly.service_trade_deficiencies import (
    _is_open_deficiency,
    _parse_created_deficiency_id,
    _st_deficiency_description,
    normalize_office_service_line_key,
    office_service_line_asset_types,
    office_service_line_service_trade_id,
    resolve_st_asset_id_for_service_line,
    serialize_service_trade_deficiency,
)
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location


@pytest.fixture
def st_def_client(monkeypatch, tmp_path):
    db_file = tmp_path / "st_def.db"
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


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        ("new", True),
        ("verified", True),
        ("open", True),
        ("fixed", False),
        ("invalid", False),
        ("FIXED", False),
    ],
)
def test_is_open_deficiency(status, expected):
    assert _is_open_deficiency({"status": status}) is expected


def test_serialize_service_trade_deficiency():
    row = serialize_service_trade_deficiency(
        {
            "id": 2036741323234497,
            "status": "new",
            "severity": "deficient",
            "description": "Panel trouble",
            "reportedOn": 1710000000,
            "serviceLine": {"name": "Fire Alarm"},
        }
    )
    assert row["deficiency_id"] == 2036741323234497
    assert row["status"] == "new"
    assert row["severity"] == "deficient"
    assert row["description"] == "Panel trouble"
    assert row["service_line"] == "Fire Alarm"
    assert row["reported_on"] is not None
    assert row["url"] == "https://app.servicetrade.com/deficiency/details/id/2036741323234497"


def test_service_trade_deficiencies_requires_link(st_def_client):
    loc_id = _seed_location()
    res = st_def_client.get(f"/api/monthly_routes/library/{loc_id}/service_trade_deficiencies")
    assert res.status_code == 400
    assert res.get_json()["code"] == "no_servicetrade_link"


def test_service_trade_deficiencies_returns_payload(st_def_client, monkeypatch):
    loc_id = _seed_location(service_trade_site_location_id=555123)

    def fake_fetch(st_location_id, **kwargs):
        assert st_location_id == 555123
        return [
            {
                "deficiency_id": 99,
                "status": "new",
                "severity": "deficient",
                "description": "Test",
                "reported_on": "2026-01-15T12:00:00+00:00",
                "service_line": "Fire Alarm",
                "url": "https://app.servicetrade.com/deficiency/details/id/99",
            }
        ]

    monkeypatch.setattr(
        "app.monthly.service_trade_deficiencies.fetch_service_trade_deficiencies_for_location",
        fake_fetch,
    )

    res = st_def_client.get(f"/api/monthly_routes/library/{loc_id}/service_trade_deficiencies")
    assert res.status_code == 200, res.get_data(as_text=True)
    body = res.get_json()
    assert body["location_id"] == loc_id
    assert body["service_trade_site_location_id"] == 555123
    assert len(body["deficiencies"]) == 1
    assert body["deficiencies"][0]["deficiency_id"] == 99


@pytest.mark.parametrize(
    ("key", "expected_id"),
    [
        ("alarm_system", 1),
        ("emergency_light", 2),
        ("extinguishers", 3),
    ],
)
def test_office_service_line_service_trade_id(key, expected_id):
    assert office_service_line_service_trade_id(key) == expected_id


def test_normalize_office_service_line_key_rejects_unknown():
    with pytest.raises(ValueError, match="invalid_service_line"):
        normalize_office_service_line_key("sprinkler")


def test_st_deficiency_description_prefers_body():
    text = _st_deficiency_description("Bell offline", "No sound at panel")
    assert text == "No sound at panel"


def test_st_deficiency_description_falls_back_to_title():
    assert _st_deficiency_description("Bell offline", "") == "Bell offline"
    assert _st_deficiency_description("Bell offline", None) == "Bell offline"


def test_office_service_line_asset_types():
    assert office_service_line_asset_types("emergency_light") == frozenset({"elight"})


def test_resolve_st_asset_id_for_service_line():
    asset_id = resolve_st_asset_id_for_service_line(
        [
            {"id": 50, "type": "extinguisher", "name": "FE-1"},
            {"id": 123, "type": "elight", "name": "Kitchen EL"},
        ],
        "emergency_light",
    )
    assert asset_id == 123


def test_resolve_st_asset_id_for_service_line_missing():
    with pytest.raises(ValueError, match="no_servicetrade_asset"):
        resolve_st_asset_id_for_service_line([{"id": 50, "type": "extinguisher"}], "alarm_system")


def test_parse_created_deficiency_id_from_flat_response():
    assert _parse_created_deficiency_id({"id": 999}) == 999


def test_parse_created_deficiency_id_from_nested_response():
    assert _parse_created_deficiency_id({"deficiency": {"id": 888}}) == 888


def test_service_trade_deficiencies_location_not_found(st_def_client):
    res = st_def_client.get("/api/monthly_routes/library/99999/service_trade_deficiencies")
    assert res.status_code == 404

