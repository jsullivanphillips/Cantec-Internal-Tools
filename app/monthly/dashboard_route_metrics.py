"""Dashboard metrics: route earnings rankings and expense breakdown."""

from __future__ import annotations

from datetime import date

from sqlalchemy import func

from app.db_models import MonthlyLocation, MonthlyRoute, MonthlyRouteRun, db
from app.monthly.route_expense_constants import (
    LABOUR_RATE_PER_HOUR,
    TRUCK_CHARGE_PER_MONTH,
    billed_avg_hours,
    effective_tech_count,
    is_avg_hours_capped_for_billing,
    serialize_cost_constants,
)
from app.monthly.route_run_timing import (
    route_median_run_duration_minutes,
    route_typical_end_time,
)
from app.monthly.run_workflow import derive_run_workflow_stage, next_month_first
from app.monthly.technician_demo_route import is_technician_demo_route

TOP_BOTTOM_ROUTE_COUNT = 5

BREAKDOWN_RANGE_LAST_MONTH = "last_month"
BREAKDOWN_RANGE_LAST_QUARTER = "last_quarter"
BREAKDOWN_RANGE_YTD = "ytd"
BREAKDOWN_RANGE_LAST_12_MONTHS = "last_12_months"

BREAKDOWN_RANGE_CHOICES = frozenset(
    {
        BREAKDOWN_RANGE_LAST_MONTH,
        BREAKDOWN_RANGE_LAST_QUARTER,
        BREAKDOWN_RANGE_YTD,
        BREAKDOWN_RANGE_LAST_12_MONTHS,
    }
)

_MONTH_ABBR = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)


def _previous_month_first(month_first: date) -> date:
    if month_first.month == 1:
        return date(month_first.year - 1, 12, 1)
    return date(month_first.year, month_first.month - 1, 1)


def _trailing_month_iso_keys(end_month_first: date, trailing_months: int) -> tuple[date, set[str]]:
    if trailing_months < 1:
        trailing_months = 1
    start = end_month_first
    for _ in range(trailing_months - 1):
        start = _previous_month_first(start)
    keys: set[str] = set()
    cursor = start
    while cursor <= end_month_first:
        keys.add(cursor.isoformat())
        if cursor == end_month_first:
            break
        cursor = next_month_first(cursor)
    return start, keys


def _quarter_start_month(month_first: date) -> date:
    quarter_index = (month_first.month - 1) // 3
    return date(month_first.year, quarter_index * 3 + 1, 1)


def _last_completed_quarter_range(as_of: date) -> tuple[date, date]:
    """Most recent fully elapsed Pacific calendar quarter before ``as_of``'s quarter."""
    current_quarter_start = _quarter_start_month(as_of)
    quarter_end = _previous_month_first(current_quarter_start)
    quarter_start = _quarter_start_month(quarter_end)
    return quarter_start, quarter_end


def _month_keys_inclusive(start: date, end: date) -> set[str]:
    return {m.isoformat() for m in _ordered_month_first_dates(start, end)}


def _ordered_month_first_dates(start: date, end: date) -> list[date]:
    months: list[date] = []
    cursor = start
    while cursor <= end:
        months.append(cursor)
        if cursor == end:
            break
        cursor = next_month_first(cursor)
    return months


def _quarter_period_label(start: date, end: date) -> str:
    return f"{_MONTH_ABBR[start.month - 1]} – {_MONTH_ABBR[end.month - 1]} {end.year}"


def _revenue_column_header(month_first: date, *, include_year: bool) -> str:
    abbr = _MONTH_ABBR[month_first.month - 1].upper()
    if include_year:
        return f"{abbr} '{month_first.year % 100:02d} REVENUE"
    return f"{abbr} REVENUE"


def build_breakdown_revenue_columns(
    period_start: date,
    period_end: date,
) -> list[dict[str, str]]:
    months = _ordered_month_first_dates(period_start, period_end)
    include_year = len({m.year for m in months}) > 1
    return [
        {
            "month_key": month_first.isoformat(),
            "header": _revenue_column_header(month_first, include_year=include_year),
        }
        for month_first in months
    ]


