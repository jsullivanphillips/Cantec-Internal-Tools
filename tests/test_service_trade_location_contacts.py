"""Tests for ServiceTrade site contact sync helpers."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from app import create_app
from app.db_models import MonthlyLocation, ServiceTradeSiteContact, db
from app.monthly.service_trade_location_contacts import (
    contact_has_reachable_info,
    contact_is_storable,
    parse_service_trade_contact_row,
    sync_service_trade_site_contacts,
)
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location


@pytest.fixture
def contact_sync_client(monkeypatch, tmp_path):
    db_file = tmp_path / "st_contacts.db"
    uri = f"sqlite:///{db_file.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", uri)
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = uri
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    tables = WORKSHEET_TABLES + [ServiceTradeSiteContact.__table__]

    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        yield app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


@pytest.mark.parametrize(
    ("contact", "expected"),
    [
        ({"email": "a@example.com"}, True),
        ({"phone": "250-555-0100"}, True),
        ({"mobile": "250-555-0101"}, True),
        ({"alternatePhone": "Front desk"}, True),
        ({"email": " ", "phone": ""}, False),
        ({"status": "inactive", "email": "a@example.com"}, False),
    ],
)
def test_contact_is_storable(contact, expected):
    assert contact_is_storable(contact) is expected


def test_contact_has_reachable_info_requires_non_blank_values():
    assert contact_has_reachable_info({"email": "  "}) is False
    assert contact_has_reachable_info({"phone": "x"}) is True


def test_parse_service_trade_contact_row_maps_fields():
    synced_at = datetime(2026, 6, 17, tzinfo=timezone.utc)
    row = parse_service_trade_contact_row(
        {
            "id": 99,
            "firstName": "Bianca",
            "lastName": "Lim",
            "email": "BLim@example.com",
            "phone": "250-880-1917",
            "mobile": "",
            "alternatePhone": "Building Manager",
            "type": "building manager",
            "status": "public",
        },
        service_trade_site_location_id=6470762,
        is_primary=True,
        synced_at=synced_at,
    )
    assert row["service_trade_contact_id"] == 99
    assert row["service_trade_site_location_id"] == 6470762
    assert row["email"] == "BLim@example.com"
    assert row["alternate_phone"] == "Building Manager"
    assert row["is_primary"] is True


def test_sync_service_trade_site_contacts_upserts_and_prunes(contact_sync_client):
    app = contact_sync_client
    with app.app_context():
        loc = make_location(
            id=1,
            address="465 Niagara Street",
            label="465 Niagara Street",
            service_trade_site_location_id=6470762,
        )
        db.session.add(loc)
        db.session.add(
            ServiceTradeSiteContact(
                id=1,
                service_trade_site_location_id=6470762,
                service_trade_contact_id=1,
                email="old@example.com",
            )
        )
        db.session.commit()

        http = MagicMock()

        def fake_get(url, params=None, **kwargs):
            response = MagicMock()
            if url.endswith("/contact"):
                response.raise_for_status = MagicMock()
                response.json.return_value = {
                    "data": {
                        "contacts": [
                            {
                                "id": 2,
                                "firstName": "Casey",
                                "lastName": "Lee",
                                "email": "casey@example.com",
                                "phone": "",
                                "mobile": "",
                                "alternatePhone": "",
                                "type": "site contact",
                                "status": "public",
                            },
                            {
                                "id": 3,
                                "firstName": "No",
                                "lastName": "Reach",
                                "email": "",
                                "phone": "",
                                "mobile": "",
                                "alternatePhone": "",
                                "status": "public",
                            },
                            {
                                "id": 4,
                                "firstName": "Inactive",
                                "lastName": "Person",
                                "email": "gone@example.com",
                                "status": "inactive",
                            },
                        ]
                    }
                }
                return response
            if url.endswith("/location/6470762"):
                response.raise_for_status = MagicMock()
                response.json.return_value = {
                    "data": {
                        "primaryContact": {"id": 2},
                    }
                }
                return response
            raise AssertionError(f"unexpected url {url}")

        http.get.side_effect = fake_get

        synced_at = datetime(2026, 6, 17, 12, 0, tzinfo=timezone.utc)
        result = sync_service_trade_site_contacts(
            http,
            6470762,
            synced_at=synced_at,
            commit=True,
        )

        assert result.contacts_upserted == 1
        assert result.contacts_deleted == 1
        assert result.has_email_contact is True
        assert result.has_phone_contact is False

        rows = ServiceTradeSiteContact.query.filter_by(service_trade_site_location_id=6470762).all()
        assert len(rows) == 1
        assert rows[0].service_trade_contact_id == 2
        assert rows[0].is_primary is True

        db.session.refresh(loc)
        assert loc.service_trade_contacts_synced_at.replace(tzinfo=timezone.utc) == synced_at
        assert loc.service_trade_has_contact_email is True
        assert loc.service_trade_has_contact_phone is False
