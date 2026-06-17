"""GET /api/monthly_routes/dashboard/issues — library data-quality lists."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app import create_app
from app.db_models import Key, MonthlyLocation, MonthlyRoute, db
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


def _all_issue_ids(body: dict) -> set[int]:
    return (
        {row["id"] for row in body["missing_service_trade_link"]}
        | {row["id"] for row in body["missing_price"]}
        | {row["id"] for row in body["missing_key_link"]}
        | {row["id"] for row in body["missing_map_pin"]}
    )


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
    key_ids = {row["id"] for row in body["missing_key_link"]}
    assert 101 in st_ids
    assert 101 not in price_ids
    assert 101 not in key_ids
    assert body["counts"]["missing_service_trade_link"] == 1
    assert body["counts"]["missing_price"] == 0
    assert body["counts"]["missing_key_link"] == 0


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
    key_ids = {row["id"] for row in body["missing_key_link"]}
    assert 102 not in st_ids
    assert 102 in price_ids
    assert 102 not in key_ids
    assert body["counts"]["missing_price"] == 1
    assert body["counts"]["missing_key_link"] == 0


def test_active_missing_key_link_only(issues_client):
    client, app = issues_client
    with app.app_context():
        route = _seed_route(1, 7)
        key = Key(id=501, keycode="LINK 501")
        db.session.add(key)
        db.session.add(
            make_location(
                id=104,
                address="400 Epsilon Ln",
                monthly_route_id=route.id,
                route_stop_order=0,
                service_trade_site_location_id=9003,
                price_per_month=Decimal("80.00"),
                key_id=key.id,
            )
        )
        db.session.add(
            make_location(
                id=105,
                address="401 Epsilon Ln",
                monthly_route_id=route.id,
                route_stop_order=1,
                service_trade_site_location_id=9004,
                price_per_month=Decimal("85.00"),
                keys="PP 823",
                key_id=None,
            )
        )
        db.session.commit()

    body = _get_issues(client)
    key_ids = {row["id"] for row in body["missing_key_link"]}
    assert 104 not in key_ids
    assert 105 in key_ids
    assert body["counts"]["missing_key_link"] == 1


def test_active_missing_map_pin_only(issues_client):
    client, app = issues_client
    with app.app_context():
        route = _seed_route(1, 8)
        db.session.add(
            make_location(
                id=108,
                address="508 Mapless Rd",
                monthly_route_id=route.id,
                route_stop_order=0,
                service_trade_site_location_id=9005,
                price_per_month=Decimal("90.00"),
                latitude=None,
                longitude=None,
            )
        )
        db.session.commit()

    body = _get_issues(client)
    map_pin_ids = {row["id"] for row in body["missing_map_pin"]}
    assert 108 in map_pin_ids
    assert body["counts"]["missing_map_pin"] == 1


def test_active_fully_configured_excluded(issues_client):
    client, app = issues_client
    with app.app_context():
        route = _seed_route(1, 4)
        key = Key(id=502, keycode="LINK 502")
        db.session.add(key)
        db.session.add(
            make_location(
                id=103,
                address="300 Gamma Rd",
                monthly_route_id=route.id,
                route_stop_order=0,
                service_trade_site_location_id=9002,
                price_per_month=Decimal("75.00"),
                key_id=key.id,
                latitude=48.4284,
                longitude=-123.3656,
            )
        )
        db.session.commit()

    body = _get_issues(client)
    assert 103 not in _all_issue_ids(body)
    assert body["counts"]["missing_service_trade_link"] == 0
    assert body["counts"]["missing_price"] == 0
    assert body["counts"]["missing_key_link"] == 0
    assert body["counts"]["missing_map_pin"] == 0


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
    assert 201 not in _all_issue_ids(body)
    assert 202 not in _all_issue_ids(body)


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
    assert 301 not in _all_issue_ids(body)


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
    assert 302 not in _all_issue_ids(body)


def test_no_key_sentinel_excluded_from_missing_key_link(issues_client):
    client, app = issues_client
    with app.app_context():
        route = _seed_route(1, 8)
        db.session.add_all(
            [
                make_location(
                    id=106,
                    address="500 Zeta Way",
                    monthly_route_id=route.id,
                    route_stop_order=0,
                    keys="-",
                    key_id=None,
                ),
                make_location(
                    id=107,
                    address="501 Zeta Way",
                    monthly_route_id=route.id,
                    route_stop_order=1,
                    keys="No keys",
                    key_id=None,
                ),
            ]
        )
        db.session.commit()

    body = _get_issues(client)
    key_ids = {row["id"] for row in body["missing_key_link"]}
    assert 106 not in key_ids
    assert 107 not in key_ids
    assert body["counts"]["missing_key_link"] == 0


def test_site_can_have_multiple_issues(issues_client):
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
                keys="PP 823",
            )
        )
        db.session.commit()

    body = _get_issues(client)
    st_ids = {row["id"] for row in body["missing_service_trade_link"]}
    price_ids = {row["id"] for row in body["missing_price"]}
    key_ids = {row["id"] for row in body["missing_key_link"]}
    map_pin_ids = {row["id"] for row in body["missing_map_pin"]}
    assert 401 in st_ids
    assert 401 in price_ids
    assert 401 in key_ids
    assert 401 in map_pin_ids
    assert body["counts"]["missing_service_trade_link"] == 1
    assert body["counts"]["missing_price"] == 1
    assert body["counts"]["missing_key_link"] == 1
    assert body["counts"]["missing_map_pin"] == 1
