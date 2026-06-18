"""GET /api/monthly_routes/dashboard/location_metrics — monthly price vs visit time."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app import create_app
from app.db_models import MonthlyLocation, MonthlyLocationVisitTimingMonth, MonthlyRoute, db
from app.routes import monthly_routes as mr_mod
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location, make_location_month

CURRENT_MONTH = date(2026, 6, 1)


@pytest.fixture
def location_metrics_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: CURRENT_MONTH)
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


def _get_metrics(client, *, range_key: str | None = None):
    suffix = f"?range={range_key}" if range_key is not None else ""
    res = client.get(f"/api/monthly_routes/dashboard/location_metrics{suffix}")
    assert res.status_code == 200, res.get_data(as_text=True)
    return res.get_json()


def _seed_site(
    *,
    route_id: int,
    route_number: int,
    location_id: int,
    price: Decimal,
    stop_order: int = 0,
):
    route = db.session.get(MonthlyRoute, route_id)
    if route is None:
        route = MonthlyRoute(id=route_id, route_number=route_number, weekday_iso=0, week_occurrence=1)
        db.session.add(route)
    loc = make_location(
        id=location_id,
        address=f"{location_id} Test St",
        monthly_route_id=route_id,
        route_stop_order=stop_order,
        price_per_month=price,
    )
    db.session.add(loc)


def _seed_visit(
    *,
    location_id: int,
    mlm_id: int,
    month_date: date,
    route_id: int,
    time_in: str,
    time_out: str,
    billing_status: str = "bill",
    result_status: str = "tested",
):
    mlm = make_location_month(
        id=mlm_id,
        location_id=location_id,
        month_date=month_date,
        route_id=route_id,
        result_status=result_status,
        billing_status=billing_status,
        sheet_time_in_raw=time_in,
        sheet_time_out_raw=time_out,
    )
    db.session.add(mlm)


def test_location_metrics_ranks_by_price_per_hour(location_metrics_client):
    client, app = location_metrics_client
    with app.app_context():
        _seed_site(route_id=1, route_number=2, location_id=101, price=Decimal("120.00"))
        _seed_site(route_id=1, route_number=2, location_id=102, price=Decimal("120.00"), stop_order=1)
        _seed_visit(
            location_id=101,
            mlm_id=5001,
            month_date=date(2026, 5, 1),
            route_id=1,
            time_in="8:00 AM",
            time_out="9:00 AM",
        )
        _seed_visit(
            location_id=102,
            mlm_id=5002,
            month_date=date(2026, 5, 1),
            route_id=1,
            time_in="8:00 AM",
            time_out="10:00 AM",
        )
        db.session.commit()

    body = _get_metrics(client, range_key="last_month")
    assert body["eligible_location_count"] == 2
    top = body["top_performers"]
    low = body["lowest_performers"]
    assert top[0]["location_id"] == 101
    assert top[0]["price_per_hour"] == 120.0
    assert top[1]["location_id"] == 102
    assert top[1]["price_per_hour"] == 60.0
    assert low[0]["location_id"] == 102
    assert low[-1]["location_id"] == 101


def test_location_metrics_includes_do_not_bill_when_priced(location_metrics_client):
    client, app = location_metrics_client
    with app.app_context():
        _seed_site(route_id=1, route_number=2, location_id=101, price=Decimal("90.00"))
        _seed_visit(
            location_id=101,
            mlm_id=5001,
            month_date=date(2026, 5, 1),
            route_id=1,
            time_in="8:00 AM",
            time_out="9:30 AM",
            billing_status="do_not_bill",
        )
        db.session.commit()

    body = _get_metrics(client, range_key="last_month")
    assert body["eligible_location_count"] == 1
    row = body["top_performers"][0]
    assert row["price_per_month"] == 90.0
    assert row["price_per_hour"] == 60.0


def test_location_metrics_excludes_sites_without_visit_times(location_metrics_client):
    client, app = location_metrics_client
    with app.app_context():
        _seed_site(route_id=1, route_number=2, location_id=101, price=Decimal("120.00"))
        _seed_visit(
            location_id=101,
            mlm_id=5001,
            month_date=date(2026, 5, 1),
            route_id=1,
            time_in="8:00 AM",
            time_out="9:00 AM",
        )
        route = MonthlyRoute(id=2, route_number=3, weekday_iso=0, week_occurrence=1)
        loc = make_location(
            id=102,
            address="102 Test St",
            monthly_route_id=2,
            route_stop_order=0,
            price_per_month=Decimal("200.00"),
        )
        mlm_no_time = make_location_month(
            id=5002,
            location_id=102,
            month_date=date(2026, 5, 1),
            route_id=2,
            result_status="tested",
            billing_status="bill",
        )
        db.session.add_all([route, loc, mlm_no_time])
        db.session.commit()

    body = _get_metrics(client, range_key="last_month")
    assert body["eligible_location_count"] == 1
    assert body["top_performers"][0]["location_id"] == 101


def test_demo_route_r99_excluded(location_metrics_client):
    client, app = location_metrics_client
    with app.app_context():
        _seed_site(route_id=1, route_number=99, location_id=401, price=Decimal("999.00"))
        _seed_site(route_id=2, route_number=4, location_id=402, price=Decimal("100.00"))
        _seed_visit(
            location_id=402,
            mlm_id=5002,
            month_date=date(2026, 5, 1),
            route_id=2,
            time_in="8:00 AM",
            time_out="9:00 AM",
        )
        db.session.commit()

    body = _get_metrics(client, range_key="last_month")
    location_ids = {row["location_id"] for row in body["top_performers"] + body["lowest_performers"]}
    assert 401 not in location_ids
    assert 402 in location_ids


def test_location_metrics_excludes_sites_with_invalid_visit_clocks(location_metrics_client):
    client, app = location_metrics_client
    with app.app_context():
        _seed_site(route_id=1, route_number=15, location_id=747, price=Decimal("200.00"))
        _seed_site(route_id=1, route_number=15, location_id=748, price=Decimal("100.00"), stop_order=1)
        _seed_visit(
            location_id=747,
            mlm_id=5747,
            month_date=date(2026, 5, 1),
            route_id=1,
            time_in="11:11",
            time_out="0:00",
        )
        _seed_visit(
            location_id=748,
            mlm_id=5748,
            month_date=date(2026, 5, 1),
            route_id=1,
            time_in="8:00 AM",
            time_out="9:00 AM",
        )
        db.session.commit()

    body = _get_metrics(client, range_key="last_month")
    location_ids = {row["location_id"] for row in body["top_performers"] + body["lowest_performers"]}
    assert 747 not in location_ids
    assert 748 in location_ids


def test_location_metrics_lowest_monthly_price_includes_sites_without_visit_times(
    location_metrics_client,
):
    client, app = location_metrics_client
    with app.app_context():
        _seed_site(route_id=1, route_number=2, location_id=101, price=Decimal("45.00"))
        _seed_site(route_id=1, route_number=2, location_id=102, price=Decimal("120.00"), stop_order=1)
        _seed_site(route_id=1, route_number=2, location_id=103, price=Decimal("80.00"), stop_order=2)
        _seed_visit(
            location_id=101,
            mlm_id=5001,
            month_date=date(2026, 5, 1),
            route_id=1,
            time_in="8:00 AM",
            time_out="9:00 AM",
        )
        db.session.commit()

    body = _get_metrics(client, range_key="last_month")
    assert body["priced_location_count"] == 3
    lowest_price = body["lowest_monthly_price_locations"]
    assert [row["location_id"] for row in lowest_price] == [101, 103, 102]
    assert lowest_price[0]["price_per_month"] == 45.0


def test_location_metrics_lowest_monthly_price_includes_unassigned_route_sites(
    location_metrics_client,
):
    client, app = location_metrics_client
    with app.app_context():
        loc = make_location(
            id=201,
            address="201 Unassigned St",
            monthly_route_id=None,
            price_per_month=Decimal("55.00"),
        )
        db.session.add(loc)
        db.session.commit()

    body = _get_metrics(client, range_key="last_month")
    location_ids = {row["location_id"] for row in body["lowest_monthly_price_locations"]}
    assert 201 in location_ids
    assert body["priced_location_count"] >= 1


def test_location_metrics_ignores_stale_lookup_row_with_bad_visit_minutes(location_metrics_client):
    client, app = location_metrics_client
    with app.app_context():
        _seed_site(route_id=15, route_number=15, location_id=747, price=Decimal("200.00"))
        _seed_site(route_id=15, route_number=15, location_id=748, price=Decimal("100.00"), stop_order=1)
        mlm = make_location_month(
            id=5747,
            location_id=747,
            month_date=date(2026, 5, 1),
            route_id=15,
            result_status="tested",
            billing_status="bill",
            sheet_time_in_raw="11:11",
            sheet_time_out_raw="0:00",
        )
        db.session.add(mlm)
        db.session.flush()
        db.session.add(
            MonthlyLocationVisitTimingMonth(
                id=9001,
                monthly_location_month_id=5747,
                monthly_location_id=747,
                month_first=date(2026, 5, 1),
                visit_minutes=769,
                visit_time_source="sheet",
                sync_status="ok",
            )
        )
        _seed_visit(
            location_id=748,
            mlm_id=5748,
            month_date=date(2026, 5, 1),
            route_id=15,
            time_in="8:00 AM",
            time_out="9:00 AM",
        )
        db.session.commit()

    body = _get_metrics(client, range_key="last_month")
    location_ids = {row["location_id"] for row in body["lowest_performers"]}
    assert 747 not in location_ids
    assert 748 in location_ids
