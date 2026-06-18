"""Test history index for the technician portal site history modal."""

from __future__ import annotations

from datetime import date

from app.db_models import MonthlyLocation


def serialize_portal_test_history_index(location_id: int) -> dict[str, object] | None:
    """Build month index with field-submission availability for one library location."""
    from app.routes.monthly_routes import _months_payload_for_location

    loc = MonthlyLocation.query.filter_by(id=int(location_id)).one_or_none()
    if loc is None:
        return None

    raw_months = enrich_months_with_field_submission(
        _months_payload_for_location(int(location_id)),
        location_id=int(location_id),
    )
    months: dict[str, dict[str, object]] = {}
    latest_submission_month: str | None = None

    for month_iso in sorted(raw_months.keys()):
        cell = raw_months[month_iso]
        route_id = _resolve_route_id(cell, loc)
        has_field_submission = bool(cell.get("has_field_submission"))
        months[month_iso] = {
            "route_id": route_id,
            "has_field_submission": has_field_submission,
            "result_status": cell.get("result_status"),
            "skip_reason": cell.get("skip_reason"),
            "run_id": cell.get("run_id"),
        }

    for month_iso in sorted(raw_months.keys(), reverse=True):
        if raw_months[month_iso].get("has_field_submission"):
            latest_submission_month = month_iso
            break

    return {
        "location_id": int(location_id),
        "monthly_route_id": int(loc.monthly_route_id) if loc.monthly_route_id is not None else None,
        "months": months,
        "latest_submission_month": latest_submission_month,
    }


def _resolve_route_id(cell: dict[str, object], loc: MonthlyLocation) -> int | None:
    worksheet_route_id = cell.get("worksheet_route_id")
    if isinstance(worksheet_route_id, int):
        return worksheet_route_id
    test_route = cell.get("test_monthly_route")
    if isinstance(test_route, dict):
        route_id = test_route.get("id")
        if isinstance(route_id, int):
            return route_id
    if loc.monthly_route_id is not None:
        return int(loc.monthly_route_id)
    return None


def enrich_months_with_field_submission(
    raw_months: dict[str, dict[str, object]],
    *,
    location_id: int | None = None,
) -> dict[str, dict[str, object]]:
    """Add field-submission flags to each month cell from linked run rows."""
    from app.db_models import MonthlyRouteRun
    from app.monthly.worksheet_locations import worksheet_locations_for_route_month

    run_ids: set[int] = set()
    for cell in raw_months.values():
        run_id = cell.get("run_id")
        if isinstance(run_id, int):
            run_ids.add(run_id)

    runs_with_submission: set[int] = set()
    if run_ids:
        rows = MonthlyRouteRun.query.filter(MonthlyRouteRun.id.in_(run_ids)).all()
        for run in rows:
            if run.field_ended_at is not None:
                runs_with_submission.add(int(run.id))

    site_on_worksheet_cache: dict[tuple[int, str], bool] = {}

    enriched: dict[str, dict[str, object]] = {}
    for month_iso, cell in raw_months.items():
        out = dict(cell)
        run_id = out.get("run_id")
        has_field_submission = isinstance(run_id, int) and run_id in runs_with_submission
        out["has_field_submission"] = has_field_submission

        has_site_field_submission = False
        if has_field_submission and location_id is not None:
            route_id = _worksheet_route_id_from_cell(out)
            month_first = _month_iso_to_date(month_iso)
            if route_id is not None and month_first is not None:
                cache_key = (route_id, month_iso)
                if cache_key not in site_on_worksheet_cache:
                    locs = worksheet_locations_for_route_month(route_id, month_first)
                    site_ids = {
                        int(row["location_id"])
                        for row in locs
                        if row.get("location_id") is not None
                    }
                    site_on_worksheet_cache[cache_key] = int(location_id) in site_ids
                has_site_field_submission = site_on_worksheet_cache[cache_key]
        out["has_site_field_submission"] = has_site_field_submission
        enriched[month_iso] = out
    return enriched


def _month_iso_to_date(month_iso: str) -> date | None:
    try:
        y, m, d = (int(part) for part in month_iso.split("-"))
        return date(y, m, d)
    except (TypeError, ValueError):
        return None


def _worksheet_route_id_from_cell(cell: dict[str, object]) -> int | None:
    worksheet_route_id = cell.get("worksheet_route_id")
    if isinstance(worksheet_route_id, int):
        return worksheet_route_id
    test_route = cell.get("test_monthly_route")
    if isinstance(test_route, dict):
        route_id = test_route.get("id")
        if isinstance(route_id, int):
            return route_id
    return None
