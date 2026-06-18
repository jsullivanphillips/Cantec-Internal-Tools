"""Dashboard metrics: per-route operational performance."""

from __future__ import annotations

from sqlalchemy.orm import joinedload

from app.db_models import MonthlyLocation, MonthlyRoute, MonthlyRouteCalculatedPath, db
from app.monthly.dashboard_route_metrics import (
    BREAKDOWN_RANGE_CHOICES,
    BREAKDOWN_RANGE_LAST_12_MONTHS,
    BREAKDOWN_RANGE_LAST_MONTH,
    BREAKDOWN_RANGE_LAST_QUARTER,
    _active_building_count,
    _active_routes_excluding_demo,
    _monthly_expense_for_route,
    _office_skipped_month_keys_by_route,
    _route_avg_monthly_revenue,
    _route_period_fully_skipped,
    _trailing_month_iso_keys,
    resolve_breakdown_period,
)
from app.monthly.location_monitoring import location_has_monitoring
from app.monthly.mapbox_routes import MAPBOX_DIRECTIONS_PROFILE
from app.monthly.route_expense_constants import effective_tech_count
from app.monthly.route_field_timing import route_median_field_timing
from app.monthly.route_run_timing import route_median_run_duration_minutes

MAPBOX_PROFILE_DRIVING = MAPBOX_DIRECTIONS_PROFILE


def _median_route_hours_for_range(
    route_id: int,
    month_keys: set[str],
) -> tuple[float | None, int]:
    duration_minutes, hours_months = route_median_run_duration_minutes(route_id, month_keys)
    avg_hours = round(duration_minutes / 60.0, 1) if duration_minutes is not None else None
    return avg_hours, hours_months


def _month_has_testing_activity(cell: dict) -> bool:
    tested = int(cell.get("sites_tested_count") or 0)
    skipped_na = int(cell.get("skipped_non_annual_count") or 0)
    skipped_ann = int(cell.get("skipped_annual_count") or 0)
    return tested + skipped_na + skipped_ann > 0


def _skipped_non_annual_for_range(
    testing_by_month: dict[str, dict],
    month_keys: set[str],
    *,
    range_key: str,
) -> tuple[float | None, int]:
    """Non-annual skips: single-month count, quarter total, or multi-month average."""
    skip_counts: list[int] = []
    for month_key in sorted(month_keys):
        cell = testing_by_month.get(month_key)
        if not cell or not _month_has_testing_activity(cell):
            continue
        skip_counts.append(int(cell.get("skipped_non_annual_count") or 0))

    if not skip_counts:
        return None, 0

    if range_key == BREAKDOWN_RANGE_LAST_MONTH:
        return float(skip_counts[0]), 1

    if range_key == BREAKDOWN_RANGE_LAST_QUARTER:
        return float(sum(skip_counts)), len(skip_counts)

    return round(sum(skip_counts) / len(skip_counts), 2), len(skip_counts)


def _calculated_paths_by_route(route_ids: list[int]) -> dict[int, MonthlyRouteCalculatedPath]:
    if not route_ids:
        return {}
    rows = (
        MonthlyRouteCalculatedPath.query.filter(
            MonthlyRouteCalculatedPath.monthly_route_id.in_(route_ids),
            MonthlyRouteCalculatedPath.profile == MAPBOX_PROFILE_DRIVING,
        ).all()
    )
    return {int(row.monthly_route_id): row for row in rows}


def _monitoring_counts_by_route(route_ids: list[int]) -> dict[int, int]:
    if not route_ids:
        return {}
    locations = (
        MonthlyLocation.query.options(joinedload(MonthlyLocation.monitoring_company))
        .filter(
            MonthlyLocation.monthly_route_id.in_(route_ids),
            MonthlyLocation.status_normalized == "active",
        )
        .all()
    )
    counts: dict[int, int] = {route_id: 0 for route_id in route_ids}
    for loc in locations:
        route_id = loc.monthly_route_id
        if route_id is None:
            continue
        rid = int(route_id)
        if rid not in counts:
            continue
        if location_has_monitoring(loc):
            counts[rid] += 1
    return counts


