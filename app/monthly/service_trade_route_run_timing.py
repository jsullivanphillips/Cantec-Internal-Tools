"""ServiceTrade testing-job route run timing helpers."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

import requests

from app.monthly.visit_clock_times import duration_minutes_from_start_end
from app.monthly.service_trade_annual_schedule import (
    appointment_qualifies,
    month_window_pacific,
)
from app.routes.scheduling_attack import parse_dt

log = logging.getLogger(__name__)

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
PACIFIC = ZoneInfo("America/Vancouver")
TESTING_JOB_TYPE = "testing"
JOB_PAGE_LIMIT = 100

SYNC_STATUS_OK = "ok"
SYNC_STATUS_SCHEDULED = "scheduled"
SYNC_STATUS_NO_ST_LINK = "no_st_link"
SYNC_STATUS_NO_JOB = "no_job"
SYNC_STATUS_NO_CLOCKS = "no_clocks"


@dataclass(frozen=True)
class RouteRunTimingSyncResult:
    service_trade_job_id: int | None
    clock_in_at: datetime | None
    clock_out_at: datetime | None
    duration_minutes: int | None
    sync_status: str
    service_trade_job_status: str | None = None
    service_trade_appointment_released: bool | None = None
    service_trade_qualifying_appointment_on: date | None = None


def _appointment_window_start_ts(appointment: dict[str, Any]) -> int | None:
    window_start = appointment.get("windowStart")
    if window_start is None:
        return None
    try:
        return int(window_start)
    except (TypeError, ValueError):
        return None


def job_has_qualifying_appointment_in_month(
    job: dict[str, Any],
    *,
    start_ts: int,
    end_ts: int,
) -> bool:
    for appointment in job.get("appointments", []) or []:
        if appointment_qualifies(appointment, start_ts=start_ts, end_ts=end_ts):
            return True
    return False


def latest_qualifying_appointment_window_start(
    job: dict[str, Any],
    *,
    start_ts: int,
    end_ts: int,
) -> int | None:
    best: int | None = None
    for appointment in job.get("appointments", []) or []:
        if not appointment_qualifies(appointment, start_ts=start_ts, end_ts=end_ts):
            continue
        ts = _appointment_window_start_ts(appointment)
        if ts is None:
            continue
        if best is None or ts > best:
            best = ts
    return best


def qualifying_appointment_for_month(
    job: dict[str, Any],
    *,
    start_ts: int,
    end_ts: int,
) -> dict[str, Any] | None:
    """Appointment with the latest qualifying ``windowStart`` in the month window."""
    best_ts: int | None = None
    best_appt: dict[str, Any] | None = None
    for appointment in job.get("appointments", []) or []:
        if not appointment_qualifies(appointment, start_ts=start_ts, end_ts=end_ts):
            continue
        ts = _appointment_window_start_ts(appointment)
        if ts is None:
            continue
        if best_ts is None or ts > best_ts:
            best_ts = ts
            best_appt = appointment
    return best_appt


def _appointment_released(appointment: dict[str, Any] | None) -> bool | None:
    if appointment is None:
        return None
    released_raw = appointment.get("released")
    if released_raw is None:
        return None
    if isinstance(released_raw, bool):
        return released_raw
    return bool(released_raw)


def _job_status_normalized(job: dict[str, Any] | None) -> str | None:
    if job is None:
        return None
    status = (str(job.get("status") or "")).strip().lower()
    return status or None


def qualifying_appointment_pacific_date(
    job: dict[str, Any],
    *,
    start_ts: int,
    end_ts: int,
) -> date | None:
    appointment = qualifying_appointment_for_month(job, start_ts=start_ts, end_ts=end_ts)
    if appointment is None:
        return None
    window_start = appointment.get("windowStart")
    if window_start is None:
        return None
    try:
        ts = int(window_start)
    except (TypeError, ValueError):
        return None
    return datetime.fromtimestamp(ts, tz=PACIFIC).date()


def _job_timing_metadata(
    job: dict[str, Any],
    *,
    start_ts: int,
    end_ts: int,
) -> tuple[str | None, bool | None, date | None]:
    qual_appt = qualifying_appointment_for_month(job, start_ts=start_ts, end_ts=end_ts)
    return (
        _job_status_normalized(job),
        _appointment_released(qual_appt),
        qualifying_appointment_pacific_date(job, start_ts=start_ts, end_ts=end_ts),
    )


def select_testing_job_for_month(
    jobs: list[dict[str, Any]],
    *,
    start_ts: int,
    end_ts: int,
) -> dict[str, Any] | None:
    """Pick the testing job whose qualifying appointment has the latest windowStart."""
    candidates: list[tuple[int, dict[str, Any]]] = []
    for job in jobs:
        job_type = (str(job.get("type") or "")).strip().lower()
        if job_type != TESTING_JOB_TYPE:
            continue
        window_start = latest_qualifying_appointment_window_start(
            job,
            start_ts=start_ts,
            end_ts=end_ts,
        )
        if window_start is None:
            continue
        candidates.append((window_start, job))

    if not candidates:
        return None

    if len(candidates) > 1:
        log.warning(
            "Multiple testing jobs with appointments in month window; using latest windowStart "
            "(count=%s job_ids=%s)",
            len(candidates),
            [job.get("id") for _, job in candidates],
        )

    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def completed_on_range_unix(month_first: date) -> tuple[int, int]:
    """Pacific calendar month as ServiceTrade completedOnBegin/End (inclusive end)."""
    start_ts, end_exclusive = month_window_pacific(month_first)
    return start_ts, end_exclusive - 1


def fetch_testing_jobs_route_month(
    http: requests.Session,
    st_route_id: int,
    *,
    month_first: date,
) -> list[dict[str, Any]]:
    """Paginated GET /job for completed testing jobs at a route location.

    Uses ``completedOnBegin/End`` (same window as specialist sync). Route testing
    jobs at pseudo-locations are not returned by ``scheduleDateFrom/To`` in practice.
    """
    completed_begin, completed_end = completed_on_range_unix(month_first)
    all_jobs: list[dict[str, Any]] = []
    page = 1
    while True:
        params: dict[str, Any] = {
            "locationId": st_route_id,
            "status": "completed",
            "completedOnBegin": completed_begin,
            "completedOnEnd": completed_end,
            "type": TESTING_JOB_TYPE,
            "limit": JOB_PAGE_LIMIT,
            "page": page,
        }
        response = http.get(f"{SERVICE_TRADE_API_BASE}/job", params=params)
        response.raise_for_status()
        data = response.json().get("data", {}) or {}
        jobs = data.get("jobs", []) or []
        all_jobs.extend(jobs)
        total_pages = int(data.get("totalPages") or 1)
        if page >= total_pages:
            break
        page += 1
    return all_jobs


def _paginated_jobs_at_route(
    http: requests.Session,
    st_route_id: int,
    *,
    params: dict[str, Any],
) -> list[dict[str, Any]]:
    all_jobs: list[dict[str, Any]] = []
    page = 1
    while True:
        page_params = {**params, "locationId": st_route_id, "limit": JOB_PAGE_LIMIT, "page": page}
        response = http.get(f"{SERVICE_TRADE_API_BASE}/job", params=page_params)
        response.raise_for_status()
        data = response.json().get("data", {}) or {}
        jobs = data.get("jobs", []) or []
        all_jobs.extend(jobs)
        total_pages = int(data.get("totalPages") or 1)
        if page >= total_pages:
            break
        page += 1
    return all_jobs


def fetch_appointments_for_job(
    http: requests.Session,
    job_id: int,
    *,
    limit: int = 200,
) -> list[dict[str, Any]]:
    response = http.get(
        f"{SERVICE_TRADE_API_BASE}/appointment",
        params={"jobId": int(job_id), "limit": limit},
    )
    response.raise_for_status()
    data = response.json().get("data", {}) or {}
    return list(data.get("appointments") or [])


def _job_with_appointments(
    http: requests.Session,
    job: dict[str, Any],
) -> dict[str, Any]:
    appointments = job.get("appointments") or []
    if appointments:
        return job
    job_id = job.get("id")
    if job_id is None:
        return job
    enriched = dict(job)
    enriched["appointments"] = fetch_appointments_for_job(http, int(job_id))
    return enriched


def fetch_scheduled_testing_jobs_route_month(
    http: requests.Session,
    st_route_id: int,
    *,
    month_first: date,
) -> list[dict[str, Any]]:
    """Paginated GET /job for scheduled testing jobs at a route pseudo-location.

    Completed jobs are fetched separately via ``completedOn``; this path exists so
    office can link to the upcoming route testing job before field completion.
    """
    start_ts, end_ts = month_window_pacific(month_first)
    by_id: dict[int, dict[str, Any]] = {}

    for params in (
        {
            "status": "scheduled",
            "type": TESTING_JOB_TYPE,
            "scheduleDateFrom": start_ts,
            "scheduleDateTo": end_ts,
        },
        {
            "status": "scheduled",
            "type": TESTING_JOB_TYPE,
        },
    ):
        for job in _paginated_jobs_at_route(http, st_route_id, params=params):
            job_id = job.get("id")
            if job_id is None:
                continue
            by_id.setdefault(int(job_id), job)

    return [_job_with_appointments(http, job) for job in by_id.values()]


def _is_onsite_pair(pair: dict[str, Any]) -> bool:
    start = pair.get("start") or {}
    end = pair.get("end") or {}
    act_s = (start.get("activity") or "").lower()
    act_e = (end.get("activity") or "").lower()
    return act_s == "onsite" or act_e == "onsite"


def fetch_paired_clock_events(
    http: requests.Session,
    job_id: int,
) -> list[dict[str, Any]]:
    response = http.get(f"{SERVICE_TRADE_API_BASE}/job/{job_id}/clockevent")
    response.raise_for_status()
    payload = response.json()
    return (
        payload.get("pairedEvents")
        or payload.get("data", {}).get("pairedEvents")
        or []
    )


def run_times_from_clock_pairs(
    pairs: list[dict[str, Any]],
) -> tuple[datetime | None, datetime | None, int | None]:
    """Earliest onsite clock-in and latest onsite clock-out across pairs."""
    clock_ins: list[datetime] = []
    clock_outs: list[datetime] = []
    for pair in pairs:
        if not _is_onsite_pair(pair):
            continue
        start = pair.get("start") or {}
        end = pair.get("end") or {}
        dt_in = parse_dt(start.get("eventTime"))
        dt_out = parse_dt(end.get("eventTime"))
        if dt_in is not None:
            clock_ins.append(dt_in)
        if dt_out is not None:
            clock_outs.append(dt_out)

    if not clock_ins or not clock_outs:
        return None, None, None

    clock_in_at = min(clock_ins)
    clock_out_at = max(clock_outs)
    in_pacific = clock_in_at.astimezone(PACIFIC)
    out_pacific = clock_out_at.astimezone(PACIFIC)
    start_minute = in_pacific.hour * 60 + in_pacific.minute
    end_minute = out_pacific.hour * 60 + out_pacific.minute
    duration_minutes = duration_minutes_from_start_end(start_minute, end_minute)
    return clock_in_at, clock_out_at, duration_minutes


def run_times_from_job_clock_events(
    http: requests.Session,
    job_id: int,
) -> tuple[datetime | None, datetime | None, int | None]:
    pairs = fetch_paired_clock_events(http, job_id)
    return run_times_from_clock_pairs(pairs)


def sync_route_month_timing(
    http: requests.Session,
    *,
    st_route_id: int | None,
    month_first: date,
) -> RouteRunTimingSyncResult:
    if st_route_id is None:
        return RouteRunTimingSyncResult(
            service_trade_job_id=None,
            clock_in_at=None,
            clock_out_at=None,
            duration_minutes=None,
            sync_status=SYNC_STATUS_NO_ST_LINK,
        )

    start_ts, end_ts = month_window_pacific(month_first)
    raw_completed_jobs = fetch_testing_jobs_route_month(
        http,
        int(st_route_id),
        month_first=month_first,
    )
    completed_jobs = [_job_with_appointments(http, j) for j in raw_completed_jobs]
    job = select_testing_job_for_month(completed_jobs, start_ts=start_ts, end_ts=end_ts)
    scheduled_only = False
    if job is None:
        scheduled_jobs = fetch_scheduled_testing_jobs_route_month(
            http,
            int(st_route_id),
            month_first=month_first,
        )
        job = select_testing_job_for_month(scheduled_jobs, start_ts=start_ts, end_ts=end_ts)
        scheduled_only = job is not None
    if job is None:
        return RouteRunTimingSyncResult(
            service_trade_job_id=None,
            clock_in_at=None,
            clock_out_at=None,
            duration_minutes=None,
            sync_status=SYNC_STATUS_NO_JOB,
        )

    job = _job_with_appointments(http, job)
    job_status, appointment_released, appointment_on = _job_timing_metadata(
        job,
        start_ts=start_ts,
        end_ts=end_ts,
    )

    job_id = job.get("id")
    if job_id is None:
        return RouteRunTimingSyncResult(
            service_trade_job_id=None,
            clock_in_at=None,
            clock_out_at=None,
            duration_minutes=None,
            sync_status=SYNC_STATUS_NO_JOB,
        )

    job_id_int = int(job_id)
    if scheduled_only:
        return RouteRunTimingSyncResult(
            service_trade_job_id=job_id_int,
            clock_in_at=None,
            clock_out_at=None,
            duration_minutes=None,
            sync_status=SYNC_STATUS_SCHEDULED,
            service_trade_job_status=job_status,
            service_trade_appointment_released=appointment_released,
            service_trade_qualifying_appointment_on=appointment_on,
        )

    clock_in_at, clock_out_at, duration_minutes = run_times_from_job_clock_events(
        http,
        job_id_int,
    )
    if duration_minutes is None:
        return RouteRunTimingSyncResult(
            service_trade_job_id=job_id_int,
            clock_in_at=clock_in_at,
            clock_out_at=clock_out_at,
            duration_minutes=None,
            sync_status=SYNC_STATUS_NO_CLOCKS,
            service_trade_job_status=job_status,
            service_trade_appointment_released=appointment_released,
            service_trade_qualifying_appointment_on=appointment_on,
        )

    return RouteRunTimingSyncResult(
        service_trade_job_id=job_id_int,
        clock_in_at=clock_in_at,
        clock_out_at=clock_out_at,
        duration_minutes=duration_minutes,
        sync_status=SYNC_STATUS_OK,
        service_trade_job_status=job_status,
        service_trade_appointment_released=appointment_released,
        service_trade_qualifying_appointment_on=appointment_on,
    )


def update_appointment_released(
    http: requests.Session,
    appointment_id: int,
    *,
    released: bool,
) -> None:
    """PUT /appointment/{id} — release or unrelease for assigned technicians."""
    url = f"{SERVICE_TRADE_API_BASE}/appointment/{int(appointment_id)}"
    response = http.put(url, json={"released": bool(released)})
    response.raise_for_status()
