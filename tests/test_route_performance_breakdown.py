"""GET /api/monthly_routes/routes/:id/performance_breakdown — route detail profitability."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import MonthlyRoute, MonthlyRouteRunTimingMonth, MonthlyStopClockEvent, db
from app.monthly.route_expense_constants import (
    LABOUR_RATE_PER_HOUR,
    TRUCK_CHARGE_PER_MONTH,
    billed_avg_hours,
)
from app.monthly.service_trade_route_run_timing import SYNC_STATUS_OK
from app.routes import monthly_routes as mr_mod
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location, make_location_month

MAY = date(2026, 5, 1)
PACIFIC = ZoneInfo("America/Vancouver")


@pytest.fixture
def perf_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))
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


def _get_breakdown(client, route_id: int, month_date: str):
    res = client.get(
        f"/api/monthly_routes/routes/{route_id}/performance_breakdown"
        f"?month_date={month_date}"
    )
    return res


def _seed_route_with_stop(
    *,
    route_id: int = 4,
    location_id: int = 401,
    price: Decimal = Decimal("655.00"),
    tech_count: int | None = None,
):
    route = MonthlyRoute(
        id=route_id,
        route_number=route_id,
        weekday_iso=0,
        week_occurrence=1,
        tech_count=tech_count,
    )
    loc = make_location(
        id=location_id,
        address="401 Test St",
        monthly_route_id=route_id,
        route_stop_order=0,
        price_per_month=price,
    )
    db.session.add_all([route, loc])
    return route_id, location_id


def _seed_timing(
    *,
    row_id: int,
    route_id: int,
    month_first: date,
    duration_minutes: int,
):
    end_minute = 16 * 60
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
        16,
        0,
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


def test_sheet_time_visit_minutes_and_revenue(perf_client):
    client, _app = perf_client
    route_id, location_id = _seed_route_with_stop(price=Decimal("120.00"))
    mlm = make_location_month(
        id=1,
        location_id=location_id,
        month_date=MAY,
        route_id=route_id,
        result_status="tested",
        billing_status="bill",
        sheet_time_in_raw="8:30 AM",
        sheet_time_out_raw="9:15 AM",
    )
    db.session.add(mlm)
    db.session.commit()

    res = _get_breakdown(client, route_id, MAY.isoformat())
    assert res.status_code == 200, res.get_data(as_text=True)
    payload = res.get_json()
    assert payload["month_date"] == MAY.isoformat()
    assert MAY.isoformat() in payload["available_months"]

    stop = payload["stops"][0]
    assert stop["outcome"] == "tested"
    assert stop["visit_minutes"] == 45
    assert stop["visit_time_source"] == "sheet"
    assert stop["revenue"] == 120.0
    assert payload["summary"]["tested_revenue_total"] == 120.0


def test_portal_clock_events_visit_minutes(perf_client):
    client, _app = perf_client
    route_id, location_id = _seed_route_with_stop(price=Decimal("80.00"))
    mlm = make_location_month(
        id=2,
        location_id=location_id,
        month_date=MAY,
        route_id=route_id,
        result_status="tested",
    )
    db.session.add(mlm)
    db.session.flush()
    db.session.add_all(
        [
            MonthlyStopClockEvent(
                id=1,
                monthly_location_month_id=int(mlm.id),
                sort_order=0,
                time_in_raw="10:00 AM",
                time_out_raw="10:30 AM",
            ),
            MonthlyStopClockEvent(
                id=2,
                monthly_location_month_id=int(mlm.id),
                sort_order=1,
                time_in_raw="10:35 AM",
                time_out_raw="11:05 AM",
            ),
        ]
    )
    db.session.commit()

    res = _get_breakdown(client, route_id, MAY.isoformat())
    assert res.status_code == 200
    stop = res.get_json()["stops"][0]
    assert stop["visit_time_source"] == "portal"
    assert stop["visit_minutes"] == 65
    assert stop["time_in"] == "10:00 AM"
    assert stop["time_out"] == "11:05 AM"


def test_revenue_per_route_hour_when_no_stop_times(perf_client):
    client, _app = perf_client
    route_id, location_id = _seed_route_with_stop(price=Decimal("655.00"))
    mlm = make_location_month(
        id=3,
        location_id=location_id,
        month_date=MAY,
        route_id=route_id,
        result_status="tested",
        billing_status="bill",
    )
    db.session.add(mlm)
    _seed_timing(row_id=1, route_id=route_id, month_first=MAY, duration_minutes=408)
    db.session.commit()

    res = _get_breakdown(client, route_id, MAY.isoformat())
    assert res.status_code == 200
    payload = res.get_json()
    summary = payload["summary"]
    assert summary["route_duration_minutes"] == 408
    assert summary["route_hours"] == 6.8
    assert summary["route_clock_in"] == "9:12 AM"
    assert summary["route_clock_out"] == "4:00 PM"
    assert summary["revenue_per_route_hour"] == pytest.approx(655.0 / 6.8, rel=0.01)
    assert summary["visit_time_coverage"] == "none"
    assert not any("ServiceTrade run timing" in line for line in payload["insights"])


def test_expense_net_matches_dashboard_formula(perf_client):
    client, _app = perf_client
    route_id, location_id = _seed_route_with_stop(price=Decimal("655.00"), tech_count=2)
    mlm = make_location_month(
        id=4,
        location_id=location_id,
        month_date=MAY,
        route_id=route_id,
        result_status="tested",
        billing_status="bill",
    )
    db.session.add(mlm)
    duration_minutes = 408
    _seed_timing(row_id=2, route_id=route_id, month_first=MAY, duration_minutes=duration_minutes)
    db.session.commit()

    route_hours = duration_minutes / 60.0
    billed = billed_avg_hours(route_hours)
    expected_expense = round(
        LABOUR_RATE_PER_HOUR * 2 * float(billed) + TRUCK_CHARGE_PER_MONTH,
        2,
    )

    res = _get_breakdown(client, route_id, MAY.isoformat())
    assert res.status_code == 200
    summary = res.get_json()["summary"]
    assert summary["monthly_expense"] == expected_expense
    assert summary["monthly_net"] == round(655.0 - expected_expense, 2)
    assert summary["monthly_net_pct"] == pytest.approx(
        (655.0 - expected_expense) / 655.0,
        rel=0.001,
    )


def test_skipped_with_bill_status_includes_revenue(perf_client):
    client, _app = perf_client
    route_id, location_id = _seed_route_with_stop(price=Decimal("85.00"))
    mlm = make_location_month(
        id=6,
        location_id=location_id,
        month_date=MAY,
        route_id=route_id,
        result_status="skipped",
        test_outcome="skipped",
        skip_category="other",
        billing_status="bill",
    )
    db.session.add(mlm)
    db.session.commit()

    res = _get_breakdown(client, route_id, MAY.isoformat())
    assert res.status_code == 200
    stop = res.get_json()["stops"][0]
    assert stop["outcome"] == "skipped_non_annual"
    assert stop["billing_status"] == "bill"
    assert stop["revenue"] == 85.0
    assert res.get_json()["summary"]["tested_revenue_total"] == 85.0


def test_tested_without_bill_status_excludes_revenue(perf_client):
    client, _app = perf_client
    route_id, location_id = _seed_route_with_stop(price=Decimal("200.00"))
    mlm = make_location_month(
        id=5,
        location_id=location_id,
        month_date=MAY,
        route_id=route_id,
        result_status="tested",
        billing_status="do_not_bill",
    )
    db.session.add(mlm)
    db.session.commit()

    res = _get_breakdown(client, route_id, MAY.isoformat())
    assert res.status_code == 200
    payload = res.get_json()
    stop = payload["stops"][0]
    assert stop["outcome"] == "tested"
    assert stop["billing_status"] == "do_not_bill"
    assert stop["revenue"] == 0.0
    assert payload["summary"]["tested_revenue_total"] == 0.0
    assert any("not marked Bill" in line for line in payload["insights"])


def test_stop_label_prefers_site_label_over_address(perf_client):
    client, _app = perf_client
    route = MonthlyRoute(
        id=10,
        route_number=10,
        weekday_iso=0,
        week_occurrence=1,
    )
    loc = make_location(
        id=1001,
        address="999 Long Street Name",
        label="Tower B",
        monthly_route_id=10,
        route_stop_order=0,
    )
    db.session.add_all([route, loc])
    db.session.commit()

    res = _get_breakdown(client, 10, MAY.isoformat())
    assert res.status_code == 200
    assert res.get_json()["stops"][0]["label"] == "Tower B"


def test_missing_month_date_returns_400(perf_client):
    client, _app = perf_client
    route_id, _ = _seed_route_with_stop()
    db.session.commit()
    res = client.get(f"/api/monthly_routes/routes/{route_id}/performance_breakdown")
    assert res.status_code == 400


def test_unknown_route_returns_404(perf_client):
    client, _app = perf_client
    res = _get_breakdown(client, 9999, MAY.isoformat())
    assert res.status_code == 404


def test_available_months_includes_servicetrade_timing_without_ok_sync(perf_client):
    client, _app = perf_client
    route_id, _ = _seed_route_with_stop()
    july = date(2025, 7, 1)
    db.session.add(
        MonthlyRouteRunTimingMonth(
            id=100,
            monthly_route_id=route_id,
            month_first=july,
            service_trade_job_id=9001,
            sync_status="no_clocks",
            duration_minutes=None,
        )
    )
    db.session.commit()

    res = _get_breakdown(client, route_id, MAY.isoformat())
    assert res.status_code == 200
    assert july.isoformat() in res.get_json()["available_months"]


def test_available_months_includes_stamped_history_after_location_moved(perf_client):
    client, _app = perf_client
    route_a = 11
    route_b = 12
    location_id = 411
    july = date(2025, 7, 1)
    db.session.add_all(
        [
            MonthlyRoute(
                id=route_a,
                route_number=11,
                weekday_iso=0,
                week_occurrence=1,
            ),
            MonthlyRoute(
                id=route_b,
                route_number=12,
                weekday_iso=0,
                week_occurrence=1,
            ),
            make_location(
                id=location_id,
                address="411 Moved St",
                monthly_route_id=route_b,
                route_stop_order=0,
            ),
            make_location_month(
                id=4111,
                location_id=location_id,
                month_date=july,
                route_id=route_a,
                result_status="tested",
                billing_status="bill",
            ),
        ]
    )
    db.session.commit()

    res = _get_breakdown(client, route_a, july.isoformat())
    assert res.status_code == 200
    assert july.isoformat() in res.get_json()["available_months"]