def _monthly_net_pct_for_route(
    route: MonthlyRoute,
    route_id: int,
    month_keys: set[str],
    skipped_month_keys: set[str],
    *,
    avg_hours: float | None,
    hours_months: int,
) -> tuple[float | None, bool]:
    """Return ``(monthly_net_pct, has_sufficient_run_time_data)`` matching financial breakdown."""
    avg_monthly_revenue, _revenue_months = _route_avg_monthly_revenue(route_id, month_keys)
    period_fully_skipped = _route_period_fully_skipped(skipped_month_keys, month_keys)

    if period_fully_skipped and hours_months == 0:
        monthly_expense = 0.0
        avg_monthly_revenue = 0.0
    else:
        monthly_expense = _monthly_expense_for_route(route, avg_hours)

    if avg_monthly_revenue > 0:
        monthly_net = round(avg_monthly_revenue - monthly_expense, 2)
        monthly_net_pct = round(monthly_net / avg_monthly_revenue, 4)
    elif period_fully_skipped and monthly_expense == 0:
        monthly_net_pct = None
    else:
        monthly_net_pct = None

    has_sufficient_run_time_data = hours_months > 0 or period_fully_skipped
    return monthly_net_pct, has_sufficient_run_time_data


def build_dashboard_route_performance(
    *,
    trailing_months: int = 12,
    range_key: str = BREAKDOWN_RANGE_LAST_MONTH,
) -> dict[str, object]:
    from app.routes.monthly_routes import (
        _current_pacific_month_first,
        _route_testing_by_month,
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

    active_routes = _active_routes_excluding_demo()
    route_ids = [int(route.id) for route in active_routes]
    skipped_months_by_route = _office_skipped_month_keys_by_route(route_ids, month_keys)
    calculated_paths = _calculated_paths_by_route(route_ids)
    monitoring_counts = _monitoring_counts_by_route(route_ids)

    rows_payload: list[dict[str, object]] = []
    for route in active_routes:
        route_id = int(route.id)
        testing_by_month = _route_testing_by_month(route_id)
        skipped_non_annual, skipped_months_sampled = _skipped_non_annual_for_range(
            testing_by_month,
            month_keys,
            range_key=range_key,
        )
        path_row = calculated_paths.get(route_id)
        distance_meters = int(path_row.distance_meters) if path_row and path_row.distance_meters is not None else None
        duration_seconds = int(path_row.duration_seconds) if path_row and path_row.duration_seconds is not None else None
        avg_hours, hours_months = _median_route_hours_for_range(route_id, month_keys)
        field_duration_minutes, field_months, pre_route_gap_minutes, pre_route_months = (
            route_median_field_timing(route_id, month_keys)
        )
        field_avg_hours = (
            round(field_duration_minutes / 60.0, 1) if field_duration_minutes is not None else None
        )
        monthly_net_pct, has_sufficient_run_time_data = _monthly_net_pct_for_route(
            route,
            route_id,
            month_keys,
            skipped_months_by_route.get(route_id, set()),
            avg_hours=avg_hours,
            hours_months=hours_months,
        )

        rows_payload.append(
            {
                "route": _serialize_monthly_route_entity(route),
                "building_count": _active_building_count(route_id),
                "distance_meters": distance_meters,
                "duration_seconds": duration_seconds,
                "avg_hours": avg_hours,
                "avg_hours_months_sampled": hours_months,
                "field_avg_hours": field_avg_hours,
                "field_avg_hours_months_sampled": field_months,
                "pre_route_gap_minutes": pre_route_gap_minutes,
                "pre_route_gap_months_sampled": pre_route_months,
                "skipped_non_annual": skipped_non_annual,
                "skipped_months_sampled": skipped_months_sampled,
                "monitoring_site_count": monitoring_counts.get(route_id, 0),
                "tech_count": effective_tech_count(route),
                "monthly_net_pct": monthly_net_pct,
                "has_sufficient_run_time_data": has_sufficient_run_time_data,
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
        "rows": rows_payload,
    }
