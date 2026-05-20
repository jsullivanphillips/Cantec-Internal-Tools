"""Tests for v2 monthly site sync helpers (SQLite subset schema)."""

from __future__ import annotations

import itertools

import pytest
from sqlalchemy import select

from app import create_app
from app.db_models import (
    Key,
    MonthlyRoute,
    MonthlyRouteLocation,
    MonthlySite,
    MonthlyTestingSite,
    db,
)


@pytest.fixture
def v2_tables(monkeypatch):
    """In-memory SQLite with monthly route stack + v2 site tables (+ ``keys`` for FK)."""
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(
            db.engine,
            tables=[
                Key.__table__,
                MonthlyRoute.__table__,
                MonthlyRouteLocation.__table__,
                MonthlySite.__table__,
                MonthlyTestingSite.__table__,
            ],
        )
        yield app
        db.session.remove()
        db.metadata.drop_all(
            db.engine,
            tables=[
                MonthlyTestingSite.__table__,
                MonthlySite.__table__,
                MonthlyRouteLocation.__table__,
                MonthlyRoute.__table__,
                Key.__table__,
            ],
        )


_loc_id = itertools.count(1)


def _seed_route_and_location() -> int:
    r = MonthlyRoute(id=1, route_number=1, weekday_iso=2, week_occurrence=1)
    db.session.add(r)
    lid = next(_loc_id)
    loc = MonthlyRouteLocation(
        id=lid,
        address="100 Test Street",
        address_normalized="100 test street",
        property_management_company="PM Co",
        property_management_company_normalized="pm co",
        building="A",
        building_normalized="a",
        status_normalized="active",
        status_raw="ACTIVE",
        monthly_route_id=1,
        route_stop_order=0,
        keys="KEY-001",
    )
    db.session.add(loc)
    db.session.commit()
    return int(loc.id)


def test_sync_creates_monthly_site_and_testing_site(v2_tables):
    with v2_tables.app_context():
        lid = _seed_route_and_location()
        loc = db.session.get(MonthlyRouteLocation, lid)
        from app.monthly.monthly_sites_sync import sync_testing_sites_from_legacy

        rows = sync_testing_sites_from_legacy(loc)
        db.session.commit()
        assert len(rows) == 1
        assert rows[0].sort_order == 0
        assert rows[0].keys == "KEY-001"

        ms = db.session.execute(select(MonthlySite).where(MonthlySite.legacy_monthly_route_location_id == lid)).scalar_one()
        assert ms.legacy_monthly_route_location_id == lid


def test_refresh_primary_testing_site_from_legacy(v2_tables):
    with v2_tables.app_context():
        lid = _seed_route_and_location()
        loc = db.session.get(MonthlyRouteLocation, lid)
        from decimal import Decimal

        from app.monthly.monthly_sites_sync import refresh_primary_testing_site_from_legacy, sync_testing_sites_from_legacy

        sync_testing_sites_from_legacy(loc)
        db.session.commit()
        loc.price_per_month = Decimal("123.45")
        refresh_primary_testing_site_from_legacy(loc)
        db.session.commit()
        ms = MonthlySite.query.filter_by(legacy_monthly_route_location_id=lid).one()
        ts = MonthlyTestingSite.query.filter_by(monthly_site_id=int(ms.id)).one()
        assert ts.price_per_month == Decimal("123.45")


def test_push_testing_site_keys_to_legacy(v2_tables):
    with v2_tables.app_context():
        lid = _seed_route_and_location()
        loc = db.session.get(MonthlyRouteLocation, lid)
        from app.monthly.monthly_sites_sync import push_testing_site_keys_to_legacy, sync_testing_sites_from_legacy

        sync_testing_sites_from_legacy(loc)
        db.session.commit()
        ms = MonthlySite.query.filter_by(legacy_monthly_route_location_id=lid).one()
        ts = MonthlyTestingSite.query.filter_by(monthly_site_id=int(ms.id)).one()
        ts.keys = "FROM-TS"
        db.session.commit()
        push_testing_site_keys_to_legacy(loc)
        db.session.commit()
        db.session.refresh(loc)
        assert loc.keys == "FROM-TS"


def test_unwrap_flask_handler_result_tuple(v2_tables):
    from flask import jsonify

    from app.routes.monthly_sites import _unwrap_flask_handler_result

    with v2_tables.app_context():
        body, status = _unwrap_flask_handler_result((jsonify({"ok": True}), 201))
    assert status == 201
    assert body.get_json() == {"ok": True}


def test_post_testing_site_with_payload(v2_tables):
    with v2_tables.app_context():
        lid = _seed_route_and_location()

        client = v2_tables.test_client()
        with client.session_transaction() as sess:
            sess["authenticated"] = True
            sess["username"] = "pytest"

        resp = client.post(
            f"/api/monthly_sites/library/{lid}/testing_sites",
            json={
                "label": "Building A panel",
                "keys": "KEY-NEW",
                "price_per_month": "99.50",
            },
        )
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["testing_site"]["label"] == "Building A panel"
        assert body["testing_site"]["keys"] == "KEY-NEW"
        assert float(body["testing_site"]["price_per_month"]) == 99.50
