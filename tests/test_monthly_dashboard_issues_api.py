"""GET /api/monthly_routes/dashboard/issues — library data-quality lists."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app import create_app
from app.db_models import MonthlyLocation, MonthlyRoute, db
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location

DEFAULT_DEMO_ROUTE_NUMBER = 99


@pytest.fixture
def issues_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=WORKSHEET_TABLES)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["username"] = "office.staff"
                sess["authenticated"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(WORKSHEET_TABLES)))


def _seed_route(route_id: int, route_number: int) -> MonthlyRoute:
    route = MonthlyRoute(
        id=route_id,
        route_number=route_number,
        weekday_iso=0,
        week_occurrence=1,
    )
    db.session.add(route)
    return route


def _get_issues(client):
    res = client.get("/api/monthly_routes/dashboard/issues")
    assert res.status_code == 200, res.get_data(as_text=True)
    return res.get_json()


def test_active_missing_st_link_listed(issues_client):
    client, app = issues_client
    with app.app_context():
        route = _seed_route(1, 2)
        db.session.add(
            make_location(
                id=101,
                address="100 Alpha St",
                monthly_route_id=route.id,
                route_stop_order=0,
                service_trade_site_location_id=None,
                price_per_month=Decimal("50.00"),
            )
        )
        db.session.commit()

    body = _get_issues(client)
    st_ids = {row["id"] for row in body["missing_service_trade_link"]}
    price_ids = {row["id"] for row in body["missing_price"]}
    assert 101 in st_ids
    assert 101 not in price_ids
    assert body["counts"]["missing_service_trade_link"] == 1
    assert body["counts"]["missing_price"] == 0


def test_active_missing_price_only(issues_client):
    client, app = issues_client
    with app.app_context():
        route = _seed_route(1, 3)
        db.session.add(
            make_location(
                id=102,
                address="200 Beta Ave",
                monthly_route_id=route.id,
                route_stop_order=0,
                service_trade_site_location_id=9001,
                price_per_month=None,
            )
        )
        db.session.commit()

    body = _get_issues(client)
    st_ids = {row["id"] for row in body["missing_service_trade_link"]}
    price_ids = {row["id"] for row in body["missing_price"]}
    assert 102 not in st_ids
    assert 102 in price_ids
    assert body["counts"]["missing_price"] == 1


def test_active_fully_configured_excluded(issues_client):
    client, app = issues_client
    with app.app_context():
        route = _seed_route(1, 4)
        db.session.add(
            make_location(
                id=103,
                address="300 Gamma Rd",
                monthly_route_id=route.id,
                route_stop_order=0,
                service_trade_site_location_id=9002,
                price_per_month=Decimal("75.00"),
            )
        )
        db.session.commit()

    body = _get_issues(client)
    all_ids = {row["id"] for row in body["missing_service_trade_link"]} | {
        row["id"] for row in body["missing_price"]
    }
    assert 103 not in all_ids
    assert body["counts"]["missing_service_trade_link"] == 0
    assert body["counts"]["missing_price"] == 0


def test_cancelled_and_on_hold_excluded(issues_client):
    client, app = issues_client
    with app.app_context():
        route = _seed_route(1, 5)
        db.session.add_all(
            [
                make_location(
                    id=201,
                    address="Cancelled Site",
                    monthly_route_id=route.id,
                    status_normalized="cancelled",
                    status_raw="Cancelled",
                    service_trade_site_location_id=None,
                    price_per_month=None,
                ),
                make_location(
                    id=202,
                    address="On Hold Site",
                    monthly_route_id=route.id,
                    status_normalized="on_hold",
                    status_raw="On Hold",
                    service_trade_site_location_id=None,
                    price_per_month=None,
                ),
            ]
        )
        db.session.commit()

    body = _get_issues(client)
    all_ids = {row["id"] for row in body["missing_service_trade_link"]} | {
        row["id"] for row in body["missing_price"]
    }
    assert 201 not in all_ids
    assert 202 not in all_ids


def test_r99_demo_route_excluded(issues_client):
    client, app = issues_client
    with app.app_context():
        demo_route = _seed_route(99, DEFAULT_DEMO_ROUTE_NUMBER)
        db.session.add(
            make_location(
                id=301,
                address="[DEMO] Training Stop",
                monthly_route_id=demo_route.id,
                route_stop_order=0,
                service_trade_site_location_id=None,
                price_per_month=None,
            )
        )
        db.session.commit()

    body = _get_issues(client)
    all_ids = {row["id"] for row in body["missing_service_trade_link"]} | {
        row["id"] for row in body["missing_price"]
    }
    assert 301 not in all_ids


def test_r99_test_day_suffix_excluded_without_route_assignment(issues_client):
    client, app = issues_client
    with app.app_context():
        db.session.add(
            make_location(
                id=302,
                address="Legacy Demo Label",
                test_day=f"3rd Monday - R{DEFAULT_DEMO_ROUTE_NUMBER}",
                service_trade_site_location_id=None,
                price_per_month=None,
            )
        )
        db.session.commit()

    body = _get_issues(client)
    all_ids = {row["id"] for row in body["missing_service_trade_link"]} | {
        row["id"] for row in body["missing_price"]
    }
    assert 302 not in all_ids


def test_site_can_appear_in_both_sections(issues_client):
    client, app = issues_client
    with app.app_context():
        route = _seed_route(1, 6)
        db.session.add(
            make_location(
                id=401,
                address="400 Delta Pl",
                monthly_route_id=route.id,
                route_stop_order=0,
                service_trade_site_location_id=None,
                price_per_month=None,
            )
        )
        db.session.commit()

    body = _get_issues(client)
    st_ids = {row["id"] for row in body["missing_service_trade_link"]}
    price_ids = {row["id"] for row in body["missing_price"]}
    assert 401 in st_ids
    assert 401 in price_ids
    assert body["counts"]["missing_service_trade_link"] == 1
    assert body["counts"]["missing_price"] == 1
