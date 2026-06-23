"""ServiceTrade annual inspection schedule checks for office run preparation."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

import requests

from app.db_models import MonthlyLocation
from app.monthly.service_trade_site_match import (
    SERVICE_TRADE_API_BASE,
    service_trade_site_location_url,
)
from app.monthly.worksheet_locations import (
    _coalesce_with_master,
    _is_annual_for_month,
    _resolve_worksheet_route_locations,
    _worksheet_location_pairs_for_route_month,
    master_template_fields,
)

PACIFIC_TZ = ZoneInfo("America/Vancouver")

QUALIFYING_JOB_TYPES = frozenset({"inspection", "replacement", "upgrade", "installation"})

_CANCELLED_STATUSES = frozenset({"cancelled", "canceled", "void", "deleted"})

_QUALIFYING_APPOINTMENT_STATUSES = frozenset({"scheduled", "completed"})

_LOCATION_ID_CHUNK_SIZE = 50

PrepWarning = str | None


@dataclass(frozen=True)
class AnnualScheduleLocationSnapshot:
    location_id: int
    annual_month_matches_run: bool
    has_service_trade_link: bool
    service_trade_site_location_url: str | None
    has_scheduled_annual_in_month: bool
    prep_warning: PrepWarning

    def to_dict(self) -> dict[str, object]:
        return {
            "location_id": self.location_id,
            "annual_month_matches_run": self.annual_month_matches_run,
            "has_service_trade_link": self.has_service_trade_link,
            "service_trade_site_location_url": self.service_trade_site_location_url,
            "has_scheduled_annual_in_month": self.has_scheduled_annual_in_month,
            "prep_warning": self.prep_warning,
        }


def month_window_pacific(month_first: date) -> tuple[int, int]:
    """Return ``(start_ts, end_ts)`` for the calendar month in Pacific (end exclusive)."""
    start = datetime(month_first.year, month_first.month, 1, tzinfo=PACIFIC_TZ)
    if month_first.month == 12:
        end = datetime(month_first.year + 1, 1, 1, tzinfo=PACIFIC_TZ)
    else:
        end = datetime(month_first.year, month_first.month + 1, 1, tzinfo=PACIFIC_TZ)
    return int(start.timestamp()), int(end.timestamp())


def job_qualifies(job: dict[str, Any]) -> bool:
    status = (str(job.get("status") or "")).strip().lower()
    if status in _CANCELLED_STATUSES:
        return False
    job_type = (str(job.get("type") or "")).strip().lower()
    return job_type in QUALIFYING_JOB_TYPES


def appointment_qualifies(
    appointment: dict[str, Any],
    *,
    start_ts: int,
    end_ts: int,
) -> bool:
    status = (str(appointment.get("status") or "")).strip().lower()
    if status in _CANCELLED_STATUSES:
        return False
    if status not in _QUALIFYING_APPOINTMENT_STATUSES:
        return False
    window_start = appointment.get("windowStart")
    if window_start is None:
        return False
    try:
        ts = int(window_start)
    except (TypeError, ValueError):
        return False
    return start_ts <= ts < end_ts


def derive_prep_warning(
    *,
    annual_month_matches_run: bool,
    has_service_trade_link: bool,
    has_scheduled_annual_in_month: bool,
) -> PrepWarning:
    if annual_month_matches_run:
        if not has_service_trade_link:
            return "no_servicetrade_link"
        if not has_scheduled_annual_in_month:
            return "no_annual_scheduled"
        return None
    if has_scheduled_annual_in_month:
        return "annual_scheduled_wrong_month"
    return None


def _job_location_id(job: dict[str, Any]) -> int | None:
    location = job.get("location") or {}
    if not isinstance(location, dict):
        return None
    location_id = location.get("id")
    if location_id is None:
        return None
    try:
        return int(location_id)
    except (TypeError, ValueError):
        return None


def _annual_month_for_location(
    loc: MonthlyLocation,
    mlm_annual_month: object | None,
) -> str | None:
    master = master_template_fields(loc)
    annual_month = _coalesce_with_master(mlm_annual_month, master.get("annual_month"))
    if annual_month is None:
        return None
    text = str(annual_month).strip()
    return text or None


def _route_location_rows(route_id: int, month_first: date) -> list[tuple[MonthlyLocation, str | None]]:
    locs = _resolve_worksheet_route_locations(route_id, month_first)
    if not locs:
        return []
    pairs = _worksheet_location_pairs_for_route_month(route_id, month_first, locs=locs)
    rows: list[tuple[MonthlyLocation, str | None]] = []
    for mlm, loc in pairs:
        annual_month = _annual_month_for_location(loc, mlm.annual_month if mlm is not None else None)
        rows.append((loc, annual_month))
    return rows


def _authenticate_service_trade(http: requests.Session, *, username: str, password: str) -> None:
    http.headers.setdefault("Accept", "application/json")
    auth_resp = http.post(
        f"{SERVICE_TRADE_API_BASE}/auth",
        json={"username": username, "password": password},
    )
    auth_resp.raise_for_status()


def _fetch_jobs_for_location_chunk(
    http: requests.Session,
    location_ids: list[int],
    *,
    start_ts: int,
    end_ts: int,
    limit: int = 500,
) -> list[dict[str, Any]]:
    if not location_ids:
        return []
    location_param = ",".join(str(location_id) for location_id in location_ids)
    jobs: list[dict[str, Any]] = []
    page = 1
    while True:
        resp = http.get(
            f"{SERVICE_TRADE_API_BASE}/job",
            params={
                "locationId": location_param,
                "scheduleDateFrom": start_ts,
                "scheduleDateTo": end_ts,
                "type": ",".join(sorted(QUALIFYING_JOB_TYPES)),
                "limit": limit,
                "page": page,
            },
        )
        resp.raise_for_status()
        payload = resp.json()
        data = payload.get("data") or {}
        batch = data.get("jobs") or []
        if not batch:
            break
        jobs.extend(batch)
        if len(batch) < limit:
            break
        page += 1
    return jobs


def _fetch_appointments_for_job(
    http: requests.Session,
    job_id: int,
    *,
    limit: int = 200,
) -> list[dict[str, Any]]:
    resp = http.get(
        f"{SERVICE_TRADE_API_BASE}/appointment",
        params={"jobId": int(job_id), "limit": limit},
    )
    resp.raise_for_status()
    payload = resp.json()
    data = payload.get("data") or {}
    return list(data.get("appointments") or [])


def _locations_with_qualifying_appointments(
    http: requests.Session,
    st_location_ids: set[int],
    *,
    start_ts: int,
    end_ts: int,
) -> set[int]:
    if not st_location_ids:
        return set()

    st_ids_sorted = sorted(st_location_ids)
    jobs: list[dict[str, Any]] = []
    for offset in range(0, len(st_ids_sorted), _LOCATION_ID_CHUNK_SIZE):
        chunk = st_ids_sorted[offset : offset + _LOCATION_ID_CHUNK_SIZE]
        jobs.extend(_fetch_jobs_for_location_chunk(http, chunk, start_ts=start_ts, end_ts=end_ts))

    matched: set[int] = set()
    seen_job_ids: set[int] = set()
    for job in jobs:
        if not job_qualifies(job):
            continue
        st_location_id = _job_location_id(job)
        if st_location_id is None or st_location_id not in st_location_ids:
            continue
        job_id = job.get("id")
        if job_id is None:
            continue
        try:
            job_id_int = int(job_id)
        except (TypeError, ValueError):
            continue
        if job_id_int in seen_job_ids:
            continue
        seen_job_ids.add(job_id_int)

        for appointment in _fetch_appointments_for_job(http, job_id_int):
            if appointment_qualifies(appointment, start_ts=start_ts, end_ts=end_ts):
                matched.add(st_location_id)
                break
    return matched


def build_route_annual_schedule_snapshot(
    route_id: int,
    month_first: date,
    *,
    username: str | None = None,
    password: str | None = None,
    session: requests.Session | None = None,
) -> dict[str, object]:
    """Build per-location annual schedule flags for office run prep."""
    user = username or os.getenv("PROCESSING_USERNAME")
    pwd = password or os.getenv("PROCESSING_PASSWORD")
    if not user or not pwd:
        raise RuntimeError("Missing ServiceTrade creds. Set PROCESSING_USERNAME/PROCESSING_PASSWORD.")

    rows = _route_location_rows(route_id, month_first)
    start_ts, end_ts = month_window_pacific(month_first)

    st_location_ids = {
        int(loc.service_trade_site_location_id)
        for loc, _annual_month in rows
        if loc.service_trade_site_location_id is not None
    }

    http = session or requests.Session()
    _authenticate_service_trade(http, username=user, password=pwd)
    st_locations_with_appointments = _locations_with_qualifying_appointments(
        http,
        st_location_ids,
        start_ts=start_ts,
        end_ts=end_ts,
    )

    locations: dict[str, dict[str, object]] = {}
    warning_count = 0
    for loc, annual_month in rows:
        location_id = int(loc.id)
        annual_month_matches_run = _is_annual_for_month(month_first, annual_month)
        st_site_id = loc.service_trade_site_location_id
        has_service_trade_link = st_site_id is not None
        st_url = (
            service_trade_site_location_url(int(st_site_id))
            if st_site_id is not None
            else None
        )
        has_scheduled = (
            int(st_site_id) in st_locations_with_appointments if st_site_id is not None else False
        )
        prep_warning = derive_prep_warning(
            annual_month_matches_run=annual_month_matches_run,
            has_service_trade_link=has_service_trade_link,
            has_scheduled_annual_in_month=has_scheduled,
        )
        if prep_warning is not None:
            warning_count += 1
        snapshot = AnnualScheduleLocationSnapshot(
            location_id=location_id,
            annual_month_matches_run=annual_month_matches_run,
            has_service_trade_link=has_service_trade_link,
            service_trade_site_location_url=st_url,
            has_scheduled_annual_in_month=has_scheduled,
            prep_warning=prep_warning,
        )
        locations[str(location_id)] = snapshot.to_dict()

    checked_at = datetime.now(PACIFIC_TZ).isoformat()
    return {
        "route_id": int(route_id),
        "month_date": month_first.isoformat(),
        "checked_at": checked_at,
        "warning_count": warning_count,
        "locations": locations,
    }


_ANNUAL_SNAPSHOT_BY_ROUTE_MONTH: dict[tuple[int, str], tuple[float, dict[int, dict[str, object]]]] = {}
_ANNUAL_SNAPSHOT_TTL_SECONDS = 3600


def annual_schedule_location_rows_by_id(
    route_id: int,
    month_first: date,
) -> dict[int, dict[str, object]] | None:
    """Per-location ServiceTrade annual schedule rows; ``None`` when ST is unavailable."""
    import time

    key = (int(route_id), month_first.isoformat())
    now = time.time()
    cached = _ANNUAL_SNAPSHOT_BY_ROUTE_MONTH.get(key)
    if cached is not None and cached[0] > now:
        return cached[1]
    try:
        snapshot = build_route_annual_schedule_snapshot(route_id, month_first)
    except Exception:
        return None
    raw = snapshot.get("locations") or {}
    by_id: dict[int, dict[str, object]] = {}
    if isinstance(raw, dict):
        for loc_key, row in raw.items():
            if isinstance(row, dict):
                by_id[int(loc_key)] = row
    _ANNUAL_SNAPSHOT_BY_ROUTE_MONTH[key] = (now + _ANNUAL_SNAPSHOT_TTL_SECONDS, by_id)
    return by_id
