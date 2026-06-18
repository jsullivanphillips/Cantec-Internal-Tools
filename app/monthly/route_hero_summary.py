"""All-time summary metrics for the monthly route detail hero card."""

from __future__ import annotations

from datetime import date
from zoneinfo import ZoneInfo

from app.db_models import MonthlyRoute, MonthlyRouteRunTimingMonth
from app.monthly.dashboard_route_metrics import _monthly_expense_for_route
from app.monthly.route_run_timing import SYNC_STATUS_OK
from app.monthly.visit_clock_times import format_visit_clock_minutes, median_minutes

PACIFIC = ZoneInfo("America/Vancouver")


def _month_has_testing_activity(cell: dict) -> bool:
    tested = int(cell.get("sites_tested_count") or 0)
    skipped_na = int(cell.get("skipped_non_annual_count") or 0)
    skipped_ann = int(cell.get("skipped_annual_count") or 0)
    return tested + skipped_na + skipped_ann > 0


def _timing_rows_for_route(route_id: int) -> list[MonthlyRouteRunTimingMonth]:
    return (
        MonthlyRouteRunTimingMonth.query.filter_by(
            monthly_route_id=int(route_id),
            sync_status=SYNC_STATUS_OK,
        )
        .filter(MonthlyRouteRunTimingMonth.duration_minutes.isnot(None))
        .order_by(MonthlyRouteRunTimingMonth.month_first.asc())
        .all()
    )


def _typical_end_time_from_rows(rows: list[MonthlyRouteRunTimingMonth]) -> tuple[str | None, int]:
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


def _monthly_net_pct_for_cell(
    route: MonthlyRoute,
    cell: dict,
    timing_by_month: dict[str, MonthlyRouteRunTimingMonth],
    month_iso: str,
) -> float | None:
    revenue = float(cell.get("tested_revenue_total") or 0)
    if revenue <= 0:
        return None
    timing_row = timing_by_month.get(month_iso)
    route_hours: float | None = None
    if timing_row is not None and timing_row.duration_minutes is not None:
        route_hours = round(int(timing_row.duration_minutes) / 60.0, 1)
    expense = round(_monthly_expense_for_route(route, route_hours), 2)
    monthly_net = round(revenue - expense, 2)
    return round(monthly_net / revenue, 4)


def _avg_net_pct_for_route(
    route: MonthlyRoute,
    testing_by_month: dict[str, dict],
    timing_by_month: dict[str, MonthlyRouteRunTimingMonth],
) -> tuple[float | None, int]:
    net_pcts: list[float] = []
    for month_iso in sorted(testing_by_month.keys()):
        cell = testing_by_month[month_iso]
        pct = _monthly_net_pct_for_cell(route, cell, timing_by_month, month_iso)
        if pct is not None:
            net_pcts.append(pct)
    if not net_pcts:
        return None, 0
    return round(sum(net_pcts) / len(net_pcts), 4), len(net_pcts)


def _avg_skipped_non_annual(testing_by_month: dict[str, dict]) -> tuple[float | None, int]:
    skip_counts: list[int] = []
    for cell in testing_by_month.values():
        if not _month_has_testing_activity(cell):
            continue
        skip_counts.append(int(cell.get("skipped_non_annual_count") or 0))
    if not skip_counts:
        return None, 0
    return round(sum(skip_counts) / len(skip_counts), 2), len(skip_counts)


def build_route_hero_summary(
    route: MonthlyRoute,
    testing_by_month: dict[str, dict],
) -> dict[str, object]:
    """Aggregate all-time hero metrics for the route detail hero card."""
    timing_rows = _timing_rows_for_route(int(route.id))
    timing_by_month = {row.month_first.isoformat(): row for row in timing_rows}
    typical_end_time, typical_end_time_runs_sampled = _typical_end_time_from_rows(timing_rows)
    avg_net_pct, net_pct_months_sampled = _avg_net_pct_for_route(route, testing_by_month, timing_by_month)
    avg_skipped_non_annual, skipped_months_sampled = _avg_skipped_non_annual(testing_by_month)

    return {
        "typical_end_time": typical_end_time,
        "typical_end_time_runs_sampled": typical_end_time_runs_sampled,
        "avg_net_pct": avg_net_pct,
        "net_pct_months_sampled": net_pct_months_sampled,
        "avg_skipped_non_annual": avg_skipped_non_annual,
        "skipped_months_sampled": skipped_months_sampled,
    }
