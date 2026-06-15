"""Run timing from ServiceTrade testing-job clock cache."""

from __future__ import annotations

from datetime import date
from zoneinfo import ZoneInfo

from app.db_models import MonthlyRouteRunTimingMonth
from app.monthly.visit_clock_times import (
    format_visit_clock_minutes,
    median_minutes,
)

PACIFIC = ZoneInfo("America/Vancouver")
SYNC_STATUS_OK = "ok"


def _month_keys_to_dates(month_keys: set[str]) -> list[date]:
    return sorted(date.fromisoformat(key) for key in month_keys)


def _timing_rows_for_window(route_id: int, month_keys: set[str]) -> list[MonthlyRouteRunTimingMonth]:
    if not month_keys:
        return []
    month_dates = _month_keys_to_dates(month_keys)
    return (
        MonthlyRouteRunTimingMonth.query.filter(
            MonthlyRouteRunTimingMonth.monthly_route_id == int(route_id),
            MonthlyRouteRunTimingMonth.month_first.in_(month_dates),
            MonthlyRouteRunTimingMonth.sync_status == SYNC_STATUS_OK,
            MonthlyRouteRunTimingMonth.duration_minutes.isnot(None),
        )
        .order_by(MonthlyRouteRunTimingMonth.month_first.asc())
        .all()
    )


def route_median_run_duration_minutes(
    route_id: int,
    month_keys: set[str],
) -> tuple[int | None, int]:
    rows = _timing_rows_for_window(route_id, month_keys)
    month_durations = [int(row.duration_minutes) for row in rows if row.duration_minutes is not None]
    typical = median_minutes(month_durations)
    if typical is None:
        return None, 0
    return typical, len(month_durations)


def route_typical_end_time(
    route_id: int,
    month_keys: set[str],
) -> tuple[str | None, int]:
    rows = _timing_rows_for_window(route_id, month_keys)
    month_run_ends: list[int] = []
    for row in rows:
        if row.clock_out_at is None:
            continue
        out_pacific = row.clock_out_at.astimezone(PACIFIC)
        month_run_ends.append(out_pacific.hour * 60 + out_pacific.minute)

    typical = median_minutes(month_run_ends)
    if typical is None:
        return None, 0
    return format_visit_clock_minutes(typical), len(month_run_ends)
