"""Library list endpoint: SQL route counts, batched month cells, lightweight payload."""

from __future__ import annotations

import itertools
from datetime import date

import pytest

from app import create_app
from app.db_models import Key, MonthlyLocation, MonthlyLocationMonth, MonthlyRoute, db
from tests.monthly_location_helpers import make_location


@pytest.fixture
def library_tables(monkeypatch, tmp_path):
    db_file = tmp_path / "library_list.db"
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
                Key.__table__,
                MonthlyRoute.__table__,
                MonthlyLocation.__table__,
                MonthlyLocationMonth.__table__,
            ],
        )
        yield app
        db.session.remove()
        db.metadata.drop_all(
            db.engine,
            tables=[
                MonthlyLocationMonth.__table__,
                MonthlyLocation.__table__,
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


def _seed_location(*, keys: str = "KEY-A", price_per_month=None) -> int:
    if db.session.get(MonthlyRoute, 1) is None:
        db.session.add(MonthlyRoute(id=1, route_number=7, weekday_iso=2, week_occurrence=1))
    lid = next(_loc_id)
    loc = make_location(
        id=lid,
        address=f"{lid} Test Street",
        label="B",
        property_management_company="PM",
        property_management_company_normalized="pm",
        monthly_route_id=1,
        route_stop_order=0,
        test_day="Monday",
        keys=keys,
        notes="Long notes field",
        ring_detail="ring",
        facp_detail="facp",
        price_per_month=price_per_month,
    )
    db.session.add(loc)
    db.session.flush()
    db.session.add(
        MonthlyLocationMonth(
            id=lid * 1000,
            monthly_location_id=lid,
            month_date=date(2026, 3, 1),
            result_status="tested",
            test_monthly_route_id=1,
        )
    )
    db.session.commit()
    return int(lid)


def test_route_counts_for_location_query_aggregates_in_sql(library_tables):
    with library_tables.app_context():
        _seed_location()
        _seed_location(keys="KEY-B")

        from app.routes.monthly_routes import _route_counts_for_location_query

        base = MonthlyLocation.query
        counts = _route_counts_for_location_query(base)
        assert counts == {"Monday": 2}


def test_monthly_routes_library_list_payload(library_tables):
    with library_tables.app_context():
        lid = _seed_location()

        client = _auth_client(library_tables)
        res = client.get(
            "/api/monthly_routes/library?from_month=2026-01-01&to_month=2026-12-01&page=1&page_size=50"
        )
        assert res.status_code == 200
        body = res.get_json()
        assert len(body["locations"]) == 1
        row = body["locations"][0]
        assert row["id"] == lid
        assert "notes" not in row
        assert row["months"]["2026-03-01"] == {"result_status": "tested", "skip_reason": None}
        assert "test_monthly_route" not in row["months"]["2026-03-01"]


def test_monthly_routes_library_includes_price_per_location(library_tables):
    with library_tables.app_context():
        from decimal import Decimal

        lid = _seed_location(keys="KEY-V2", price_per_month=Decimal("10.00"))

        client = _auth_client(library_tables)
        res = client.get(
            "/api/monthly_routes/library?from_month=2026-01-01&to_month=2026-12-01&page=1&page_size=50"
        )
        body = res.get_json()
        row = body["locations"][0]
        assert row["id"] == lid
        assert row["keys"] == "KEY-V2"
        assert row["price_per_month"] == 10.0
