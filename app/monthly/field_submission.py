"""Frozen technician worksheet snapshot at portal field end."""

from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy.exc import OperationalError, ProgrammingError

from app.db_models import MonthlyRouteRun, MonthlyRouteRunFieldSubmission, db
from app.monthly.worksheet_stops import worksheet_stops_for_route_month

if TYPE_CHECKING:
    pass


def _allocate_row_id(model_cls) -> int | None:
    """SQLite tests use BIGINT PK without autoincrement; Postgres uses SERIAL."""
    bind = db.session.get_bind()
    if bind.dialect.name != "sqlite":
        return None
    from sqlalchemy import func

    current = db.session.query(func.max(model_cls.id)).scalar()
    return int(current or 0) + 1


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.isoformat()


def _enrich_field_submission_stops(
    stops: list[object],
    run: MonthlyRouteRun,
    month_first: date,
) -> list[dict[str, object]]:
    """Attach ``new_comment_fields`` so exact history can highlight run-added comments."""
    from app.monthly.run_details_review import (
        _field_changes_by_location,
        _new_comment_fields_for_stop,
    )

    route_id = int(run.monthly_route_id)
    dict_stops: list[dict[str, object]] = [dict(raw) for raw in stops if isinstance(raw, dict)]
    if not dict_stops:
        return []
    location_ids = sorted({int(s["location_id"]) for s in dict_stops if s.get("location_id") is not None})
    changes_by_loc = _field_changes_by_location(route_id, month_first, location_ids, run=run)
    enriched: list[dict[str, object]] = []
    for stop in dict_stops:
        lid = int(stop["location_id"])
        stop["new_comment_fields"] = _new_comment_fields_for_stop(
            stop,
            month_first,
            route_id,
            run=run,
            field_changes=changes_by_loc.get(lid, []),
        )
        enriched.append(stop)
    return enriched


def capture_field_submission_for_run(run: MonthlyRouteRun, *, captured_at: datetime) -> MonthlyRouteRunFieldSubmission:
    """Upsert the latest field submission payload for this run."""
    route_id = int(run.monthly_route_id)
    month_first = run.month_date
    stops = worksheet_stops_for_route_month(route_id, month_first, include_portal_extras=True)
    stops = _enrich_field_submission_stops(stops, run, month_first)
    payload = {
        "stops": stops,
        "route_id": route_id,
        "month_date": month_first.isoformat(),
    }
    row = MonthlyRouteRunFieldSubmission.query.filter_by(run_id=int(run.id)).one_or_none()
    if row is None:
        kwargs: dict = {
            "run_id": int(run.id),
            "captured_at": captured_at,
            "payload_json": payload,
        }
        new_id = _allocate_row_id(MonthlyRouteRunFieldSubmission)
        if new_id is not None:
            kwargs["id"] = new_id
        row = MonthlyRouteRunFieldSubmission(**kwargs)
        db.session.add(row)
    else:
        row.captured_at = captured_at
        row.payload_json = payload
    db.session.flush()
    return row


def worksheet_stops_from_field_submission_if_frozen(
    run: MonthlyRouteRun,
) -> list[dict[str, object]] | None:
    """Return frozen portal worksheet stops when field work has ended and a snapshot exists.

    Used for historical iPad browse and any read-only worksheet surface so stop order and
    field values match the captured submission, not the live route library order.
    """
    if run.field_ended_at is None:
        return None
    submission = get_field_submission_for_run(int(run.id))
    if submission is None:
        return None
    payload = submission.payload_json if isinstance(submission.payload_json, dict) else {}
    raw_stops = payload.get("stops")
    if not isinstance(raw_stops, list) or not raw_stops:
        return None
    stops: list[dict[str, object]] = []
    for raw in raw_stops:
        if isinstance(raw, dict):
            stops.append(dict(raw))
    return stops or None


def get_field_submission_for_run(run_id: int) -> MonthlyRouteRunFieldSubmission | None:
    try:
        return MonthlyRouteRunFieldSubmission.query.filter_by(run_id=int(run_id)).one_or_none()
    except (OperationalError, ProgrammingError):
        db.session.rollback()
        return None


def ensure_field_submission_for_run(run: MonthlyRouteRun) -> MonthlyRouteRunFieldSubmission | None:
    """Return the frozen snapshot, backfilling from live stops when field work ended without one."""
    existing = get_field_submission_for_run(int(run.id))
    if existing is not None:
        return existing
    if run.field_ended_at is None:
        return None
    return capture_field_submission_for_run(run, captured_at=run.field_ended_at)


def serialize_field_submission_payload(
    run: MonthlyRouteRun | None,
    submission: MonthlyRouteRunFieldSubmission | None,
    *,
    month_first: date,
) -> dict[str, object] | None:
    if submission is None:
        return None
    payload = submission.payload_json if isinstance(submission.payload_json, dict) else {}
    stops = payload.get("stops")
    if not isinstance(stops, list):
        stops = []
    elif run is not None and any(
        isinstance(s, dict) and "new_comment_fields" not in s for s in stops
    ):
        # Legacy snapshots only; capture already enriches at write time.
        stops = _enrich_field_submission_stops(stops, run, month_first)
    field_work_reopened = run is not None and run.field_ended_at is None
    return {
        "run_id": int(submission.run_id),
        "month_date": month_first.isoformat(),
        "captured_at": _iso(submission.captured_at),
        "field_work_reopened": field_work_reopened,
        "stops": stops,
    }
