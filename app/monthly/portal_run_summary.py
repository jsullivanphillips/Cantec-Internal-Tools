"""Technician portal run summary shown after End field run."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.db_models import MonthlyRouteRun
from app.monthly.dashboard_route_metrics import (
    BREAKDOWN_RANGE_LAST_12_MONTHS,
    resolve_breakdown_period,
)
from app.monthly.route_field_timing import (
    _ordered_stop_pairs,
    _stop_time_in_minutes,
    field_timing_for_route_month,
    route_median_field_timing,
)
from app.monthly.route_performance_breakdown import (
    _build_stop_rows,
    _testing_history_rows_attributed_to_route_month,
)
from app.monthly.route_run_timing import route_typical_end_time
from app.monthly.visit_clock_times import (
    duration_minutes_from_start_end,
    format_visit_clock_minutes,
    median_minutes,
    parse_visit_clock_minutes,
)

PACIFIC = ZoneInfo("America/Vancouver")
DEFAULT_ANNUAL_SKIP_MINUTES = 12
MIN_HISTORY_MONTHS = 2
ON_TIME_THRESHOLD_MINUTES = 5
MIN_ANNUAL_VISIT_SAMPLES = 3


def _datetime_to_pacific_minutes(dt: datetime) -> int:
    pacific = dt.astimezone(PACIFIC)
    return pacific.hour * 60 + pacific.minute


def _month_has_testing_activity(cell: dict) -> bool:
    tested = int(cell.get("sites_tested_count") or 0)
    skipped_na = int(cell.get("skipped_non_annual_count") or 0)
    skipped_ann = int(cell.get("skipped_annual_count") or 0)
    return tested + skipped_na + skipped_ann > 0


def _historical_month_keys(exclude_month: date) -> set[str]:
    _period_start, _period_end, month_keys, _label = resolve_breakdown_period(
        exclude_month,
        BREAKDOWN_RANGE_LAST_12_MONTHS,
    )
    exclude_iso = exclude_month.isoformat()
    return {key for key in month_keys if key != exclude_iso}


def _outcome_counts(route_id: int, month_first: date) -> dict[str, int]:
    from app.db_models import MonthlyLocation

    locations = (
        MonthlyLocation.query.filter_by(
            monthly_route_id=int(route_id),
            status_normalized="active",
        )
        .order_by(
            MonthlyLocation.route_stop_order.asc().nulls_last(),
            MonthlyLocation.address.asc(),
        )
        .all()
    )
    history_rows = _testing_history_rows_attributed_to_route_month(route_id, month_first)
    mlm_by_loc = {int(r.monthly_location_id): r for r in history_rows}
    stops = _build_stop_rows(route_id, month_first, locations, mlm_by_loc)
    return {
        "tested": sum(1 for s in stops if s.get("outcome") == "tested"),
        "skipped_annual": sum(1 for s in stops if s.get("outcome") == "skipped_annual"),
        "skipped_non_annual": sum(1 for s in stops if s.get("outcome") == "skipped_non_annual"),
    }


def _field_duration_for_run(
    route_id: int,
    month_first: date,
    run: MonthlyRouteRun,
) -> int | None:
    pairs = _ordered_stop_pairs(route_id, month_first)
    if not pairs:
        return None

    first_stop_in: int | None = None
    for _loc, mlm in pairs:
        time_in = _stop_time_in_minutes(mlm)
        if time_in is not None:
            first_stop_in = time_in
            break

    route_end: int | None = None
    if run.field_ended_at is not None:
        route_end = _datetime_to_pacific_minutes(run.field_ended_at)
    else:
        field_duration, _pre_route = field_timing_for_route_month(route_id, month_first)
        return field_duration

    if first_stop_in is not None and route_end is not None:
        return duration_minutes_from_start_end(first_stop_in, route_end)
    return None


def _field_end_time_for_run(run: MonthlyRouteRun) -> str | None:
    if run.field_ended_at is None:
        return None
    return format_visit_clock_minutes(_datetime_to_pacific_minutes(run.field_ended_at))


def _median_annual_skip_count(
    testing_by_month: dict[str, dict],
    month_keys: set[str],
) -> tuple[int | None, int]:
    counts: list[int] = []
    for month_key in sorted(month_keys):
        cell = testing_by_month.get(month_key)
        if not cell or not _month_has_testing_activity(cell):
            continue
        counts.append(int(cell.get("skipped_annual_count") or 0))
    typical = median_minutes(counts)
    if typical is None:
        return None, 0
    return typical, len(counts)


def _annual_skip_visit_minutes_for_route(
    route_id: int,
    month_keys: set[str],
) -> list[int]:
    from app.db_models import MonthlyLocation

    samples: list[int] = []
    for month_key in sorted(month_keys):
        month_first = date.fromisoformat(month_key)
        locations = MonthlyLocation.query.filter_by(
            monthly_route_id=int(route_id),
            status_normalized="active",
        ).all()
        history_rows = _testing_history_rows_attributed_to_route_month(route_id, month_first)
        mlm_by_loc = {int(r.monthly_location_id): r for r in history_rows}
        stops = _build_stop_rows(route_id, month_first, locations, mlm_by_loc)
        for stop in stops:
            if stop.get("outcome") != "skipped_annual":
                continue
            visit_minutes = stop.get("visit_minutes")
            if isinstance(visit_minutes, int) and visit_minutes > 0:
                samples.append(visit_minutes)
    return samples


def _minutes_per_annual_skip(route_id: int, month_keys: set[str]) -> int:
    samples = _annual_skip_visit_minutes_for_route(route_id, month_keys)
    if len(samples) >= MIN_ANNUAL_VISIT_SAMPLES:
        typical = median_minutes(samples)
        if typical is not None and typical > 0:
            return typical
    return DEFAULT_ANNUAL_SKIP_MINUTES


def _comparison_direction(delta_minutes: int) -> str:
    if abs(delta_minutes) <= ON_TIME_THRESHOLD_MINUTES:
        return "on_time"
    return "early" if delta_minutes < 0 else "late"


def _field_duration_comparison(
    *,
    current_duration: int,
    current_annual: int,
    typical_duration: int,
    typical_annual: int,
    minutes_per_annual: int,
    months_sampled: int,
) -> dict[str, object]:
    normalized_current = current_duration - (current_annual * minutes_per_annual)
    normalized_typical = typical_duration - (typical_annual * minutes_per_annual)
    delta = normalized_current - normalized_typical
    return {
        "delta_minutes": delta,
        "direction": _comparison_direction(delta),
        "typical_minutes": typical_duration,
        "months_sampled": months_sampled,
    }


def _finish_time_comparison(
    *,
    current_end_time: str,
    current_annual: int,
    typical_end_time: str,
    typical_annual: int,
    minutes_per_annual: int,
    months_sampled: int,
) -> dict[str, object] | None:
    current_minutes = parse_visit_clock_minutes(current_end_time)
    typical_minutes = parse_visit_clock_minutes(typical_end_time)
    if current_minutes is None or typical_minutes is None:
        return None
    adjusted_typical = typical_minutes - ((current_annual - typical_annual) * minutes_per_annual)
    delta = current_minutes - adjusted_typical
    return {
        "delta_minutes": delta,
        "direction": _comparison_direction(delta),
        "typical_end_time": typical_end_time,
        "months_sampled": months_sampled,
    }


def build_portal_run_summary(
    route_id: int,
    month_first: date,
    run: MonthlyRouteRun,
) -> dict[str, object]:
    """Build technician-facing run summary after field end."""
    from app.routes.monthly_routes import _route_testing_by_month

    outcomes = _outcome_counts(route_id, month_first)
    field_duration_minutes = _field_duration_for_run(route_id, month_first, run)
    field_end_time = _field_end_time_for_run(run)
    current_annual = int(outcomes["skipped_annual"])

    history_keys = _historical_month_keys(month_first)
    testing_by_month = _route_testing_by_month(route_id)

    typical_field_duration, field_months_sampled, _gap_typical, _gap_months = route_median_field_timing(
        route_id,
        history_keys,
    )
    typical_end_time, finish_months_sampled = route_typical_end_time(route_id, history_keys)
    typical_annual, _annual_months = _median_annual_skip_count(testing_by_month, history_keys)
    minutes_per_annual = _minutes_per_annual_skip(route_id, history_keys)

    comparisons: dict[str, object] = {}
    has_sufficient_history = False

    if (
        field_duration_minutes is not None
        and typical_field_duration is not None
        and typical_annual is not None
        and field_months_sampled >= MIN_HISTORY_MONTHS
    ):
        comparisons["field_duration"] = _field_duration_comparison(
            current_duration=int(field_duration_minutes),
            current_annual=current_annual,
            typical_duration=int(typical_field_duration),
            typical_annual=int(typical_annual),
            minutes_per_annual=minutes_per_annual,
            months_sampled=field_months_sampled,
        )
        has_sufficient_history = True

    if (
        field_end_time is not None
        and typical_end_time is not None
        and typical_annual is not None
        and finish_months_sampled >= MIN_HISTORY_MONTHS
    ):
        finish_cmp = _finish_time_comparison(
            current_end_time=field_end_time,
            current_annual=current_annual,
            typical_end_time=typical_end_time,
            typical_annual=int(typical_annual),
            minutes_per_annual=minutes_per_annual,
            months_sampled=finish_months_sampled,
        )
        if finish_cmp is not None:
            comparisons["finish_time"] = finish_cmp
            has_sufficient_history = True

    return {
        "outcomes": outcomes,
        "field_duration_minutes": field_duration_minutes,
        "field_end_time": field_end_time,
        "annual_minutes_per_skip": minutes_per_annual,
        "comparisons": comparisons,
        "has_sufficient_history": has_sufficient_history,
    }
