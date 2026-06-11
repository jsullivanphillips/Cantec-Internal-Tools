"""Frozen technician worksheet snapshot at portal field end (flat model)."""

from __future__ import annotations

from datetime import date, datetime

from app.db_models import MonthlyRouteRun
from app.monthly.worksheet_locations import worksheet_locations_for_route_month


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.isoformat()


def _enrich_field_submission_locations(
    locations: list[dict[str, object]],
    run: MonthlyRouteRun,
    month_first: date,
) -> list[dict[str, object]]:
    from app.monthly.run_details_review import (
        _field_changes_by_location,
        _new_comment_fields_for_stop,
    )

    route_id = int(run.monthly_route_id)
    if not locations:
        return []
    location_ids = sorted(
        {int(row["location_id"]) for row in locations if row.get("location_id") is not None}
    )
    changes_by_loc = _field_changes_by_location(route_id, month_first, location_ids, run=run)
    enriched: list[dict[str, object]] = []
    for location_row in locations:
        lid = int(location_row["location_id"])
        location_row = dict(location_row)
        location_row["new_comment_fields"] = _new_comment_fields_for_stop(
            location_row,
            month_first,
            route_id,
            run=run,
            field_changes=changes_by_loc.get(lid, []),
        )
        enriched.append(location_row)
    return enriched


def serialize_field_submission_payload(
    run: MonthlyRouteRun | None,
    *,
    month_first: date,
) -> dict[str, object] | None:
    if run is None or run.field_ended_at is None:
        return None
    route_id = int(run.monthly_route_id)
    locations = worksheet_locations_for_route_month(
        route_id,
        month_first,
        include_portal_extras=True,
    )
    locations = _enrich_field_submission_locations(locations, run, month_first)
    return {
        "run_id": int(run.id),
        "month_date": month_first.isoformat(),
        "captured_at": _iso(run.field_ended_at),
        "field_work_reopened": False,
        "stops": locations,
    }
