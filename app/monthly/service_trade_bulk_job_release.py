"""Bulk release/unrelease ServiceTrade testing-job appointments for the monthlies dashboard."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date
from typing import Any, Iterator, Literal

import requests
from sqlalchemy import func

from app import db
from app.db_models import MonthlyLocation, MonthlyRoute, MonthlyRouteRunTimingMonth
from app.monthly.route_run_timing import upsert_route_month_timing_row
from app.monthly.service_trade_annual_schedule import month_window_pacific
from app.monthly.service_trade_route_run_timing import (
    SERVICE_TRADE_API_BASE,
    SYNC_STATUS_NO_JOB,
    SYNC_STATUS_NO_ST_LINK,
    SYNC_STATUS_SCHEDULED,
    _appointment_released,
    _job_status_normalized,
    _job_with_appointments,
    fetch_scheduled_testing_jobs_route_month,
    qualifying_appointment_for_month,
    select_testing_job_for_month,
    sync_route_month_timing,
    update_appointment_released,
)

BulkReleaseAction = Literal["release", "unrelease"]
ProgressStatus = Literal["success", "skipped", "failed"]


@dataclass(frozen=True)
class EligibleRouteReleaseRow:
    route_id: int
    route_number: int
    released: bool | None


def month_allows_bulk_st_release(month_first: date, *, current_month_first: date) -> bool:
    return month_first >= current_month_first


def timing_row_eligible_for_bulk(row: MonthlyRouteRunTimingMonth | None) -> bool:
    if row is None or row.service_trade_job_id is None:
        return False
    if row.sync_status in (SYNC_STATUS_NO_JOB, SYNC_STATUS_NO_ST_LINK):
        return False
    job_status = (row.service_trade_job_status or "").strip().lower()
    if job_status == "completed":
        return False
    if row.sync_status == SYNC_STATUS_SCHEDULED:
        return True
    return job_status == "scheduled"


def active_routes_with_st_link() -> list[MonthlyRoute]:
    count_rows = (
        db.session.query(
            MonthlyLocation.monthly_route_id.label("route_id"),
            func.count(MonthlyLocation.id).label("loc_count"),
        )
        .filter(MonthlyLocation.status_normalized == "active")
        .group_by(MonthlyLocation.monthly_route_id)
        .all()
    )
    active_ids = {
        int(row.route_id)
        for row in count_rows
        if row.route_id is not None and int(row.loc_count) > 0
    }
    if not active_ids:
        return []
    return (
        MonthlyRoute.query.filter(MonthlyRoute.id.in_(active_ids))
        .order_by(MonthlyRoute.route_number.asc())
        .all()
    )


def timing_rows_for_month(month_first: date, route_ids: list[int]) -> dict[int, MonthlyRouteRunTimingMonth]:
    if not route_ids:
        return {}
    rows = MonthlyRouteRunTimingMonth.query.filter(
        MonthlyRouteRunTimingMonth.monthly_route_id.in_(route_ids),
        MonthlyRouteRunTimingMonth.month_first == month_first,
    ).all()
    return {int(row.monthly_route_id): row for row in rows}


def eligible_routes_from_cache(
    routes: list[MonthlyRoute],
    timing_by_route_id: dict[int, MonthlyRouteRunTimingMonth],
) -> list[EligibleRouteReleaseRow]:
    eligible: list[EligibleRouteReleaseRow] = []
    for route in routes:
        if route.service_trade_route_location_id is None:
            continue
        timing_row = timing_by_route_id.get(int(route.id))
        if not timing_row_eligible_for_bulk(timing_row):
            continue
        eligible.append(
            EligibleRouteReleaseRow(
                route_id=int(route.id),
                route_number=int(route.route_number),
                released=timing_row.service_trade_appointment_released if timing_row else None,
            )
        )
    return eligible


def bulk_st_release_status_payload(
    month_first: date,
    *,
    current_month_first: date,
) -> dict[str, object]:
    month_allowed = month_allows_bulk_st_release(month_first, current_month_first=current_month_first)
    routes = active_routes_with_st_link()
    timing_by_route_id = timing_rows_for_month(month_first, [int(route.id) for route in routes])
    eligible = eligible_routes_from_cache(routes, timing_by_route_id)

    all_released = bool(eligible) and all(row.released is True for row in eligible)
    action: BulkReleaseAction | None
    if not eligible or not month_allowed:
        action = None
    elif all_released:
        action = "unrelease"
    else:
        action = "release"

    return {
        "month_date": month_first.isoformat(),
        "month_allowed": month_allowed,
        "eligible_count": len(eligible),
        "all_released": all_released,
        "action": action,
        "routes": [
            {
                "route_id": row.route_id,
                "route_number": row.route_number,
                "released": row.released,
            }
            for row in eligible
        ],
    }


def authenticate_service_trade(http: requests.Session) -> None:
    username = os.getenv("PROCESSING_USERNAME")
    password = os.getenv("PROCESSING_PASSWORD")
    if not username or not password:
        raise RuntimeError("Missing PROCESSING_USERNAME/PROCESSING_PASSWORD environment vars.")
    auth_url = f"{SERVICE_TRADE_API_BASE}/auth"
    response = http.post(auth_url, json={"username": username, "password": password})
    response.raise_for_status()


def resolve_live_scheduled_testing_job(
    http: requests.Session,
    st_route_id: int,
    month_first: date,
) -> tuple[int, int, bool | None] | None:
    """Return ``(job_id, appointment_id, released)`` for the qualifying scheduled testing job."""
    start_ts, end_ts = month_window_pacific(month_first)
    scheduled_jobs = fetch_scheduled_testing_jobs_route_month(
        http,
        int(st_route_id),
        month_first=month_first,
    )
    job = select_testing_job_for_month(scheduled_jobs, start_ts=start_ts, end_ts=end_ts)
    if job is None:
        return None
    job = _job_with_appointments(http, job)
    if _job_status_normalized(job) == "completed":
        return None
    appointment = qualifying_appointment_for_month(job, start_ts=start_ts, end_ts=end_ts)
    if appointment is None or appointment.get("id") is None:
        return None
    job_id = job.get("id")
    if job_id is None:
        return None
    return int(job_id), int(appointment["id"]), _appointment_released(appointment)


def iter_bulk_st_job_release(
    http: requests.Session,
    *,
    month_first: date,
    action: BulkReleaseAction,
    routes: list[MonthlyRoute],
    timing_by_route_id: dict[int, MonthlyRouteRunTimingMonth],
) -> Iterator[dict[str, Any]]:
    eligible = eligible_routes_from_cache(routes, timing_by_route_id)
    routes_by_id = {int(route.id): route for route in routes}
    target_released = action == "release"
    total = len(eligible)

    yield {"type": "start", "total": total, "action": action}

    success_count = 0
    skipped_count = 0
    failed_count = 0
    failures: list[dict[str, object]] = []

    for index, row in enumerate(eligible, start=1):
        route = routes_by_id.get(row.route_id)
        route_number = row.route_number
        if route is None or route.service_trade_route_location_id is None:
            skipped_count += 1
            yield {
                "type": "progress",
                "index": index,
                "total": total,
                "route_number": route_number,
                "status": "skipped",
                "message": "No ServiceTrade route link",
            }
            continue

        try:
            resolved = resolve_live_scheduled_testing_job(
                http,
                int(route.service_trade_route_location_id),
                month_first,
            )
            if resolved is None:
                skipped_count += 1
                yield {
                    "type": "progress",
                    "index": index,
                    "total": total,
                    "route_number": route_number,
                    "status": "skipped",
                    "message": "No scheduled testing job for this month",
                }
                continue

            _job_id, appointment_id, currently_released = resolved
            if target_released and currently_released is True:
                skipped_count += 1
                yield {
                    "type": "progress",
                    "index": index,
                    "total": total,
                    "route_number": route_number,
                    "status": "skipped",
                    "message": "Already released",
                }
                continue
            if not target_released and currently_released is not True:
                skipped_count += 1
                yield {
                    "type": "progress",
                    "index": index,
                    "total": total,
                    "route_number": route_number,
                    "status": "skipped",
                    "message": "Already unreleased",
                }
                continue

            update_appointment_released(http, appointment_id, released=target_released)
            sync_result = sync_route_month_timing(
                http,
                st_route_id=int(route.service_trade_route_location_id),
                month_first=month_first,
            )
            upsert_route_month_timing_row(
                monthly_route_id=int(route.id),
                month_first=month_first,
                result=sync_result,
            )
            db.session.commit()

            success_count += 1
            verb = "Released" if target_released else "Unreleased"
            yield {
                "type": "progress",
                "index": index,
                "total": total,
                "route_number": route_number,
                "status": "success",
                "message": verb,
            }
        except Exception as exc:  # noqa: BLE001 — per-route failure should not abort the batch
            db.session.rollback()
            failed_count += 1
            message = str(exc).strip() or exc.__class__.__name__
            failures.append({"route_number": route_number, "message": message})
            yield {
                "type": "progress",
                "index": index,
                "total": total,
                "route_number": route_number,
                "status": "failed",
                "message": message,
            }

    yield {
        "type": "done",
        "success_count": success_count,
        "skipped_count": skipped_count,
        "failed_count": failed_count,
        "failures": failures,
    }
