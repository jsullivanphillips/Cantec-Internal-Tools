"""Route detail performance deep-dive: per-stop visit time, revenue, and month profitability."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from app.db_models import (
    MonthlyLocation,
    MonthlyLocationMonth,
    MonthlyRoute,
    MonthlyRouteRunTimingMonth,
    MonthlyStopClockEvent,
    db,
)
from app.monthly.dashboard_route_metrics import _monthly_expense_for_route
from app.monthly.route_expense_constants import (
    billed_avg_hours,
    effective_tech_count,
    is_avg_hours_capped_for_billing,
)
from app.monthly.route_run_timing import SYNC_STATUS_OK
from app.monthly.visit_clock_times import (
    duration_minutes_from_start_end,
    format_visit_clock_minutes,
    parse_visit_clock_minutes,
)
from app.monthly.worksheet_locations import _sheet_skip_reason_is_annual

THIN_MARGIN_PCT_THRESHOLD = 0.10
LARGE_UNACCOUNTED_MINUTES = 90
PACIFIC = ZoneInfo("America/Vancouver")
INCOMPLETE_TESTING_RATIO = 0.8


def _normalize_text(value: object) -> str:
    return " ".join(str(value or "").strip().split())


def history_row_outcome_bucket(row: MonthlyLocationMonth | None) -> str | None:
    """Classify outcome; ``None`` = pending / no outcome."""
    if row is None:
        return None
    status = (row.result_status or "").strip().lower()
    if status == "skipped":
        if _sheet_skip_reason_is_annual(row.skip_reason):
            return "skipped_annual"
        return "skipped_non_annual"
    if status == "tested":
        return "tested"

    outcome = (row.test_outcome or "").strip().lower()
    if outcome == "skipped":
        cat = (row.skip_category or "").strip().lower()
        if cat == "annual" or _sheet_skip_reason_is_annual(row.skip_reason):
            return "skipped_annual"
        return "skipped_non_annual"
    if outcome in ("all_good", "passed_with_problems", "failed"):
        return "tested"
    return None


def _testing_history_rows_attributed_to_route_month(
    route_id: int,
    month_first: date,
) -> list[MonthlyLocationMonth]:
    loc_ids = [
        lid
        for (lid,) in MonthlyLocation.query.with_entities(MonthlyLocation.id)
        .filter(MonthlyLocation.monthly_route_id == route_id)
        .all()
    ]
    hist_attr = MonthlyLocationMonth.query.filter(
        MonthlyLocationMonth.test_monthly_route_id == route_id,
        MonthlyLocationMonth.month_date == month_first,
    ).all()
    hist_legacy: list[MonthlyLocationMonth] = []
    if loc_ids:
        hist_legacy = MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.test_monthly_route_id.is_(None),
            MonthlyLocationMonth.monthly_location_id.in_(loc_ids),
            MonthlyLocationMonth.month_date == month_first,
        ).all()
    merged: dict[tuple[int, date], MonthlyLocationMonth] = {}
    for row in hist_attr + hist_legacy:
        merged[(int(row.monthly_location_id), row.month_date)] = row
    return list(merged.values())


def _visit_minutes_from_sheet(mlm: MonthlyLocationMonth) -> tuple[int | None, str | None, str | None]:
    time_in = _normalize_text(mlm.sheet_time_in_raw)
    time_out = _normalize_text(mlm.sheet_time_out_raw)
    if not time_in or not time_out:
        return None, time_in or None, time_out or None
    start = parse_visit_clock_minutes(time_in)
    end = parse_visit_clock_minutes(time_out)
    if start is None or end is None:
        return None, time_in, time_out
    return duration_minutes_from_start_end(start, end), time_in, time_out


def _visit_minutes_from_portal_clocks(
    mlm: MonthlyLocationMonth,
) -> tuple[int | None, str | None, str | None]:
    events = (
        MonthlyStopClockEvent.query.filter_by(monthly_location_month_id=int(mlm.id))
        .order_by(MonthlyStopClockEvent.sort_order.asc(), MonthlyStopClockEvent.id.asc())
        .all()
    )
    if not events:
        return None, None, None
    time_in = _normalize_text(events[0].time_in_raw) or None
    closed = [e for e in events if _normalize_text(e.time_out_raw)]
    time_out = _normalize_text(closed[-1].time_out_raw) if closed else None
    if not time_in or not time_out:
        return None, time_in, time_out
    start = parse_visit_clock_minutes(time_in)
    end = parse_visit_clock_minutes(time_out)
    if start is None or end is None:
        return None, time_in, time_out
    return duration_minutes_from_start_end(start, end), time_in, time_out


def visit_minutes_for_mlm(
    mlm: MonthlyLocationMonth | None,
) -> tuple[int | None, str | None, str | None, str | None]:
    """Returns (minutes, time_in, time_out, source)."""
    if mlm is None:
        return None, None, None, None
    minutes, time_in, time_out = _visit_minutes_from_sheet(mlm)
    if minutes is not None:
        return minutes, time_in, time_out, "sheet"
    minutes, time_in, time_out = _visit_minutes_from_portal_clocks(mlm)
    if minutes is not None:
        return minutes, time_in, time_out, "portal"
    return None, time_in, time_out, None


def _stop_sort_key(
    loc: MonthlyLocation,
    mlm: MonthlyLocationMonth | None,
) -> tuple[int, int, int]:
    if mlm is not None and mlm.session_route_stop_order is not None:
        return (0, int(mlm.session_route_stop_order), int(loc.id))
    if loc.route_stop_order is not None:
        return (1, int(loc.route_stop_order), int(loc.id))
    return (2, 10**9, int(loc.id))


def _location_label(loc: MonthlyLocation) -> str:
    label = (_normalize_text(loc.label) or _normalize_text(loc.address) or "").strip()
    return label or f"Location {loc.id}"


def _float_price(value: Decimal | float | None) -> float | None:
    if value is None:
        return None
    return float(value)


def _format_servicetrade_run_clock(clock_at: datetime | None) -> str | None:
    """Pacific ``h:mm AM/PM`` from a ServiceTrade run clock timestamp."""
    if clock_at is None:
        return None
    pacific = clock_at.astimezone(PACIFIC)
    return format_visit_clock_minutes(pacific.hour * 60 + pacific.minute)


def _mlm_billing_status(mlm: MonthlyLocationMonth | None) -> str | None:
    if mlm is None:
        return None
    raw = _normalize_text(mlm.billing_status)
    return raw.lower() if raw else None


def _stop_revenue(
    *,
    price: float | None,
    billing_status: str | None,
) -> float:
    if price is None or billing_status != "bill":
        return 0.0
    return price


def available_performance_months(route_id: int, *, limit: int = 36) -> list[str]:
    """Distinct ``YYYY-MM-01`` keys newest first — aligned with route detail testing, runs, and ST timing."""
    from app.routes.monthly_routes import (
        _route_testing_by_month,
        _runs_by_month_for_route,
    )

    month_keys: set[str] = set()
    month_keys.update(_route_testing_by_month(route_id).keys())
    month_keys.update(_runs_by_month_for_route(route_id).keys())

    for (month_first,) in (
        db.session.query(MonthlyRouteRunTimingMonth.month_first)
        .filter_by(monthly_route_id=route_id)
        .filter(MonthlyRouteRunTimingMonth.month_first.isnot(None))
        .distinct()
        .all()
    ):
        month_keys.add(month_first.isoformat())

    ordered = sorted((date.fromisoformat(key) for key in month_keys), reverse=True)
    return [month_first.isoformat() for month_first in ordered[:limit]]


def _build_stop_rows(
    route_id: int,
    month_first: date,
    locations: list[MonthlyLocation],
    mlm_by_loc: dict[int, MonthlyLocationMonth],
) -> list[dict[str, object]]:
    rows: list[tuple[tuple[int, int, int], dict[str, object]]] = []
    for loc in locations:
        mlm = mlm_by_loc.get(int(loc.id))
        bucket = history_row_outcome_bucket(mlm)
        visit_minutes, time_in, time_out, visit_source = visit_minutes_for_mlm(mlm)
        price = _float_price(loc.price_per_month)
        billing_status = _mlm_billing_status(mlm)
        revenue = _stop_revenue(price=price, billing_status=billing_status)

        stop_order = (
            int(mlm.session_route_stop_order)
            if mlm is not None and mlm.session_route_stop_order is not None
            else loc.route_stop_order
        )

        rows.append(
            (
                _stop_sort_key(loc, mlm),
                {
                    "location_id": int(loc.id),
                    "label": _location_label(loc),
                    "stop_order": stop_order,
                    "outcome": bucket,
                    "billing_status": billing_status,
                    "revenue": round(revenue, 2),
                    "price_per_month": price,
                    "has_price": price is not None,
                    "visit_minutes": visit_minutes,
                    "time_in": time_in,
                    "time_out": time_out,
                    "visit_time_source": visit_source,
                },
            )
        )

    rows.sort(key=lambda item: item[0])
    return [payload for _, payload in rows]


def _visit_time_coverage(
    stops: list[dict[str, object]],
) -> str:
    tested = [s for s in stops if s.get("outcome") == "tested"]
    if not tested:
        return "none"
    with_time = [s for s in tested if s.get("visit_minutes") is not None]
    if not with_time:
        return "none"
    if len(with_time) == len(tested):
        return "full"
    return "partial"


def _build_insights(
    *,
    summary: dict[str, object],
    stops: list[dict[str, object]],
    active_stop_count: int,
) -> list[str]:
    insights: list[str] = []
    tested_count = int(summary.get("tested_count") or 0)
    pending_count = int(summary.get("pending_count") or 0)
    net_pct = summary.get("monthly_net_pct")
    coverage = str(summary.get("visit_time_coverage") or "none")
    unaccounted = summary.get("unaccounted_minutes")
    route_hours = summary.get("route_hours")

    if isinstance(net_pct, (int, float)) and float(net_pct) < THIN_MARGIN_PCT_THRESHOLD:
        pct_display = round(float(net_pct) * 100, 1)
        insights.append(
            f"Thin margin ({pct_display}% net) — labour and truck costs nearly match tested revenue."
        )

    if active_stop_count > 0 and tested_count < active_stop_count * INCOMPLETE_TESTING_RATIO:
        insights.append(
            f"Only {tested_count} of {active_stop_count} active stops counted as tested "
            f"— revenue may understate a full route."
        )

    if pending_count > 0:
        insights.append(
            f"{pending_count} stop(s) have a run row but no tested/skipped outcome "
            f"— revenue is incomplete until outcomes are recorded."
        )

    tested_missing_time = [
        s for s in stops if s.get("outcome") == "tested" and s.get("visit_minutes") is None
    ]
    if tested_missing_time:
        insights.append(
            f"{len(tested_missing_time)} tested stop(s) have no sheet or portal visit times."
        )

    tested_missing_price = [
        s for s in stops if s.get("outcome") == "tested" and not s.get("has_price")
    ]
    if tested_missing_price:
        insights.append(
            f"{len(tested_missing_price)} tested stop(s) are missing Price/month in the library."
        )

    tested_not_bill = [
        s
        for s in stops
        if s.get("outcome") == "tested"
        and s.get("has_price")
        and s.get("billing_status") != "bill"
    ]
    if tested_not_bill:
        insights.append(
            f"{len(tested_not_bill)} tested stop(s) with a price are not marked Bill "
            f"— revenue excludes them until billing is set."
        )

    if isinstance(unaccounted, int) and unaccounted >= LARGE_UNACCOUNTED_MINUTES:
        insights.append(
            f"About {unaccounted} minutes of route time is not explained by summed stop visits "
            f"(drive time, lunch, or admin)."
        )

    longest_visit_stops = [
        s
        for s in stops
        if s.get("outcome") == "tested" and s.get("visit_minutes") is not None
    ]
    if longest_visit_stops:
        longest = sorted(
            longest_visit_stops,
            key=lambda s: int(s["visit_minutes"] or 0),
            reverse=True,
        )[:3]
        long_labels = ", ".join(
            f"{s['label']} ({int(s['visit_minutes'])} min)" for s in longest
        )
        insights.append(f"Longest visits: {long_labels}.")

    return insights


def build_route_performance_breakdown(
    route: MonthlyRoute,
    month_first: date,
) -> dict[str, object]:
    route_id = int(route.id)
    locations = (
        MonthlyLocation.query.filter_by(
            monthly_route_id=route_id,
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

    tested_count = sum(1 for s in stops if s.get("outcome") == "tested")
    skipped_annual_count = sum(1 for s in stops if s.get("outcome") == "skipped_annual")
    skipped_non_annual_count = sum(1 for s in stops if s.get("outcome") == "skipped_non_annual")
    pending_count = sum(1 for s in stops if s.get("outcome") is None)

    tested_revenue_total = round(
        sum(float(s["revenue"]) for s in stops),
        2,
    )

    timing_row = MonthlyRouteRunTimingMonth.query.filter_by(
        monthly_route_id=route_id,
        month_first=month_first,
        sync_status=SYNC_STATUS_OK,
    ).one_or_none()
    route_duration_minutes: int | None = None
    route_clock_in: str | None = None
    route_clock_out: str | None = None
    if timing_row is not None:
        route_clock_in = _format_servicetrade_run_clock(timing_row.clock_in_at)
        route_clock_out = _format_servicetrade_run_clock(timing_row.clock_out_at)
        if timing_row.duration_minutes is not None:
            route_duration_minutes = int(timing_row.duration_minutes)

    route_hours: float | None = None
    if route_duration_minutes is not None:
        route_hours = round(route_duration_minutes / 60.0, 1)

    sum_visit_minutes = sum(
        int(s["visit_minutes"]) for s in stops if isinstance(s.get("visit_minutes"), int)
    )
    visit_time_coverage = _visit_time_coverage(stops)

    unaccounted_minutes: int | None = None
    if route_duration_minutes is not None and sum_visit_minutes > 0:
        unaccounted_minutes = max(0, route_duration_minutes - sum_visit_minutes)

    avg_hours_billed = billed_avg_hours(route_hours)
    tech_count = effective_tech_count(route)
    monthly_expense = round(_monthly_expense_for_route(route, route_hours), 2)

    monthly_net: float | None = None
    monthly_net_pct: float | None = None
    if tested_revenue_total > 0:
        monthly_net = round(tested_revenue_total - monthly_expense, 2)
        monthly_net_pct = round(monthly_net / tested_revenue_total, 4)

    revenue_per_route_hour: float | None = None
    if tested_revenue_total > 0 and route_hours is not None and route_hours > 0:
        revenue_per_route_hour = round(tested_revenue_total / route_hours, 2)

    summary: dict[str, object] = {
        "tested_revenue_total": tested_revenue_total,
        "tested_count": tested_count,
        "skipped_annual_count": skipped_annual_count,
        "skipped_non_annual_count": skipped_non_annual_count,
        "pending_count": pending_count,
        "active_stop_count": len(locations),
        "route_duration_minutes": route_duration_minutes,
        "route_hours": route_hours,
        "route_duration_source": "servicetrade" if route_duration_minutes is not None else None,
        "route_clock_in": route_clock_in,
        "route_clock_out": route_clock_out,
        "avg_hours_billed": avg_hours_billed,
        "avg_hours_capped_for_billing": is_avg_hours_capped_for_billing(route_hours),
        "tech_count": tech_count,
        "monthly_expense": monthly_expense,
        "monthly_net": monthly_net,
        "monthly_net_pct": monthly_net_pct,
        "revenue_per_route_hour": revenue_per_route_hour,
        "sum_visit_minutes": sum_visit_minutes,
        "visit_time_coverage": visit_time_coverage,
        "unaccounted_minutes": unaccounted_minutes,
    }

    insights = _build_insights(
        summary=summary,
        stops=stops,
        active_stop_count=len(locations),
    )

    return {
        "month_date": month_first.isoformat(),
        "available_months": available_performance_months(route_id),
        "summary": summary,
        "stops": stops,
        "insights": insights,
    }
