"""Dashboard route card vs ServiceTrade appointment date mismatch."""

from __future__ import annotations

from datetime import date

from app.db_models import MonthlyRoute, MonthlyRouteRunTimingMonth
from app.monthly.route_test_day import effective_route_test_day
from app.monthly.service_trade_route_run_timing import SYNC_STATUS_SCHEDULED


def _timing_row_has_scheduled_appointment(row: MonthlyRouteRunTimingMonth) -> bool:
    if row.service_trade_qualifying_appointment_on is None:
        return False
    job_status = (row.service_trade_job_status or "").strip().lower()
    if job_status == "completed":
        return False
    if row.sync_status == SYNC_STATUS_SCHEDULED:
        return True
    return job_status == "scheduled"


def dashboard_st_schedule_mismatch(
    month_first: date,
    route: MonthlyRoute,
    timing_row: MonthlyRouteRunTimingMonth | None,
) -> dict[str, str] | None:
    """Return ``{route_date, appointment_date}`` ISO strings when dates differ."""
    if timing_row is None or not _timing_row_has_scheduled_appointment(timing_row):
        return None
    appointment_on = timing_row.service_trade_qualifying_appointment_on
    if appointment_on is None:
        return None
    route_on = effective_route_test_day(
        month_first,
        weekday_iso=int(route.weekday_iso),
        week_occurrence=int(route.week_occurrence),
    )
    if route_on is None:
        return None
    if appointment_on == route_on:
        return None
    return {
        "route_date": route_on.isoformat(),
        "appointment_date": appointment_on.isoformat(),
    }
