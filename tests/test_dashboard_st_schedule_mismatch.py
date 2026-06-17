"""Route test day and ST schedule mismatch."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

from app.monthly.dashboard_st_schedule_mismatch import dashboard_st_schedule_mismatch
from app.monthly.route_test_day import effective_route_test_day
from app.monthly.service_trade_route_run_timing import SYNC_STATUS_SCHEDULED


def test_effective_route_test_day_nominal():
    day = effective_route_test_day(
        date(2026, 6, 1),
        weekday_iso=2,
        week_occurrence=1,
    )
    assert day == date(2026, 6, 3)


def test_effective_route_test_day_bumps_victoria_day_monday():
    day = effective_route_test_day(
        date(2026, 5, 1),
        weekday_iso=0,
        week_occurrence=3,
    )
    assert day == date(2026, 5, 25)


def test_effective_route_test_day_no_slot_when_all_holidays():
    day = effective_route_test_day(
        date(2026, 5, 1),
        weekday_iso=0,
        week_occurrence=5,
    )
    assert day is None


def test_dashboard_mismatch_when_st_appointment_differs():
    route = SimpleNamespace(id=1, weekday_iso=2, week_occurrence=1)
    timing = SimpleNamespace(
        service_trade_qualifying_appointment_on=date(2026, 6, 4),
        service_trade_job_status="scheduled",
        sync_status=SYNC_STATUS_SCHEDULED,
    )
    mismatch = dashboard_st_schedule_mismatch(date(2026, 6, 1), route, timing)
    assert mismatch == {
        "route_date": "2026-06-03",
        "appointment_date": "2026-06-04",
    }


def test_dashboard_no_mismatch_when_dates_match():
    route = SimpleNamespace(id=1, weekday_iso=2, week_occurrence=1)
    timing = SimpleNamespace(
        service_trade_qualifying_appointment_on=date(2026, 6, 3),
        service_trade_job_status="scheduled",
        sync_status=SYNC_STATUS_SCHEDULED,
    )
    assert dashboard_st_schedule_mismatch(date(2026, 6, 1), route, timing) is None


def test_dashboard_no_mismatch_for_completed_job():
    route = SimpleNamespace(id=1, weekday_iso=2, week_occurrence=1)
    timing = SimpleNamespace(
        service_trade_qualifying_appointment_on=date(2026, 6, 4),
        service_trade_job_status="completed",
        sync_status="ok",
    )
    assert dashboard_st_schedule_mismatch(date(2026, 6, 1), route, timing) is None