def resolve_breakdown_period(
    as_of: date,
    range_key: str,
) -> tuple[date, date, set[str], str]:
    """Return ``(period_start, period_end, month_keys, period_label)`` for a breakdown range."""
    if range_key == BREAKDOWN_RANGE_LAST_MONTH:
        last_month = _previous_month_first(as_of)
        return last_month, last_month, {last_month.isoformat()}, "Last month"

    if range_key == BREAKDOWN_RANGE_LAST_QUARTER:
        period_start, period_end = _last_completed_quarter_range(as_of)
        label = f"Last quarter ({_quarter_period_label(period_start, period_end)})"
        return period_start, period_end, _month_keys_inclusive(period_start, period_end), label

    if range_key == BREAKDOWN_RANGE_YTD:
        period_start = date(as_of.year, 1, 1)
        return period_start, as_of, _month_keys_inclusive(period_start, as_of), "Year to date"

    period_start, month_keys = _trailing_month_iso_keys(as_of, 12)
    return period_start, as_of, month_keys, "Last 12 months"


def _active_routes_excluding_demo() -> list[MonthlyRoute]:
    count_rows = (
        db.session.query(
            MonthlyLocation.monthly_route_id,
            func.count(MonthlyLocation.id),
        )
        .filter(
            MonthlyLocation.monthly_route_id.isnot(None),
            MonthlyLocation.status_normalized == "active",
        )
        .group_by(MonthlyLocation.monthly_route_id)
        .all()
    )
    count_map: dict[int, int] = {int(mid): int(n) for mid, n in count_rows if mid is not None}
    routes = MonthlyRoute.query.order_by(MonthlyRoute.route_number.asc()).all()
    out: list[MonthlyRoute] = []
    for route in routes:
        if count_map.get(int(route.id), 0) < 1:
            continue
        if is_technician_demo_route(route):
            continue
        out.append(route)
    return out


def _active_building_count(route_id: int) -> int:
    return int(
        MonthlyLocation.query.filter_by(
            monthly_route_id=route_id,
            status_normalized="active",
        ).count()
    )


def _route_revenue_total(route_id: int, month_keys: set[str]) -> float:
    from app.routes.monthly_routes import _route_testing_by_month

    testing_by_month = _route_testing_by_month(route_id)
    total = 0.0
    for month_key in month_keys:
        cell = testing_by_month.get(month_key)
        if not cell:
            continue
        revenue = cell.get("tested_revenue_total")
        if isinstance(revenue, (int, float)):
            total += float(revenue)
    return total


def _route_revenue_for_month(testing_by_month: dict[str, dict], month_key: str) -> float:
    cell = testing_by_month.get(month_key)
    if not cell:
        return 0.0
    revenue = cell.get("tested_revenue_total")
    if isinstance(revenue, (int, float)):
        return float(revenue)
    return 0.0


def _month_revenue_status(
    cell: dict | None,
    *,
    run_is_office_skipped: bool = False,
) -> str | None:
    """``skipped`` only for office bulk-skip runs; ``no_data`` when revenue is zero otherwise."""
    revenue_value = 0.0
    if cell is not None:
        revenue = cell.get("tested_revenue_total")
        revenue_value = float(revenue) if isinstance(revenue, (int, float)) else 0.0

    if revenue_value > 0:
        return None

    if run_is_office_skipped:
        return "skipped"

    return "no_data"


def _route_monthly_revenues(
    route_id: int,
    revenue_columns: list[dict[str, str]],
) -> list[dict[str, object]]:
    from app.routes.monthly_routes import _route_testing_by_month, _runs_by_month_for_route

    testing_by_month = _route_testing_by_month(route_id)
    runs_by_month = _runs_by_month_for_route(route_id)
    entries: list[dict[str, object]] = []
    for column in revenue_columns:
        month_key = column["month_key"]
        cell = testing_by_month.get(month_key)
        revenue = round(_route_revenue_for_month(testing_by_month, month_key), 2)
        run_info = runs_by_month.get(month_key)
        run_is_office_skipped = (
            isinstance(run_info, dict)
            and run_info.get("workflow_stage") == "skipped"
            and (str(run_info.get("source") or "").strip().lower() == "office_skip")
        )
        status = _month_revenue_status(cell, run_is_office_skipped=run_is_office_skipped)
        entry: dict[str, object] = {
            "month_key": month_key,
            "revenue": revenue,
        }
        if status is not None:
            entry["revenue_status"] = status
        entries.append(entry)
    return entries


