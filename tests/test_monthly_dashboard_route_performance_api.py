"""GET /api/monthly_routes/dashboard/route_performance — operational route metrics."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import (
    MonthlyLocation,
    MonthlyRoute,
    MonthlyRouteCalculatedPath,
    MonthlyRouteRunTimingMonth,
    db,
)
from app.monthly.location_monitoring import location_has_monitoring
from app.monthly.service_trade_route_run_timing import SYNC_STATUS_OK
from app.routes import monthly_routes as mr_mod
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location, make_location_month

CURRENT_MONTH = date(2026, 6, 1)
PACIFIC = ZoneInfo("America/Vancouver")

PERFORMANCE_TABLES = [
    *WORKSHEET_TABLES,
    MonthlyRouteCalculatedPath.__table__,
]


@pytest.fixture
def performance_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: CURRENT_MONTH)
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=PERFORMANCE_TABLES)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["username"] = "office.staff"
                sess["authenticated"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(PERFORMANCE_TABLES)))


def _get_performance(client, *, range_key: str | None = None, months: int | None = None):
    query = ["cache_bust=1"]
    if range_key is not None:
        query.append(f"range={range_key}")
    if months is not None:
        query.append(f"months={months}")
    suffix = f"?{'&'.join(query)}"
    res = client.get(f"/api/monthly_routes/dashboard/route_performance{suffix}")
    assert res.status_code == 200, res.get_data(as_text=True)
    return res.get_json()


def _get_breakdown(client, *, range_key: str | None = None):
    query = ["cache_bust=1"]
    if range_key is not None:
        query.append(f"range={range_key}")
    suffix = f"?{'&'.join(query)}"
    res = client.get(f"/api/monthly_routes/dashboard/route_breakdown{suffix}")
    assert res.status_code == 200, res.get_data(as_text=True)
    return res.get_json()


def _seed_route(*, route_id: int, route_number: int, location_id: int, price: Decimal, tech_count: int | None = None):
    route = MonthlyRoute(
        id=route_id,
        route_number=route_number,
        weekday_iso=0,
        week_occurrence=1,
        tech_count=tech_count,
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
):
    mlm = make_location_month(
        id=mlm_id,
        location_id=location_id,
        month_date=month_date,
        route_id=route_id,
        result_status="tested",
        billing_status="bill",
    )
    db.session.add(mlm)


def _seed_skipped_month(
    *,
    location_id: int,
    mlm_id: int,
    month_date: date,
    route_id: int,
    skip_reason: str = "other",
    skip_category: str | None = None,
):
    fields: dict = {
        "result_status": "skipped",
        "test_outcome": "skipped",
        "skip_reason": skip_reason,
        "billing_status": "do_not_bill",
    }
    if skip_category is not None:
        fields["skip_category"] = skip_category
    mlm = make_location_month(
        id=mlm_id,
        location_id=location_id,
        month_date=month_date,
        route_id=route_id,
        **fields,
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
    clock_in_hour: int | None = None,
    clock_in_minute: int | None = None,
) -> None:
    end_minute = clock_out_hour * 60 + clock_out_minute
    if clock_in_hour is not None and clock_in_minute is not None:
        start_minute = clock_in_hour * 60 + clock_in_minute
    else:
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


def _seed_calculated_path(
    *,
    route_id: int,
    distance_meters: int = 12500,
    duration_seconds: int = 1800,
) -> None:
    db.session.add(
        MonthlyRouteCalculatedPath(
            monthly_route_id=route_id,
            profile="driving",
            provider="mapbox",
            distance_meters=distance_meters,
            duration_seconds=duration_seconds,
            geometry_geojson={"type": "LineString", "coordinates": []},
            stop_signature="abc123",
            waypoint_count=2,
        )
    )


def test_location_has_monitoring_structured_fields():
    loc = make_location(
        id=1,
        address="1 Test St",
        monitoring_account_number="ACC-1",
    )
    assert location_has_monitoring(loc) is True


def test_location_has_monitoring_parsed_notes():
    loc = make_location(
        id=2,
        address="2 Test St",
        monitoring_notes="Company: Paladin\nAcct: 12345",
    )
    assert location_has_monitoring(loc) is True


def test_location_has_monitoring_false_when_empty():
    loc = make_location(id=3, address="3 Test St")
    assert location_has_monitoring(loc) is False


def test_performance_last_month_skip_count(performance_client):
    client, app = performance_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc = make_location(
            id=101,
            address="101 Test St",
            monthly_route_id=1,
            route_stop_order=0,
            price_per_month=Decimal("100.00"),
        )
        db.session.add_all([route, loc])
        _seed_skipped_month(location_id=101, mlm_id=5002, month_date=date(2026, 5, 1), route_id=1)
        _seed_run_timing_month(
            row_id=1,
            route_id=1,
            month_first=date(2026, 5, 1),
            duration_minutes=360,
            clock_out_hour=14,
        )
        db.session.commit()

    body = _get_performance(client, range_key="last_month")
    row = next(r for r in body["rows"] if r["route"]["route_number"] == 2)
    assert row["skipped_non_annual"] == 1.0
    assert row["skipped_months_sampled"] == 1


def test_performance_multi_month_avg_skips(performance_client):
    client, app = performance_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc_a = make_location(
            id=101,
            address="101 Test St",
            monthly_route_id=1,
            route_stop_order=0,
            price_per_month=Decimal("100.00"),
        )
        loc_b = make_location(
            id=102,
            address="102 Test St",
            monthly_route_id=1,
            route_stop_order=1,
            price_per_month=Decimal("100.00"),
        )
        db.session.add_all([route, loc_a, loc_b])
        _seed_skipped_month(location_id=101, mlm_id=5002, month_date=date(2026, 5, 1), route_id=1)
        _seed_skipped_month(location_id=101, mlm_id=5004, month_date=date(2026, 4, 1), route_id=1)
        _seed_skipped_month(location_id=102, mlm_id=5005, month_date=date(2026, 4, 1), route_id=1)
        _seed_run_timing_month(
            row_id=1,
            route_id=1,
            month_first=date(2026, 5, 1),
            duration_minutes=360,
            clock_out_hour=14,
        )
        _seed_run_timing_month(
            row_id=2,
            route_id=1,
            month_first=date(2026, 4, 1),
            duration_minutes=360,
            clock_out_hour=14,
        )
        db.session.commit()

    body = _get_performance(client, range_key="last_12_months")
    row = next(r for r in body["rows"] if r["route"]["route_number"] == 2)
    assert row["skipped_non_annual"] == 1.5
    assert row["skipped_months_sampled"] == 2


def test_performance_excludes_annual_skips_from_count(performance_client):
    client, app = performance_client
    with app.app_context():
        _seed_route(route_id=1, route_number=2, location_id=101, price=Decimal("100.00"))
        _seed_skipped_month(
            location_id=101,
            mlm_id=5002,
            month_date=date(2026, 5, 1),
            route_id=1,
            skip_category="annual",
            skip_reason="annual",
        )
        _seed_run_timing_month(
            row_id=1,
            route_id=1,
            month_first=date(2026, 5, 1),
            duration_minutes=360,
            clock_out_hour=14,
        )
        db.session.commit()

    body = _get_performance(client, range_key="last_month")
    row = next(r for r in body["rows"] if r["route"]["route_number"] == 2)
    assert row["skipped_non_annual"] == 0.0


def test_performance_mapbox_cache_metrics(performance_client):
    client, app = performance_client
    with app.app_context():
        _seed_route(route_id=1, route_number=2, location_id=101, price=Decimal("100.00"))
        _seed_tested_month(location_id=101, mlm_id=5001, month_date=date(2026, 5, 1), route_id=1)
        _seed_calculated_path(route_id=1, distance_meters=14200, duration_seconds=2100)
        _seed_run_timing_month(
            row_id=1,
            route_id=1,
            month_first=date(2026, 5, 1),
            duration_minutes=360,
            clock_out_hour=14,
        )
        db.session.commit()

    body = _get_performance(client, range_key="last_month")
    row = next(r for r in body["rows"] if r["route"]["route_number"] == 2)
    assert row["distance_meters"] == 14200
    assert row["duration_seconds"] == 2100


def test_performance_monitoring_site_count(performance_client):
    client, app = performance_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc_mon = make_location(
            id=101,
            address="101 Test St",
            monthly_route_id=1,
            route_stop_order=0,
            monitoring_account_number="A-1",
        )
        loc_plain = make_location(
            id=102,
            address="102 Test St",
            monthly_route_id=1,
            route_stop_order=1,
        )
        db.session.add_all([route, loc_mon, loc_plain])
        _seed_tested_month(location_id=101, mlm_id=5001, month_date=date(2026, 5, 1), route_id=1)
        _seed_run_timing_month(
            row_id=1,
            route_id=1,
            month_first=date(2026, 5, 1),
            duration_minutes=360,
            clock_out_hour=14,
        )
        db.session.commit()

    body = _get_performance(client, range_key="last_month")
    row = next(r for r in body["rows"] if r["route"]["route_number"] == 2)
    assert row["building_count"] == 2
    assert row["monitoring_site_count"] == 1


def test_performance_net_pct_matches_financial_breakdown(performance_client):
    client, app = performance_client
    with app.app_context():
        _seed_route(route_id=1, route_number=2, location_id=101, price=Decimal("100.00"), tech_count=2)
        _seed_tested_month(location_id=101, mlm_id=5001, month_date=date(2026, 5, 1), route_id=1)
        _seed_run_timing_month(
            row_id=1,
            route_id=1,
            month_first=date(2026, 5, 1),
            duration_minutes=360,
            clock_out_hour=14,
        )
        db.session.commit()

    perf = _get_performance(client, range_key="last_month")
    breakdown = _get_breakdown(client, range_key="last_month")
    perf_row = next(r for r in perf["rows"] if r["route"]["route_number"] == 2)
    breakdown_row = next(r for r in breakdown["rows"] if r["route"]["route_number"] == 2)
    assert perf_row["avg_hours"] == breakdown_row["avg_hours"]
    assert perf_row["avg_hours_months_sampled"] == breakdown_row["avg_hours_months_sampled"]
    assert perf_row["monthly_net_pct"] == breakdown_row["monthly_net_pct"]
    assert perf_row["has_sufficient_run_time_data"] == breakdown_row["has_sufficient_run_time_data"]


def test_performance_insufficient_run_time_section(performance_client):
    client, app = performance_client
    with app.app_context():
        _seed_route(route_id=1, route_number=2, location_id=101, price=Decimal("100.00"))
        db.session.commit()

    body = _get_performance(client, range_key="last_month")
    row = next(r for r in body["rows"] if r["route"]["route_number"] == 2)
    assert row["has_sufficient_run_time_data"] is False
    assert row["monthly_net_pct"] is None


def test_demo_route_r99_excluded(performance_client):
    client, app = performance_client
    with app.app_context():
        _seed_route(route_id=1, route_number=99, location_id=401, price=Decimal("999.00"))
        _seed_route(route_id=2, route_number=4, location_id=402, price=Decimal("10.00"))
        _seed_tested_month(location_id=402, mlm_id=9002, month_date=date(2026, 5, 1), route_id=2)
        _seed_run_timing_month(
            row_id=1,
            route_id=2,
            month_first=date(2026, 5, 1),
            duration_minutes=360,
            clock_out_hour=14,
        )
        db.session.commit()

    body = _get_performance(client, range_key="last_month")
    route_numbers = {row["route"]["route_number"] for row in body["rows"]}
    assert 99 not in route_numbers
    assert 4 in route_numbers


def test_performance_last_quarter_total_skips(performance_client):
    client, app = performance_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc = make_location(
            id=101,
            address="101 Test St",
            monthly_route_id=1,
            route_stop_order=0,
            price_per_month=Decimal("100.00"),
        )
        db.session.add_all([route, loc])
        _seed_skipped_month(location_id=101, mlm_id=5001, month_date=date(2026, 1, 1), route_id=1)
        _seed_skipped_month(location_id=101, mlm_id=5002, month_date=date(2026, 2, 1), route_id=1)
        _seed_skipped_month(location_id=101, mlm_id=5003, month_date=date(2026, 3, 1), route_id=1)
        _seed_run_timing_month(
            row_id=1,
            route_id=1,
            month_first=date(2026, 3, 1),
            duration_minutes=360,
            clock_out_hour=14,
        )
        db.session.commit()

    body = _get_performance(client, range_key="last_quarter")
    row = next(r for r in body["rows"] if r["route"]["route_number"] == 2)
    assert row["skipped_non_annual"] == 3.0
    assert row["skipped_months_sampled"] == 3


def test_performance_range_last_quarter(performance_client):
    client, app = performance_client
    with app.app_context():
        _seed_route(route_id=1, route_number=2, location_id=101, price=Decimal("100.00"))
        _seed_tested_month(location_id=101, mlm_id=5001, month_date=date(2026, 3, 1), route_id=1)
        _seed_run_timing_month(
            row_id=1,
            route_id=1,
            month_first=date(2026, 3, 1),
            duration_minutes=360,
            clock_out_hour=14,
        )
        db.session.commit()

    body = _get_performance(client, range_key="last_quarter")
    assert body["range"] == "last_quarter"
    assert body["period_start"] == "2026-01-01"
    assert body["period_end"] == "2026-03-01"


def test_performance_field_duration_and_pre_route_gap(performance_client):
    client, app = performance_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=6, weekday_iso=0, week_occurrence=1)
        loc = make_location(
            id=101,
            address="101 Test St",
            monthly_route_id=1,
            route_stop_order=0,
            price_per_month=Decimal("100.00"),
        )
        mlm = make_location_month(
            id=5001,
            location_id=101,
            month_date=date(2026, 5, 1),
            route_id=1,
            result_status="tested",
            billing_status="bill",
            sheet_time_in_raw="8:26 AM",
            sheet_time_out_raw="4:30 PM",
        )
        db.session.add_all([route, loc, mlm])
        _seed_run_timing_month(
            row_id=1,
            route_id=1,
            month_first=date(2026, 5, 1),
            duration_minutes=516,
            clock_out_hour=16,
            clock_out_minute=36,
            clock_in_hour=8,
            clock_in_minute=6,
        )
        db.session.commit()

    body = _get_performance(client, range_key="last_month")
    row = next(r for r in body["rows"] if r["route"]["route_number"] == 6)
    assert row["avg_hours"] == 8.6
    assert row["pre_route_gap_minutes"] == 20
    assert row["field_avg_hours"] == 8.2
    assert row["field_avg_hours"] < row["avg_hours"]
