"""Dashboard metrics: location monthly price vs on-site time rankings."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy.orm import joinedload

from app.db_models import MonthlyLocation, MonthlyLocationMonth, db
from app.monthly.dashboard_route_metrics import (
    BREAKDOWN_RANGE_CHOICES,
    BREAKDOWN_RANGE_LAST_12_MONTHS,
    BREAKDOWN_RANGE_LAST_MONTH,
    resolve_breakdown_period,
)
from app.monthly.route_performance_breakdown import (
    _float_price,
    _location_label,
    visit_minutes_by_mlm_id,
)
from app.monthly.technician_demo_route import (
    is_technician_demo_library_location,
    is_technician_demo_route,
)

TOP_BOTTOM_LOCATION_COUNT = 10


@dataclass
class _LocationVisitStats:
    total_visit_minutes: int = 0
    visits_sampled: int = 0


def _active_locations_excluding_demo() -> list[MonthlyLocation]:
    locations = (
        MonthlyLocation.query.options(joinedload(MonthlyLocation.monthly_route))
        .filter(
            MonthlyLocation.monthly_route_id.isnot(None),
            MonthlyLocation.status_normalized == "active",
        )
        .order_by(MonthlyLocation.id.asc())
        .all()
    )
    out: list[MonthlyLocation] = []
    for loc in locations:
        route = loc.monthly_route
        if route is None or is_technician_demo_route(route):
            continue
        out.append(loc)
    return out


def _active_priced_locations_excluding_demo() -> list[MonthlyLocation]:
    """Active library sites with a monthly price (route assignment not required)."""
    locations = (
        MonthlyLocation.query.options(joinedload(MonthlyLocation.monthly_route))
        .filter(MonthlyLocation.status_normalized == "active")
        .order_by(MonthlyLocation.id.asc())
        .all()
    )
    out: list[MonthlyLocation] = []
    for loc in locations:
        if is_technician_demo_library_location(loc):
            continue
        price = _float_price(loc.price_per_month)
        if price is None or price <= 0:
            continue
        out.append(loc)
    return out


def _aggregate_location_stats(
    locations: list[MonthlyLocation],
    month_keys: set[str],
) -> dict[int, _LocationVisitStats]:
    if not locations or not month_keys:
        return {}

    loc_by_id = {int(loc.id): loc for loc in locations}
    month_dates = sorted(date.fromisoformat(key) for key in month_keys)
    mlms = (
        MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.monthly_location_id.in_(loc_by_id.keys()),
            MonthlyLocationMonth.month_date.in_(month_dates),
        )
        .all()
    )

    visit_minutes_by_mlm = {
        mlm_id: minutes
        for mlm_id, (minutes, _source) in visit_minutes_by_mlm_id(mlms).items()
    }

    stats: dict[int, _LocationVisitStats] = {
        int(loc_id): _LocationVisitStats() for loc_id in loc_by_id.keys()
    }

    for mlm in mlms:
        loc_id = int(mlm.monthly_location_id)
        if loc_id not in loc_by_id:
            continue

        visit_minutes = visit_minutes_by_mlm.get(int(mlm.id))
        if visit_minutes is None or int(visit_minutes) <= 0:
            continue

        entry = stats[loc_id]
        entry.total_visit_minutes += int(visit_minutes)
        entry.visits_sampled += 1

    return stats


def _serialize_location_metrics_row(
    loc: MonthlyLocation,
    stats: _LocationVisitStats,
) -> dict[str, object] | None:
    from app.routes.monthly_routes import _serialize_monthly_route_entity

    price = _float_price(loc.price_per_month)
    if price is None or price <= 0:
        return None

    route = loc.monthly_route
    visits = stats.visits_sampled
    if visits <= 0 or stats.total_visit_minutes <= 0:
        return None

    avg_visit_minutes = round(stats.total_visit_minutes / visits, 1)
    price_per_hour = _price_per_hour(price, avg_visit_minutes)

    return {
        "location_id": int(loc.id),
        "label": _location_label(loc),
        "address": (loc.address or "").strip() or None,
        "price_per_month": round(price, 2),
        "route": _serialize_monthly_route_entity(route) if route is not None else None,
        "avg_visit_minutes": avg_visit_minutes,
        "price_per_hour": price_per_hour,
        "visits_sampled": visits,
    }


def _price_per_hour(price_per_month: float, avg_visit_minutes: float) -> float:
    return round(price_per_month / (avg_visit_minutes / 60.0), 2)


def _serialize_location_price_row(loc: MonthlyLocation) -> dict[str, object] | None:
    from app.routes.monthly_routes import _serialize_monthly_route_entity

    price = _float_price(loc.price_per_month)
    if price is None or price <= 0:
        return None

    route = loc.monthly_route
    return {
        "location_id": int(loc.id),
        "label": _location_label(loc),
        "address": (loc.address or "").strip() or None,
        "price_per_month": round(price, 2),
        "route": _serialize_monthly_route_entity(route) if route is not None else None,
    }


def _lowest_monthly_price_locations(
    locations: list[MonthlyLocation],
) -> tuple[list[dict[str, object]], int]:
    priced_rows: list[dict[str, object]] = []
    for loc in locations:
        row = _serialize_location_price_row(loc)
        if row is None:
            continue
        priced_rows.append(row)

    priced_rows.sort(
        key=lambda row: (
            float(row["price_per_month"] or 0),
            str(row.get("label") or ""),
        ),
    )
    return priced_rows[:TOP_BOTTOM_LOCATION_COUNT], len(priced_rows)


def build_dashboard_location_metrics(
    *,
    trailing_months: int = 12,
    range_key: str = BREAKDOWN_RANGE_LAST_MONTH,
) -> dict[str, object]:
    from app.routes.monthly_routes import _current_pacific_month_first

    end_month = _current_pacific_month_first()
    if range_key in BREAKDOWN_RANGE_CHOICES:
        period_start, period_end, month_keys, period_label = resolve_breakdown_period(
            end_month,
            range_key,
        )
    else:
        from app.monthly.dashboard_route_metrics import _trailing_month_iso_keys

        period_start, month_keys = _trailing_month_iso_keys(end_month, trailing_months)
        period_end = end_month
        period_label = f"Last {trailing_months} months"
        range_key = BREAKDOWN_RANGE_LAST_12_MONTHS

    locations = _active_locations_excluding_demo()
    stats_by_id = _aggregate_location_stats(locations, month_keys)

    ranked_rows: list[dict[str, object]] = []
    for loc in locations:
        stats = stats_by_id.get(int(loc.id))
        if stats is None:
            continue
        row = _serialize_location_metrics_row(loc, stats)
        if row is None:
            continue
        ranked_rows.append(row)

    ranked_rows.sort(
        key=lambda row: (
            -float(row["price_per_hour"] or 0),
            -int(row["visits_sampled"] or 0),
            str(row.get("label") or ""),
        ),
    )

    top_performers = ranked_rows[:TOP_BOTTOM_LOCATION_COUNT]
    lowest_performers = list(reversed(ranked_rows[-TOP_BOTTOM_LOCATION_COUNT:]))
    priced_locations = _active_priced_locations_excluding_demo()
    lowest_monthly_price_locations, priced_location_count = _lowest_monthly_price_locations(
        priced_locations,
    )

    db.session.commit()
    return {
        "range": range_key,
        "period_label": period_label,
        "trailing_months": len(month_keys),
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "top_performers": top_performers,
        "lowest_performers": lowest_performers,
        "lowest_monthly_price_locations": lowest_monthly_price_locations,
        "eligible_location_count": len(ranked_rows),
        "priced_location_count": priced_location_count,
    }
