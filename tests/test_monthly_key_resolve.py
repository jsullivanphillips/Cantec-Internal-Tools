import itertools

import pytest
from sqlalchemy import select

from app import create_app
from app.db_models import Key, MonthlyRoute, MonthlyRouteLocation, db
from app.monthly.key_resolve import (
    keycode_cf_to_key_id_map,
    resolve_key_id_for_monthly_fields,
    sync_key_fk_for_location,
)


@pytest.fixture
def key_link_tables(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(
            db.engine,
            tables=[
                MonthlyRoute.__table__,
                Key.__table__,
                MonthlyRouteLocation.__table__,
            ],
        )
        yield app
        db.session.remove()
        db.metadata.drop_all(
            db.engine,
            tables=[
                MonthlyRouteLocation.__table__,
                Key.__table__,
                MonthlyRoute.__table__,
            ],
        )


_loc_seq = itertools.count(1)


def _monthly_loc(**kwargs):
    defaults = {
        "id": next(_loc_seq),
        "address": "10 Oak St",
        "address_normalized": "10 oak st",
        "property_management_company": "PM",
        "property_management_company_normalized": "pm",
        "building": None,
        "building_normalized": "",
        "status_normalized": "active",
        "status_raw": "Active",
    }
    defaults.update(kwargs)
    return MonthlyRouteLocation(**defaults)


def test_resolve_by_barcode_unique(key_link_tables):
    with key_link_tables.app_context():
        db.session.add(Key(id=1, keycode="1001", barcode=4242))
        db.session.commit()

        assert resolve_key_id_for_monthly_fields("4242", "ignored legacy") == 1


def test_ambiguous_barcode_falls_through_to_keycode(key_link_tables):
    with key_link_tables.app_context():
        db.session.add(Key(id=1, keycode="AAA", barcode=7))
        db.session.add(Key(id=2, keycode="BBB", barcode=7))
        db.session.add(Key(id=3, keycode="NA 1001", barcode=None))
        db.session.commit()

        idx = keycode_cf_to_key_id_map()
        assert resolve_key_id_for_monthly_fields("7", "NA 1001 K2-F1", keycode_cf_index=idx) == 3


def test_resolve_by_canonical_keys_only(key_link_tables):
    with key_link_tables.app_context():
        db.session.add(Key(id=1, keycode="NA 1001", barcode=None))
        db.session.commit()

        idx = keycode_cf_to_key_id_map()
        assert resolve_key_id_for_monthly_fields(None, "NA 1001 K2-F1", keycode_cf_index=idx) == 1


def test_no_key_sentinel(key_link_tables):
    with key_link_tables.app_context():
        db.session.add(Key(id=1, keycode="1001", barcode=1))
        db.session.commit()

        assert resolve_key_id_for_monthly_fields(None, "-") is None


def test_sync_key_fk_for_location(key_link_tables):
    with key_link_tables.app_context():
        db.session.add(Key(id=1, keycode="Z9", barcode=55))
        db.session.flush()
        loc = _monthly_loc(barcode="55", keys="noise")
        db.session.add(loc)
        db.session.flush()
        sync_key_fk_for_location(loc)
        lid = loc.id
        db.session.commit()
        kid = db.session.scalar(
            select(MonthlyRouteLocation.key_id).where(MonthlyRouteLocation.id == lid)
        )
        assert kid == 1
