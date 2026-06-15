"""GET /api/monthly_routes/dashboard/route_earnings — route earnings rankings."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import (
    MonthlyLocation,
    MonthlyRoute,
    MonthlyRouteRunTimingMonth,
    db,
)
from app.monthly.service_trade_route_run_timing import SYNC_STATUS_OK
from app.routes import monthly_routes as mr_mod
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location, make_location_month

CURRENT_MONTH = date(2026, 6, 1)
PACIFIC = ZoneInfo("America/Vancouver")


@pytest.fixture
def earnings_client(monkeypatch):
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


def _get_earnings(client, months: int | None = None):
    url = "/api/monthly_routes/dashboard/route_earnings"
    if months is not None:
        url = f"{url}?months={months}"
    res = client.get(url)
    assert res.status_code == 200, res.get_data(as_text=True)
    return res.get_json()


def _seed_route(
    *,
    route_id: int,
    route_number: int,
    location_id: int,
    price: Decimal,
) -> None:
    route = MonthlyRoute(
        id=route_id,
        route_number=route_number,
        weekday_iso=0,
        week_occurrence=1,
    )
    loc = make_location(
        id=location_id,
        address=f"{location_id} Test St",
        monthly_route_id=route_id,
        route_stop_order=0,
        price_per_month=price,
    )
    db.session.add_all([route, loc])


def _seed_tested_month(
    *,
    location_id: int,
    mlm_id: int,
    month_date: date,
    route_id: int,
) -> None:
    mlm = make_location_month(
        id=mlm_id,
        location_id=location_id,
        month_date=month_date,
        route_id=route_id,
        result_status="tested",
    )
    db.session.add(mlm)


def _seed_run_timing_month(
    *,
    row_id: int,
    route_id: int,
    month_first: date,
    duration_minutes: int,
    clock_out_hour: int,
    clock_out_minute: int = 0,
) -> None:
    end_minute = clock_out_hour * 60 + clock_out_minute
    start_minute = end_minute - duration_minutes
    clock_in_at = datetime(
        month_first.year,
        month_first.month,
        15,
        start_minute // 60,
        start_minute % 60,
        tzinfo=PACIFIC,
    )
    clock_out_at = datetime(
        month_first.year,
        month_first.month,
        15,
        clock_out_hour,
        clock_out_minute,
        tzinfo=PACIFIC,
    )
    db.session.add(
        MonthlyRouteRunTimingMonth(
            id=row_id,
            monthly_route_id=route_id,
            month_first=month_first,
            service_trade_job_id=9000 + row_id,
            clock_in_at=clock_in_at,
            clock_out_at=clock_out_at,
            duration_minutes=duration_minutes,
            sync_status=SYNC_STATUS_OK,
        )
    )


def _seed_route_with_tested_month(
    *,
    route_id: int,
    route_number: int,
    location_id: int,
    mlm_id: int,
    month_date: date,
    price: Decimal,
) -> None:
    _seed_route(
        route_id=route_id,
        route_number=route_number,
        location_id=location_id,
        price=price,
    )
    _seed_tested_month(
        location_id=location_id,
        mlm_id=mlm_id,
        month_date=month_date,
        route_id=route_id,
    )


def test_route_earnings_ranking_and_slices(earnings_client):
    client, app = earnings_client
    with app.app_context():
        _seed_route(route_id=1, route_number=2, location_id=101, price=Decimal("100.00"))
        _seed_route(route_id=2, route_number=3, location_id=102, price=Decimal("250.00"))
        _seed_tested_month(
            location_id=101,
            mlm_id=5001,
            month_date=date(2026, 5, 1),
            route_id=1,
        )
        _seed_tested_month(
            location_id=101,
            mlm_id=5002,
            month_date=date(2026, 4, 1),
            route_id=1,
        )
        _seed_tested_month(
            location_id=102,
            mlm_id=5003,
            month_date=date(2026, 5, 1),
            route_id=2,
        )
        _seed_tested_month(
            location_id=102,
            mlm_id=5004,
            month_date=date(2026, 4, 1),
            route_id=2,
        )
        db.session.commit()

    body = _get_earnings(client)
    assert body["trailing_months"] == 12
    assert body["period_start"] == "2025-07-01"
    assert body["period_end"] == "2026-06-01"

    top_numbers = [row["route"]["route_number"] for row in body["top_earners"]]
    lowest_numbers = [row["route"]["route_number"] for row in body["lowest_earners"]]
    assert top_numbers[0] == 3
    assert top_numbers[-1] == 2
    assert lowest_numbers[0] == 2
    assert lowest_numbers[-1] == 3

    top_row = body["top_earners"][0]
    assert top_row["revenue_total"] == 500.0
    bottom_row = body["lowest_earners"][0]
    assert bottom_row["revenue_total"] == 200.0


def test_typical_end_time_from_clock_events(earnings_client):
    client, app = earnings_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=5, weekday_iso=0, week_occurrence=1)
        loc_a = make_location(
            id=201,
            address="201 Alpha",
            monthly_route_id=1,
            route_stop_order=0,
            price_per_month=Decimal("50.00"),
        )
        loc_b = make_location(
            id=202,
            address="202 Beta",
            monthly_route_id=1,
            route_stop_order=1,
            price_per_month=Decimal("50.00"),
        )
        mlm_a_may = make_location_month(
            id=6001,
            location_id=201,
            month_date=date(2026, 5, 1),
            route_id=1,
            result_status="tested",
        )
        mlm_b_may = make_location_month(
            id=6002,
            location_id=202,
            month_date=date(2026, 5, 1),
            route_id=1,
            result_status="tested",
        )
        mlm_a_apr = make_location_month(
            id=6003,
            location_id=201,
            month_date=date(2026, 4, 1),
            route_id=1,
            result_status="tested",
        )
        db.session.add_all([route, loc_a, loc_b, mlm_a_may, mlm_b_may, mlm_a_apr])
        _seed_run_timing_month(
            row_id=20,
            route_id=1,
            month_first=date(2026, 5, 1),
            duration_minutes=8 * 60,
            clock_out_hour=17,
        )
        _seed_run_timing_month(
            row_id=21,
            route_id=1,
            month_first=date(2026, 4, 1),
            duration_minutes=7 * 60,
            clock_out_hour=16,
        )
        db.session.commit()

    body = _get_earnings(client)
    row = next(item for item in body["top_earners"] if item["route"]["route_number"] == 5)
    assert row["typical_end_time"] == "4:30 PM"
    assert row["typical_end_time_months_sampled"] == 2


def test_typical_end_time_from_service_trade_cache(earnings_client):
    client, app = earnings_client
    with app.app_context():
        _seed_route_with_tested_month(
            route_id=1,
            route_number=7,
            location_id=301,
            mlm_id=8001,
            month_date=date(2026, 5, 1),
            price=Decimal("80.00"),
        )
        _seed_run_timing_month(
            row_id=22,
            route_id=1,
            month_first=date(2026, 5, 1),
            duration_minutes=5 * 60 + 15,
            clock_out_hour=14,
            clock_out_minute=15,
        )
        db.session.commit()

    body = _get_earnings(client)
    row = next(item for item in body["top_earners"] if item["route"]["route_number"] == 7)
    assert row["typical_end_time"] == "2:15 PM"
    assert row["typical_end_time_months_sampled"] == 1


def test_demo_route_r99_excluded(earnings_client):
    client, app = earnings_client
    with app.app_context():
        _seed_route_with_tested_month(
            route_id=1,
            route_number=99,
            location_id=401,
            mlm_id=9001,
            month_date=date(2026, 5, 1),
            price=Decimal("999.00"),
        )
        _seed_route_with_tested_month(
            route_id=2,
            route_number=4,
            location_id=402,
            mlm_id=9002,
            month_date=date(2026, 5, 1),
            price=Decimal("10.00"),
        )
        db.session.commit()

    body = _get_earnings(client)
    all_numbers = {
        row["route"]["route_number"]
        for row in body["top_earners"] + body["lowest_earners"]
    }
    assert 99 not in all_numbers
    assert 4 in all_numbers


def test_fewer_than_five_routes_returns_all(earnings_client):
    client, app = earnings_client
    with app.app_context():
        _seed_route_with_tested_month(
            route_id=1,
            route_number=10,
            location_id=501,
            mlm_id=9101,
            month_date=date(2026, 5, 1),
            price=Decimal("50.00"),
        )
        _seed_route_with_tested_month(
            route_id=2,
            route_number=11,
            location_id=502,
            mlm_id=9102,
            month_date=date(2026, 5, 1),
            price=Decimal("75.00"),
        )
        db.session.commit()

    body = _get_earnings(client)
    assert len(body["top_earners"]) == 2
    assert len(body["lowest_earners"]) == 2


def test_route_without_active_location_excluded(earnings_client):
    client, app = earnings_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=12, weekday_iso=0, week_occurrence=1)
        loc = make_location(
            id=601,
            address="Cancelled site",
            monthly_route_id=1,
            route_stop_order=0,
            status_normalized="cancelled",
            status_raw="Cancelled",
            price_per_month=Decimal("100.00"),
        )
        db.session.add_all([route, loc])
        db.session.commit()

    body = _get_earnings(client)
    numbers = {
        row["route"]["route_number"]
        for row in body["top_earners"] + body["lowest_earners"]
    }
    assert 12 not in numbers
