import itertools

import pytest
from sqlalchemy import select

from app import create_app
from app.db_models import Key, MonthlyLocation, MonthlyRoute, db
from app.monthly.key_resolve import (
    keycode_cf_to_key_id_map,
    resolve_key_id_for_monthly_fields,
    sync_key_fk_for_location,
)
from tests.monthly_location_helpers import make_location


@pytest.fixture
def key_link_tables(monkeypatch, tmp_path):
    db_file = tmp_path / "key_resolve_test.db"
    uri = f"sqlite:///{db_file.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", uri)
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = uri
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(
            db.engine,
            tables=[
                MonthlyRoute.__table__,
                Key.__table__,
                MonthlyLocation.__table__,
            ],
        )
        yield app
        db.session.remove()
        db.metadata.drop_all(
            db.engine,
            tables=[
                MonthlyLocation.__table__,
                Key.__table__,
                MonthlyRoute.__table__,
            ],
        )


_loc_seq = itertools.count(1)


def _monthly_loc(**kwargs):
    lid = kwargs.pop("id", next(_loc_seq))
    address = kwargs.pop("address", "10 Oak St")
    return make_location(id=lid, address=address, **kwargs)


def test_resolve_key_id_from_barcode(key_link_tables):
    with key_link_tables.app_context():
        key = Key(id=1, keycode="ABC123")
        db.session.add(key)
        db.session.commit()
        idx = keycode_cf_to_key_id_map()
        assert resolve_key_id_for_monthly_fields(None, "ABC123", keycode_cf_index=idx) == 1


def test_sync_key_fk_for_location_updates_key_id(key_link_tables):
    with key_link_tables.app_context():
        key = Key(id=5, keycode="K-5", barcode=5)
        loc = _monthly_loc(barcode="5", keys=None, key_id=None)
        db.session.add_all([key, loc])
        db.session.commit()
        sync_key_fk_for_location(loc)
        db.session.commit()
        refreshed = db.session.execute(select(MonthlyLocation.key_id).where(MonthlyLocation.id == loc.id)).scalar_one()
        assert refreshed == 5
