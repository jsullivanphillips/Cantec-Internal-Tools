"""Field route duration from first-stop time-in vs ServiceTrade job timing."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.db_models import MonthlyLocation, MonthlyRouteRunTimingMonth
from app.monthly.route_performance_breakdown import (
    _stop_sort_key,
    _testing_history_rows_attributed_to_route_month,
    visit_minutes_for_mlm,
)
from app.monthly.route_run_timing import SYNC_STATUS_OK, _timing_rows_for_window
from app.monthly.visit_clock_times import (
    duration_minutes_from_start_end,
    median_minutes,
    parse_visit_clock_minutes,
)

PACIFIC = ZoneInfo("America/Vancouver")


def _datetime_to_pacific_minutes(dt: datetime) -> int:
    pacific = dt.astimezone(PACIFIC)
    return pacific.hour * 60 + pacific.minute


def _stop_time_in_minutes(mlm) -> int | None:
    _minutes, time_in, _time_out, _source = visit_minutes_for_mlm(mlm)
    if not time_in:
        return None
    return parse_visit_clock_minutes(time_in)


def _stop_time_out_minutes(mlm) -> int | None:
    _minutes, _time_in, time_out, _source = visit_minutes_for_mlm(mlm)
    if not time_out:
        return None
    return parse_visit_clock_minutes(time_out)


def _ordered_stop_pairs(route_id: int, month_first: date) -> list[tuple[MonthlyLocation, object]]:
    history_rows = _testing_history_rows_attributed_to_route_month(route_id, month_first)
    if not history_rows:
        return []
    mlm_by_loc = {int(row.monthly_location_id): row for row in history_rows}
    locations = MonthlyLocation.query.filter(MonthlyLocation.id.in_(mlm_by_loc.keys())).all()
    pairs: list[tuple[MonthlyLocation, object]] = []
    for loc in locations:
        mlm = mlm_by_loc.get(int(loc.id))
        if mlm is not None:
            pairs.append((loc, mlm))
    pairs.sort(key=lambda pair: _stop_sort_key(pair[0], pair[1]))
    return pairs


def field_timing_for_route_month(
    route_id: int,
    month_first: date,
    *,
    timing_row: MonthlyRouteRunTimingMonth | None = None,
) -> tuple[int | None, int | None]:
    """Return ``(field_duration_minutes, pre_route_gap_minutes)`` for one Pacific month."""
    pairs = _ordered_stop_pairs(route_id, month_first)
    if not pairs:
        return None, None

    first_stop_in: int | None = None
    for _loc, mlm in pairs:
        time_in = _stop_time_in_minutes(mlm)
        if time_in is not None:
            first_stop_in = time_in
            break

    last_stop_out: int | None = None
    for _loc, mlm in reversed(pairs):
        time_out = _stop_time_out_minutes(mlm)
        if time_out is not None:
            last_stop_out = time_out
            break

    route_end: int | None = None
    if timing_row is not None and timing_row.clock_out_at is not None:
        route_end = _datetime_to_pacific_minutes(timing_row.clock_out_at)
    elif last_stop_out is not None:
        route_end = last_stop_out

    field_duration: int | None = None
    if first_stop_in is not None and route_end is not None:
        field_duration = duration_minutes_from_start_end(first_stop_in, route_end)

    pre_route_gap: int | None = None
    if (
        timing_row is not None
        and timing_row.clock_in_at is not None
        and first_stop_in is not None
    ):
        st_in = _datetime_to_pacific_minutes(timing_row.clock_in_at)
        gap = first_stop_in - st_in
        if gap >= 0:
            pre_route_gap = gap

    return field_duration, pre_route_gap


def _timing_row_by_month(route_id: int, month_keys: set[str]) -> dict[str, MonthlyRouteRunTimingMonth]:
    rows = _timing_rows_for_window(route_id, month_keys)
    return {row.month_first.isoformat(): row for row in rows}


def route_median_field_timing(
    route_id: int,
    month_keys: set[str],
) -> tuple[int | None, int, int | None, int]:
    """Median field duration and pre-route gap across months with each metric available."""
    if not month_keys:
        return None, 0, None, 0

    timing_by_month = _timing_row_by_month(route_id, month_keys)
    field_durations: list[int] = []
    pre_route_gaps: list[int] = []

    for month_key in sorted(month_keys):
        month_first = date.fromisoformat(month_key)
        timing_row = timing_by_month.get(month_key)
        if timing_row is None:
            timing_row = MonthlyRouteRunTimingMonth.query.filter_by(
                monthly_route_id=int(route_id),
                month_first=month_first,
                sync_status=SYNC_STATUS_OK,
            ).one_or_none()
        field_duration, pre_route_gap = field_timing_for_route_month(
            route_id,
            month_first,
            timing_row=timing_row,
        )
        if field_duration is not None:
            field_durations.append(field_duration)
        if pre_route_gap is not None:
            pre_route_gaps.append(pre_route_gap)

    field_typical = median_minutes(field_durations)
    gap_typical = median_minutes(pre_route_gaps)
    return field_typical, len(field_durations), gap_typical, len(pre_route_gaps)
