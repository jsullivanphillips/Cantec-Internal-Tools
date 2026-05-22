"""Library list endpoint: SQL route counts, batched v2 augment, lightweight payload."""

from __future__ import annotations

import itertools
from datetime import date
from decimal import Decimal

import pytest

from app import create_app
from app.db_models import (
    Key,
    MonthlyRoute,
    MonthlyRouteLocation,
    MonthlyRouteTestHistory,
    MonthlySite,
    MonthlyTestingSite,
    db,
)


@pytest.fixture
def library_tables(monkeypatch):
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
                MonthlyRouteTestHistory.__table__,
                MonthlySite.__table__,
                MonthlyTestingSite.__table__,
            ],
        )
        yield app
        db.session.remove()
        db.metadata.drop_all(
            db.engine,
            tables=[
                MonthlyRouteTestHistory.__table__,
                MonthlyTestingSite.__table__,
                MonthlySite.__table__,
                MonthlyRouteLocation.__table__,
                MonthlyRoute.__table__,
                Key.__table__,
            ],
        )


_loc_id = itertools.count(1)


def _auth_client(app):
    client = app.test_client()
    with client.session_transaction() as sess:
        sess["authenticated"] = True
        sess["username"] = "pytest"
    return client


def _seed_location(*, with_v2: bool = False, keys: str = "KEY-A") -> int:
    if db.session.get(MonthlyRoute, 1) is None:
        db.session.add(MonthlyRoute(id=1, route_number=7, weekday_iso=2, week_occurrence=1))
    lid = next(_loc_id)
    loc = MonthlyRouteLocation(
        id=lid,
        address=f"{lid} Test Street",
        address_normalized=f"{lid} test street",
        property_management_company="PM",
        property_management_company_normalized="pm",
        building="B",
        building_normalized="b",
        status_normalized="active",
        status_raw="ACTIVE",
        monthly_route_id=1,
        route_stop_order=0,
        test_day="Monday",
        keys=keys,
        notes="Long notes field",
        ring_detail="ring",
        facp_detail="facp",
    )
    db.session.add(loc)
    db.session.flush()
    db.session.add(
        MonthlyRouteTestHistory(
            id=lid * 1000,
            location_id=lid,
            month_date=date(2026, 3, 1),
            result_status="tested",
            test_monthly_route_id=1,
        )
    )
    if with_v2:
        ms = MonthlySite(id=lid, legacy_monthly_route_location_id=lid)
        db.session.add(ms)
        db.session.flush()
        db.session.add(
            MonthlyTestingSite(
                id=lid,
                monthly_site_id=int(ms.id),
                sort_order=0,
                keys="KEY-V2",
                price_per_month=Decimal("10.00"),
            )
        )
    db.session.commit()
    return int(lid)


def test_route_counts_for_location_query_aggregates_in_sql(library_tables):
    with library_tables.app_context():
        _seed_location()
        _seed_location(keys="KEY-B")

        from app.routes.monthly_routes import _route_counts_for_location_query

        base = MonthlyRouteLocation.query
        counts = _route_counts_for_location_query(base)
        assert counts == {"Monday": 2}


def test_monthly_sites_library_list_payload_and_no_sync(library_tables):
    with library_tables.app_context():
        lid = _seed_location(with_v2=False)

        client = _auth_client(library_tables)
        res = client.get(
            "/api/monthly_sites/library?from_month=2026-01-01&to_month=2026-12-01&page=1&page_size=50"
        )
        assert res.status_code == 200
        body = res.get_json()
        assert len(body["locations"]) == 1
        row = body["locations"][0]
        assert row["id"] == lid
        assert "testing_sites" not in row
        assert "notes" not in row
        assert row["months"]["2026-03-01"] == {"result_status": "tested", "skip_reason": None}
        assert "test_monthly_route" not in row["months"]["2026-03-01"]

        assert MonthlySite.query.count() == 0
        assert MonthlyTestingSite.query.count() == 0


def test_monthly_sites_library_overlays_primary_key_when_v2_exists(library_tables):
    with library_tables.app_context():
        lid = _seed_location(with_v2=True)

        client = _auth_client(library_tables)
        res = client.get(
            "/api/monthly_sites/library?from_month=2026-01-01&to_month=2026-12-01&page=1&page_size=50"
        )
        body = res.get_json()
        row = body["locations"][0]
        assert row["keys"] == "KEY-V2"
        assert row["rollup_price_per_month"] == 10.0
        assert "testing_sites" not in row