def _route_avg_monthly_revenue(route_id: int, month_keys: set[str]) -> tuple[float, int]:
    from app.routes.monthly_routes import _route_testing_by_month

    testing_by_month = _route_testing_by_month(route_id)
    months_with_revenue = 0
    total = 0.0
    for month_key in month_keys:
        cell = testing_by_month.get(month_key)
        if not cell:
            continue
        revenue = cell.get("tested_revenue_total")
        if isinstance(revenue, (int, float)) and float(revenue) > 0:
            total += float(revenue)
            months_with_revenue += 1
    if months_with_revenue == 0:
        return 0.0, 0
    return total / months_with_revenue, months_with_revenue


def _monthly_expense_for_route(route: MonthlyRoute, avg_hours: float | None) -> float:
    tech_count = effective_tech_count(route)
    labour = 0.0
    billed_hours = billed_avg_hours(avg_hours)
    if billed_hours is not None and billed_hours > 0:
        labour = LABOUR_RATE_PER_HOUR * tech_count * billed_hours
    return labour + TRUCK_CHARGE_PER_MONTH


def _office_skipped_month_keys_by_route(
    route_ids: list[int],
    month_keys: set[str],
) -> dict[int, set[str]]:
    """Months in ``month_keys`` with a closed office-skipped run, keyed by route id."""
    if not route_ids or not month_keys:
        return {}

    month_dates = [date.fromisoformat(key) for key in month_keys]
    rows = MonthlyRouteRun.query.filter(
        MonthlyRouteRun.monthly_route_id.in_(route_ids),
        MonthlyRouteRun.month_date.in_(month_dates),
    ).all()

    out: dict[int, set[str]] = {route_id: set() for route_id in route_ids}
    for run in rows:
        if derive_run_workflow_stage(run) != "skipped":
            continue
        route_id = int(run.monthly_route_id)
        if route_id in out:
            out[route_id].add(run.month_date.isoformat())
    return out


def _route_period_fully_skipped(skipped_month_keys: set[str], month_keys: set[str]) -> bool:
    """True when every month in the breakdown window was office-skipped."""
    return bool(month_keys) and month_keys <= skipped_month_keys


def build_dashboard_route_earnings(*, trailing_months: int = 12) -> dict[str, object]:
    from app.routes.monthly_routes import (
        _current_pacific_month_first,
        _serialize_monthly_route_entity,
    )

    end_month = _current_pacific_month_first()
    period_start, month_keys = _trailing_month_iso_keys(end_month, trailing_months)

    rows_payload: list[dict[str, object]] = []
    for route in _active_routes_excluding_demo():
        route_id = int(route.id)
        revenue_total = _route_revenue_total(route_id, month_keys)
        typical_end_time, months_sampled = route_typical_end_time(route_id, month_keys)
        rows_payload.append(
            {
                "route": _serialize_monthly_route_entity(route),
                "revenue_total": round(revenue_total, 2),
                "typical_end_time": typical_end_time,
                "typical_end_time_months_sampled": months_sampled,
            }
        )

    rows_payload.sort(
        key=lambda row: (
            -float(row["revenue_total"]),
            int((row["route"] or {}).get("route_number") or 0),
        ),
    )

    top_earners = rows_payload[:TOP_BOTTOM_ROUTE_COUNT]
    lowest_earners = list(reversed(rows_payload[-TOP_BOTTOM_ROUTE_COUNT:]))

    return {
        "trailing_months": trailing_months,
        "period_start": period_start.isoformat(),
        "period_end": end_month.isoformat(),
        "top_earners": top_earners,
        "lowest_earners": lowest_earners,
    }


