"""Bridge backfill + wipe scripts (SQLite subset schema)."""

from __future__ import annotations

import itertools
from datetime import date

import pytest

from app import create_app
from app.db_models import (
    Key,
    MonthlyKeyBridge,
    MonthlyLocation,
    MonthlyLocationMonth,
    MonthlyRoute,
    MonthlyRouteRun,
    db,
)
from tests.monthly_location_helpers import make_location


@pytest.fixture
def bridge_wipe_tables(monkeypatch, tmp_path):
    db_file = tmp_path / "bridge_wipe.db"
    uri = f"sqlite:///{db_file.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", uri)
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = uri
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    tables = [
        Key.__table__,
        MonthlyRoute.__table__,
        MonthlyLocation.__table__,
        MonthlyRouteRun.__table__,
        MonthlyLocationMonth.__table__,
        MonthlyKeyBridge.__table__,
    ]
    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        yield app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


_loc_id = itertools.count(100)


def _seed_key_and_location():
    k = Key(id=9001, keycode="TESTKEY", barcode=None)
    db.session.add(k)
    db.session.flush()
    mr = MonthlyRoute(id=1, route_number=1, weekday_iso=2, week_occurrence=1)
    db.session.add(mr)
    lid = next(_loc_id)
    loc = make_location(
        id=lid,
        address="1 Main",
        property_management_company="Co",
        property_management_company_normalized="co",
        key_id=9001,
        keys="TESTKEY",
        monthly_route_id=1,
    )
    db.session.add(loc)
    db.session.commit()
    return 9001, lid


def test_backfill_inserts_bridge_rows(bridge_wipe_tables):
    from app.scripts.backfill_monthly_key_bridge import _run

    with bridge_wipe_tables.app_context():
        _seed_key_and_location()
        assert _run(execute=True, write_csv=False) == 0
        assert MonthlyKeyBridge.query.count() == 1


def test_wipe_removes_locations_keeps_routes(bridge_wipe_tables):
    from app.scripts.wipe_monthly_locations_data import _wipe_sqlite_style

    with bridge_wipe_tables.app_context():
        _seed_key_and_location()
        run = MonthlyRouteRun(id=1, monthly_route_id=1, month_date=date(2026, 5, 1))
        db.session.add(
            MonthlyLocationMonth(
                id=1,
                monthly_location_id=100,
                month_date=date(2026, 5, 1),
                result_status="tested",
                run_id=1,
            )
        )
        db.session.add(run)
        db.session.commit()

        assert MonthlyRoute.query.count() == 1
        assert MonthlyLocation.query.count() == 1

        _wipe_sqlite_style()
        db.session.commit()

        assert MonthlyRoute.query.count() == 1
        assert MonthlyLocation.query.count() == 0
        assert MonthlyLocationMonth.query.count() == 0


def test_api_smoke_routes_and_library_after_wipe(bridge_wipe_tables):
    from app.scripts.wipe_monthly_locations_data import _wipe_sqlite_style

    app = bridge_wipe_tables
    with app.app_context():
        _seed_key_and_location()
        _wipe_sqlite_style()
        db.session.commit()

        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["username"] = "office.test"
                sess["authenticated"] = True

            res = client.get("/api/monthly_routes/routes")
            assert res.status_code == 200
            body = res.get_json()
            assert body["routes"] == []

            res2 = client.get("/api/monthly_routes/library?unpaginated=true")
            assert res2.status_code == 200
            assert res2.get_json()["locations"] == []
