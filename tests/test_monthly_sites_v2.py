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
    MonthlyTestingSiteMonth,
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
                MonthlyTestingSiteMonth.__table__,
            ],
        )
        yield app
        db.session.remove()
        db.metadata.drop_all(
            db.engine,
            tables=[
                MonthlyTestingSiteMonth.__table__,
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


def test_post_testing_site_appends_after_existing_primary(v2_tables):
    with v2_tables.app_context():
        lid = _seed_route_and_location()
        loc = db.session.get(MonthlyRouteLocation, lid)
        from app.monthly.monthly_sites_sync import sync_testing_sites_from_legacy

        primary = sync_testing_sites_from_legacy(loc)[0]
        db.session.commit()
        assert primary.sort_order == 0

        client = v2_tables.test_client()
        with client.session_transaction() as sess:
            sess["authenticated"] = True
            sess["username"] = "pytest"

        resp = client.post(
            f"/api/monthly_sites/library/{lid}/testing_sites",
            json={"label": "Second panel"},
        )
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["testing_site"]["label"] == "Second panel"
        assert body["testing_site"]["sort_order"] == 1


def test_route_location_list_item_includes_ordered_testing_sites(v2_tables):
    with v2_tables.app_context():
        lid = _seed_route_and_location()
        loc = db.session.get(MonthlyRouteLocation, lid)
        from app.monthly.monthly_sites_sync import sync_testing_sites_from_legacy
        from app.routes.monthly_routes import _serialize_route_location_list_item

        primary = sync_testing_sites_from_legacy(loc)[0]
        primary.label = "Main panel"
        site = MonthlySite.query.filter_by(legacy_monthly_route_location_id=lid).one()
        db.session.add(
            MonthlyTestingSite(
                id=9002,
                monthly_site_id=int(site.id),
                sort_order=1,
                label="Second panel",
                annual_month="June",
            )
        )
        db.session.commit()

        payload = _serialize_route_location_list_item(loc)
        assert [row["label"] for row in payload["testing_sites"]] == ["Main panel", "Second panel"]
        assert [row["sort_order"] for row in payload["testing_sites"]] == [0, 1]


def test_reorder_testing_sites_updates_sort_order(v2_tables):
    with v2_tables.app_context():
        lid = _seed_route_and_location()
        loc = db.session.get(MonthlyRouteLocation, lid)
        from app.monthly.monthly_sites_sync import sync_testing_sites_from_legacy

        primary = sync_testing_sites_from_legacy(loc)[0]
        db.session.commit()

        client = v2_tables.test_client()
        with client.session_transaction() as sess:
            sess["authenticated"] = True
            sess["username"] = "pytest"

        add_second = client.post(
            f"/api/monthly_sites/library/{lid}/testing_sites",
            json={"label": "Second panel"},
        )
        add_third = client.post(
            f"/api/monthly_sites/library/{lid}/testing_sites",
            json={"label": "Third panel"},
        )
        assert add_second.status_code == 201
        assert add_third.status_code == 201
        second_id = int(add_second.get_json()["testing_site"]["id"])
        third_id = int(add_third.get_json()["testing_site"]["id"])

        resp = client.put(
            f"/api/monthly_sites/library/{lid}/testing_sites/order",
            json={"ordered_testing_site_ids": [third_id, int(primary.id), second_id]},
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert [row["id"] for row in body["testing_sites"]] == [third_id, int(primary.id), second_id]
        assert [row["sort_order"] for row in body["testing_sites"]] == [0, 1, 2]


def test_delete_testing_site_requires_sibling(v2_tables):
    with v2_tables.app_context():
        lid = _seed_route_and_location()
        loc = db.session.get(MonthlyRouteLocation, lid)
        from app.monthly.monthly_sites_sync import sync_testing_sites_from_legacy

        primary = sync_testing_sites_from_legacy(loc)[0]
        db.session.commit()

        client = v2_tables.test_client()
        with client.session_transaction() as sess:
            sess["authenticated"] = True
            sess["username"] = "pytest"

        only_resp = client.delete(f"/api/monthly_sites/testing_sites/{int(primary.id)}")
        assert only_resp.status_code == 400

        add_resp = client.post(
            f"/api/monthly_sites/library/{lid}/testing_sites",
            json={"label": "Second panel"},
        )
        assert add_resp.status_code == 201
        second_id = int(add_resp.get_json()["testing_site"]["id"])

        delete_resp = client.delete(f"/api/monthly_sites/testing_sites/{second_id}")
        assert delete_resp.status_code == 204
        assert db.session.get(MonthlyTestingSite, second_id) is None
