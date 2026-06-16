"""Backfill MonthlyLocation.key_id script."""

from __future__ import annotations

import pytest

from app import create_app
from app.db_models import Key, MonthlyLocation, MonthlyRoute, db
from tests.monthly_location_helpers import make_location


@pytest.fixture
def backfill_client(monkeypatch, tmp_path):
    db_file = tmp_path / "backfill_key.db"
    uri = f"sqlite:///{db_file.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", uri)
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = uri
    tables = [Key.__table__, MonthlyRoute.__table__, MonthlyLocation.__table__]
    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        yield app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


def test_backfill_sets_key_id(backfill_client):
    from app.scripts.backfill_monthly_location_key_id import main

    with backfill_client.app_context():
        key = Key(id=9, keycode="LINKME", barcode=99)
        loc = make_location(id=1, address="1 Main", keys="LINKME", barcode="99", key_id=None)
        db.session.add_all([key, loc])
        db.session.commit()
        assert main(["--execute"]) == 0
        db.session.refresh(loc)
        assert loc.key_id == 9