def build_dashboard_route_breakdown(
    *,
    trailing_months: int = 12,
    range_key: str = BREAKDOWN_RANGE_LAST_12_MONTHS,
) -> dict[str, object]:
    from app.routes.monthly_routes import (
        _current_pacific_month_first,
        _serialize_monthly_route_entity,
    )

    end_month = _current_pacific_month_first()
    if range_key in BREAKDOWN_RANGE_CHOICES:
        period_start, period_end, month_keys, period_label = resolve_breakdown_period(
            end_month,
            range_key,
        )
    else:
        period_start, month_keys = _trailing_month_iso_keys(end_month, trailing_months)
        period_end = end_month
        period_label = f"Last {trailing_months} months"
        range_key = BREAKDOWN_RANGE_LAST_12_MONTHS

    revenue_columns = build_breakdown_revenue_columns(period_start, period_end)
    show_avg_monthly_revenue = range_key != BREAKDOWN_RANGE_LAST_MONTH

    active_routes = _active_routes_excluding_demo()
    route_ids = [int(route.id) for route in active_routes]
    skipped_months_by_route = _office_skipped_month_keys_by_route(route_ids, month_keys)

    rows_payload: list[dict[str, object]] = []
    for route in active_routes:
        route_id = int(route.id)
        duration_minutes, hours_months = route_median_run_duration_minutes(route_id, month_keys)
        avg_hours = round(duration_minutes / 60.0, 1) if duration_minutes is not None else None
        avg_hours_billed = billed_avg_hours(avg_hours)
        avg_monthly_revenue, revenue_months = _route_avg_monthly_revenue(route_id, month_keys)
        monthly_revenues = _route_monthly_revenues(route_id, revenue_columns)
        tech_count = effective_tech_count(route)
        period_fully_skipped = _route_period_fully_skipped(
            skipped_months_by_route.get(route_id, set()),
            month_keys,
        )
        if period_fully_skipped and hours_months == 0:
            monthly_expense = 0.0
            avg_monthly_revenue = 0.0
            revenue_months = 0
        else:
            monthly_expense = _monthly_expense_for_route(route, avg_hours)
        if avg_monthly_revenue > 0:
            monthly_net = round(avg_monthly_revenue - monthly_expense, 2)
        elif period_fully_skipped and monthly_expense == 0:
            monthly_net = 0.0
        else:
            monthly_net = None
        monthly_net_pct: float | None = None
        if avg_monthly_revenue > 0 and monthly_net is not None:
            monthly_net_pct = round(monthly_net / avg_monthly_revenue, 4)

        has_sufficient_run_time_data = hours_months > 0 or period_fully_skipped

        rows_payload.append(
            {
                "route": _serialize_monthly_route_entity(route),
                "building_count": _active_building_count(route_id),
                "avg_hours": avg_hours,
                "avg_hours_billed": avg_hours_billed,
                "avg_hours_capped_for_billing": is_avg_hours_capped_for_billing(avg_hours),
                "avg_hours_months_sampled": hours_months,
                "has_sufficient_run_time_data": has_sufficient_run_time_data,
                "period_fully_skipped": period_fully_skipped,
                "tech_count": tech_count,
                "monthly_expense": round(monthly_expense, 2),
                "monthly_revenues": monthly_revenues,
                "avg_monthly_revenue": round(avg_monthly_revenue, 2),
                "revenue_months_sampled": revenue_months,
                "monthly_net": monthly_net,
                "monthly_net_pct": monthly_net_pct,
            }
        )

    rows_payload.sort(
        key=lambda row: (
            not bool(row["has_sufficient_run_time_data"]),
            row["monthly_net_pct"] is None,
            -(
                float(row["monthly_net_pct"])
                if row["monthly_net_pct"] is not None and row["has_sufficient_run_time_data"]
                else 0.0
            ),
            int((row["route"] or {}).get("route_number") or 0),
        ),
    )

    return {
        "range": range_key,
        "period_label": period_label,
        "trailing_months": len(month_keys),
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "revenue_columns": revenue_columns,
        "show_avg_monthly_revenue": show_avg_monthly_revenue,
        "cost_constants": serialize_cost_constants(),
        "rows": rows_payload,
    }
