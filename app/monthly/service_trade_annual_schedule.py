"""ServiceTrade annual inspection schedule checks for office run preparation."""

from __future__ import annotations

import os
import logging
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

import requests

from app.db_models import MonthlyLocation, MonthlyLocationMonth, MonthlyRoute, db
from app.monthly.route_test_day import effective_route_test_day
from app.monthly.service_trade_site_match import (
    SERVICE_TRADE_API_BASE,
    service_trade_site_location_url,
)
from app.monthly.worksheet_locations import (
    _resolve_worksheet_route_locations,
    _worksheet_location_pairs_for_route_month,
)

PACIFIC_TZ = ZoneInfo("America/Vancouver")

logger = logging.getLogger(__name__)

# Coalesce parallel paperwork requests (run_details + annual_schedule_check + worksheet).
_paperwork_st_sync_lock = threading.Lock()
_paperwork_st_sync_recent: dict[tuple[int, str], float] = {}
PAPERWORK_ST_SYNC_DEDUP_SECONDS = 15.0

QUALIFYING_JOB_TYPES = frozenset({"inspection", "replacement", "upgrade", "installation"})

_CANCELLED_STATUSES = frozenset({"cancelled", "canceled", "void", "deleted"})

_QUALIFYING_APPOINTMENT_STATUSES = frozenset({"scheduled", "completed"})

_LOCATION_ID_CHUNK_SIZE = 50

PrepWarning = str | None


@dataclass(frozen=True)
class AnnualScheduleLocationSnapshot:
    location_id: int
    has_service_trade_link: bool
    service_trade_site_location_url: str | None
    has_scheduled_annual_in_month: bool
    annual_spans_months: bool
    annual_skip_recommended: bool
    annual_test_recommended: bool
    spanning_job_id: int | None
    prep_warning: PrepWarning

    def to_dict(self) -> dict[str, object]:
        return {
            "location_id": self.location_id,
            "has_service_trade_link": self.has_service_trade_link,
            "service_trade_site_location_url": self.service_trade_site_location_url,
            "has_scheduled_annual_in_month": self.has_scheduled_annual_in_month,
            "annual_spans_months": self.annual_spans_months,
            "annual_skip_recommended": self.annual_skip_recommended,
            "annual_test_recommended": self.annual_test_recommended,
            "spanning_job_id": self.spanning_job_id,
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


def _add_month_first(month_first: date, delta_months: int) -> date:
    year = month_first.year
    month = month_first.month + delta_months
    while month > 12:
        year += 1
        month -= 12
    while month < 1:
        year -= 1
        month += 12
    return date(year, month, 1)


def _pacific_ts_range_for_month_firsts(
    start_month: date,
    end_month_inclusive: date,
) -> tuple[int, int]:
    start_ts, _ = month_window_pacific(start_month)
    end_exclusive = _add_month_first(end_month_inclusive, 1)
    end_ts = int(
        datetime(
            end_exclusive.year,
            end_exclusive.month,
            end_exclusive.day,
            tzinfo=PACIFIC_TZ,
        ).timestamp()
    )
    return start_ts, end_ts


def _month_long_name_pacific(month_first: date) -> str:
    return month_first.strftime("%B")


def _skip_month_from_spanned(
    spanned: list[date],
    *,
    appointment_dates: tuple[date, ...],
    weekday_iso: int,
    week_occurrence: int,
) -> date:
    if len(spanned) == 1:
        return spanned[0]
    skip_month, _ = _skip_month_for_spanning_job(
        spanned,
        weekday_iso=weekday_iso,
        week_occurrence=week_occurrence,
        appointment_dates=appointment_dates,
    )
    return skip_month


def _pick_saved_annual_month(
    skip_months: list[date],
    *,
    current_month: date,
) -> str | None:
    if not skip_months:
        return None
    in_window = sorted(set(skip_months))
    upcoming = [month for month in in_window if month >= current_month]
    pick = min(upcoming) if upcoming else max(in_window)
    return _month_long_name_pacific(pick)


def sync_saved_annual_month_for_location(
    loc: MonthlyLocation,
    *,
    username: str | None = None,
    password: str | None = None,
    session: requests.Session | None = None,
    look_back_months: int = 11,
    look_ahead_months: int = 12,
) -> dict[str, object]:
    """Live ServiceTrade lookup for the library location hero annual month."""
    st_site_id = loc.service_trade_site_location_id
    if st_site_id is None:
        return {
            "location_id": int(loc.id),
            "has_service_trade_link": False,
            "saved_annual_month": None,
            "synced_at": None,
        }

    route = loc.monthly_route
    if route is None and loc.monthly_route_id is not None:
        route = MonthlyRoute.query.get(int(loc.monthly_route_id))
    weekday_iso = int(route.weekday_iso) if route and route.weekday_iso is not None else 0
    week_occurrence = int(route.week_occurrence) if route and route.week_occurrence is not None else 1

    today = datetime.now(PACIFIC_TZ).date()
    current_month = date(today.year, today.month, 1)
    window_start = _add_month_first(current_month, -look_back_months)
    window_end = _add_month_first(current_month, look_ahead_months - 1)
    start_ts, end_ts = _pacific_ts_range_for_month_firsts(window_start, window_end)

    user = username or os.getenv("PROCESSING_USERNAME")
    pwd = password or os.getenv("PROCESSING_PASSWORD")
    if not user or not pwd:
        raise RuntimeError("Missing ServiceTrade creds. Set PROCESSING_USERNAME/PROCESSING_PASSWORD.")

    http = session or requests.Session()
    own_session = session is None
    try:
        if own_session:
            _authenticate_service_trade(http, username=user, password=pwd)
        jobs = _fetch_jobs_for_location_chunk(
            http,
            [int(st_site_id)],
            start_ts=start_ts,
            end_ts=end_ts,
        )
        skip_month_candidates: list[date] = []
        seen_job_ids: set[int] = set()
        for job in jobs:
            if not job_qualifies(job):
                continue
            job_id = _job_id_int(job)
            if job_id is None or job_id in seen_job_ids:
                continue
            seen_job_ids.add(job_id)
            all_appointments = _fetch_appointments_for_job(http, job_id)
            appt_dates: list[date] = []
            for appointment in all_appointments:
                day = _appointment_pacific_date(appointment)
                if day is not None:
                    appt_dates.append(day)
            if not appt_dates:
                continue
            spanned = _distinct_month_firsts(appt_dates)
            if not spanned:
                continue
            skip_month = _skip_month_from_spanned(
                spanned,
                appointment_dates=tuple(appt_dates),
                weekday_iso=weekday_iso,
                week_occurrence=week_occurrence,
            )
            if window_start <= skip_month <= window_end:
                skip_month_candidates.append(skip_month)

        synced_at = datetime.now(PACIFIC_TZ).isoformat()
        return {
            "location_id": int(loc.id),
            "has_service_trade_link": True,
            "saved_annual_month": _pick_saved_annual_month(
                skip_month_candidates,
                current_month=current_month,
            ),
            "synced_at": synced_at,
        }
    finally:
        if own_session:
            http.close()


def month_first_from_pacific_ts(ts: int) -> date:
    dt = datetime.fromtimestamp(int(ts), tz=PACIFIC_TZ)
    return date(dt.year, dt.month, 1)


def job_qualifies(job: dict[str, Any]) -> bool:
    status = (str(job.get("status") or "")).strip().lower()
    if status in _CANCELLED_STATUSES:
        return False
    job_type = (str(job.get("type") or "")).strip().lower()
    return job_type in QUALIFYING_JOB_TYPES


def appointment_qualifies(
    appointment: dict[str, Any],
    *,
    start_ts: int | None = None,
    end_ts: int | None = None,
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
    if start_ts is not None and end_ts is not None:
        return start_ts <= ts < end_ts
    return True


def _appointment_pacific_date(appointment: dict[str, Any]) -> date | None:
    if not appointment_qualifies(appointment):
        return None
    window_start = appointment.get("windowStart")
    if window_start is None:
        return None
    try:
        ts = int(window_start)
    except (TypeError, ValueError):
        return None
    dt = datetime.fromtimestamp(ts, tz=PACIFIC_TZ)
    return date(dt.year, dt.month, dt.day)


def derive_prep_warning(
    *,
    has_service_trade_link: bool,
    has_scheduled_annual_in_month: bool,
    annual_spans_months: bool,
    annual_skip_tie: bool,
) -> PrepWarning:
    if not has_service_trade_link and has_scheduled_annual_in_month:
        return "no_servicetrade_link"
    if annual_skip_tie:
        return "annual_skip_tie"
    if annual_spans_months:
        return "annual_spans_months"
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


def _job_id_int(job: dict[str, Any]) -> int | None:
    job_id = job.get("id")
    if job_id is None:
        return None
    try:
        return int(job_id)
    except (TypeError, ValueError):
        return None


def _route_location_rows(route_id: int, month_first: date) -> list[MonthlyLocation]:
    return _resolve_worksheet_route_locations(route_id, month_first)


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
                # ServiceTrade ignores completed inspections when using scheduleDateFrom/To
                # without status; scheduledDate + scheduled/completed matches appointment data.
                "scheduledDateFrom": start_ts,
                "scheduledDateTo": end_ts,
                "status": "scheduled,completed",
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


@dataclass(frozen=True)
class _JobAnnualContext:
    job_id: int
    st_location_id: int
    appointment_dates: tuple[date, ...]
    spanned_month_firsts: tuple[date, ...]
    has_in_target_month: bool


def _distinct_month_firsts(dates: list[date]) -> list[date]:
    seen: set[tuple[int, int]] = set()
    out: list[date] = []
    for day in sorted(dates):
        key = (day.year, day.month)
        if key in seen:
            continue
        seen.add(key)
        out.append(date(day.year, day.month, 1))
    return out


def _route_test_day_distance(
    month_first: date,
    *,
    weekday_iso: int,
    week_occurrence: int,
    appointment_dates: tuple[date, ...],
) -> int | None:
    test_day = effective_route_test_day(
        month_first,
        weekday_iso=weekday_iso,
        week_occurrence=week_occurrence,
    )
    if test_day is None or not appointment_dates:
        return None
    return min(abs((test_day - appt).days) for appt in appointment_dates)


def _skip_month_for_spanning_job(
    spanned_month_firsts: list[date],
    *,
    weekday_iso: int,
    week_occurrence: int,
    appointment_dates: tuple[date, ...],
) -> tuple[date, bool]:
    """Return ``(skip_month_first, is_tie)`` for a spanning annual job."""
    if not spanned_month_firsts:
        raise ValueError("spanned_month_firsts required")

    distances: list[tuple[date, int | None]] = [
        (
            month_first,
            _route_test_day_distance(
                month_first,
                weekday_iso=weekday_iso,
                week_occurrence=week_occurrence,
                appointment_dates=appointment_dates,
            ),
        )
        for month_first in spanned_month_firsts
    ]

    valid = [(m, d) for m, d in distances if d is not None]
    if not valid:
        return min(spanned_month_firsts), False

    min_dist = min(d for _, d in valid)
    closest = [m for m, d in valid if d == min_dist]
    if len(closest) > 1:
        return min(closest), True
    return closest[0], False


def _build_job_contexts_for_month(
    http: requests.Session,
    jobs: list[dict[str, Any]],
    *,
    st_location_ids: set[int],
    month_first: date,
    start_ts: int,
    end_ts: int,
) -> dict[int, list[_JobAnnualContext]]:
    """Map ST location id → job annual contexts touching ``month_first``."""
    by_location: dict[int, list[_JobAnnualContext]] = {sid: [] for sid in st_location_ids}
    seen_job_ids: set[int] = set()

    for job in jobs:
        if not job_qualifies(job):
            continue
        st_location_id = _job_location_id(job)
        if st_location_id is None or st_location_id not in st_location_ids:
            continue
        job_id = _job_id_int(job)
        if job_id is None or job_id in seen_job_ids:
            continue

        has_in_month = False
        for appointment in job.get("_appointments") or []:
            if appointment_qualifies(appointment, start_ts=start_ts, end_ts=end_ts):
                has_in_month = True
                break
        if not has_in_month:
            continue

        seen_job_ids.add(job_id)
        all_appointments = _fetch_appointments_for_job(http, job_id)
        appt_dates: list[date] = []
        for appointment in all_appointments:
            day = _appointment_pacific_date(appointment)
            if day is not None:
                appt_dates.append(day)
        if not appt_dates:
            continue

        spanned = _distinct_month_firsts(appt_dates)
        touches_target = any(m == month_first for m in spanned)
        if not touches_target:
            continue

        ctx = _JobAnnualContext(
            job_id=job_id,
            st_location_id=int(st_location_id),
            appointment_dates=tuple(appt_dates),
            spanned_month_firsts=tuple(spanned),
            has_in_target_month=any(
                appointment_qualifies(a, start_ts=start_ts, end_ts=end_ts)
                for a in all_appointments
            ),
        )
        by_location[int(st_location_id)].append(ctx)

    return by_location


def _location_flags_from_contexts(
    contexts: list[_JobAnnualContext],
    month_first: date,
    *,
    weekday_iso: int,
    week_occurrence: int,
) -> tuple[bool, bool, bool, bool, int | None, bool]:
    """Return flags for one location in ``month_first``."""
    if not contexts:
        return False, False, False, False, None, False

    has_scheduled = any(ctx.has_in_target_month for ctx in contexts)
    spanning = [ctx for ctx in contexts if len(ctx.spanned_month_firsts) >= 2]
    primary = spanning[0] if spanning else contexts[0]

    if len(primary.spanned_month_firsts) < 2:
        return (
            has_scheduled,
            False,
            has_scheduled,
            False,
            primary.job_id if has_scheduled else None,
            False,
        )

    skip_month, is_tie = _skip_month_for_spanning_job(
        list(primary.spanned_month_firsts),
        weekday_iso=weekday_iso,
        week_occurrence=week_occurrence,
        appointment_dates=primary.appointment_dates,
    )
    skip_recommended = month_first == skip_month
    test_recommended = has_scheduled and not skip_recommended
    return (
        has_scheduled,
        True,
        skip_recommended,
        test_recommended,
        primary.job_id,
        is_tie,
    )


def _service_trade_credentials(
    *,
    username: str | None = None,
    password: str | None = None,
) -> tuple[str, str]:
    user = username or os.getenv("PROCESSING_USERNAME")
    pwd = password or os.getenv("PROCESSING_PASSWORD")
    if not user or not pwd:
        raise RuntimeError("Missing ServiceTrade creds. Set PROCESSING_USERNAME/PROCESSING_PASSWORD.")
    return user, pwd


def _route_schedule_params(route_id: int) -> tuple[int, int]:
    route = MonthlyRoute.query.get(int(route_id))
    if route is None:
        raise ValueError(f"Route {route_id} not found")
    weekday_iso = int(route.weekday_iso) if route.weekday_iso is not None else 0
    week_occurrence = int(route.week_occurrence) if route.week_occurrence is not None else 1
    return weekday_iso, week_occurrence


def _location_annual_schedule_row(
    loc: MonthlyLocation,
    month_first: date,
    *,
    weekday_iso: int,
    week_occurrence: int,
    contexts: list[_JobAnnualContext],
) -> dict[str, object]:
    location_id = int(loc.id)
    st_site_id = loc.service_trade_site_location_id
    has_service_trade_link = st_site_id is not None
    st_url = (
        service_trade_site_location_url(int(st_site_id))
        if st_site_id is not None
        else None
    )
    (
        has_scheduled,
        spans_months,
        skip_recommended,
        test_recommended,
        spanning_job_id,
        skip_tie,
    ) = _location_flags_from_contexts(
        contexts,
        month_first,
        weekday_iso=weekday_iso,
        week_occurrence=week_occurrence,
    )
    prep_warning = derive_prep_warning(
        has_service_trade_link=has_service_trade_link,
        has_scheduled_annual_in_month=has_scheduled,
        annual_spans_months=spans_months,
        annual_skip_tie=skip_tie,
    )
    return AnnualScheduleLocationSnapshot(
        location_id=location_id,
        has_service_trade_link=has_service_trade_link,
        service_trade_site_location_url=st_url,
        has_scheduled_annual_in_month=has_scheduled,
        annual_spans_months=spans_months,
        annual_skip_recommended=skip_recommended,
        annual_test_recommended=test_recommended,
        spanning_job_id=spanning_job_id,
        prep_warning=prep_warning,
    ).to_dict()


def build_location_annual_schedule_row(
    loc: MonthlyLocation,
    month_first: date,
    *,
    weekday_iso: int,
    week_occurrence: int,
    http: requests.Session | None = None,
    username: str | None = None,
    password: str | None = None,
) -> dict[str, object]:
    """Build annual schedule flags for one library location (one ServiceTrade site when linked)."""
    st_site_id = loc.service_trade_site_location_id
    if st_site_id is None:
        return _location_annual_schedule_row(
            loc,
            month_first,
            weekday_iso=weekday_iso,
            week_occurrence=week_occurrence,
            contexts=[],
        )

    start_ts, end_ts = month_window_pacific(month_first)
    own_session = http is None
    if own_session:
        user, pwd = _service_trade_credentials(username=username, password=password)
        http = requests.Session()
        _authenticate_service_trade(http, username=user, password=pwd)

    try:
        jobs = _fetch_jobs_for_location_chunk(
            http,
            [int(st_site_id)],
            start_ts=start_ts,
            end_ts=end_ts,
        )
        for job in jobs:
            job_id = _job_id_int(job)
            if job_id is not None:
                job["_appointments"] = _fetch_appointments_for_job(http, job_id)

        contexts_by_st_id = _build_job_contexts_for_month(
            http,
            jobs,
            st_location_ids={int(st_site_id)},
            month_first=month_first,
            start_ts=start_ts,
            end_ts=end_ts,
        )
        contexts = contexts_by_st_id.get(int(st_site_id), [])
        return _location_annual_schedule_row(
            loc,
            month_first,
            weekday_iso=weekday_iso,
            week_occurrence=week_occurrence,
            contexts=contexts,
        )
    finally:
        if own_session and http is not None:
            http.close()


def build_route_annual_schedule_snapshot(
    route_id: int,
    month_first: date,
    *,
    username: str | None = None,
    password: str | None = None,
    session: requests.Session | None = None,
) -> dict[str, object]:
    """Build per-location annual schedule flags for office run prep."""
    weekday_iso, week_occurrence = _route_schedule_params(route_id)
    locs = _route_location_rows(route_id, month_first)

    st_location_ids = {
        int(loc.service_trade_site_location_id)
        for loc in locs
        if loc.service_trade_site_location_id is not None
    }

    http = session
    own_session = http is None
    if own_session and st_location_ids:
        user, pwd = _service_trade_credentials(username=username, password=password)
        http = requests.Session()
        _authenticate_service_trade(http, username=user, password=pwd)

    locations: dict[str, dict[str, object]] = {}
    warning_count = 0
    try:
        for loc in locs:
            row = build_location_annual_schedule_row(
                loc,
                month_first,
                weekday_iso=weekday_iso,
                week_occurrence=week_occurrence,
                http=http,
                username=username,
                password=password,
            )
            locations[str(int(loc.id))] = row
            if row.get("prep_warning"):
                warning_count += 1
    finally:
        if own_session and http is not None:
            http.close()

    checked_at = datetime.now(PACIFIC_TZ).isoformat()
    return {
        "route_id": int(route_id),
        "month_date": month_first.isoformat(),
        "checked_at": checked_at,
        "warning_count": warning_count,
        "locations": locations,
    }


def _snapshot_row_to_mlm_cache(row: dict[str, object], synced_at: datetime) -> dict[str, object]:
    prep_warning = row.get("prep_warning")
    spanning_job_id = row.get("spanning_job_id")
    return {
        "st_annual_skip_recommended": bool(row.get("annual_skip_recommended")),
        "st_annual_test_recommended": bool(row.get("annual_test_recommended")),
        "st_annual_spans_months": bool(row.get("annual_spans_months")),
        "st_has_scheduled_annual_in_month": bool(row.get("has_scheduled_annual_in_month")),
        "st_annual_prep_warning": (
            str(prep_warning).strip() if prep_warning not in (None, "") else None
        ),
        "st_spanning_job_id": int(spanning_job_id) if spanning_job_id is not None else None,
        "st_annual_synced_at": synced_at,
    }


def mlm_st_annual_sync_locked(mlm: MonthlyLocationMonth) -> bool:
    """Office manual test/skip decisions that ServiceTrade sync must not overwrite."""
    if mlm.annual_test_override:
        return True
    from app.monthly.prep_site_skip import office_manual_prep_skip_locks_st_annual_sync

    return office_manual_prep_skip_locks_st_annual_sync(mlm)


def persist_route_annual_schedule_snapshot(
    route_id: int,
    month_first: date,
    snapshot: dict[str, object],
) -> None:
    """Write ServiceTrade annual schedule flags onto ``monthly_location_month`` rows."""
    from app.monthly.runs import get_or_create_monthly_route_run
    from app.monthly.worksheet_locations import ensure_worksheet_stops_for_route_month

    run = get_or_create_monthly_route_run(
        route_id,
        month_first,
        source="office_manual",
    )
    ensure_worksheet_stops_for_route_month(route_id, month_first, run)

    raw = snapshot.get("locations") or {}
    if not isinstance(raw, dict) or not raw:
        return

    location_ids = [int(loc_key) for loc_key in raw.keys()]
    rows = {
        int(r.monthly_location_id): r
        for r in MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.month_date == month_first,
            MonthlyLocationMonth.monthly_location_id.in_(location_ids),
        ).all()
    }

    checked_at_raw = snapshot.get("checked_at")
    if isinstance(checked_at_raw, str) and checked_at_raw.strip():
        try:
            synced_at = datetime.fromisoformat(checked_at_raw.strip())
        except ValueError:
            synced_at = datetime.now(PACIFIC_TZ)
    else:
        synced_at = datetime.now(PACIFIC_TZ)

    for loc_key, row in raw.items():
        if not isinstance(row, dict):
            continue
        location_id = int(loc_key)
        mlm = rows.get(location_id)
        if mlm is None:
            continue
        if mlm_st_annual_sync_locked(mlm):
            continue
        cache_fields = _snapshot_row_to_mlm_cache(row, synced_at)
        for attr, value in cache_fields.items():
            setattr(mlm, attr, value)
        if mlm.test_monthly_route_id is None:
            mlm.test_monthly_route_id = int(route_id)
        if mlm.run_id is None:
            mlm.run_id = int(run.id)
    db.session.commit()


def _ensure_route_month_mlm(
    route_id: int,
    month_first: date,
    location_id: int,
) -> tuple[MonthlyLocationMonth, MonthlyRouteRun]:
    from app.monthly.runs import get_or_create_monthly_route_run
    from app.monthly.worksheet_locations import ensure_worksheet_stops_for_route_month

    run = get_or_create_monthly_route_run(
        route_id,
        month_first,
        source="office_manual",
    )
    ensure_worksheet_stops_for_route_month(route_id, month_first, run)
    mlm = MonthlyLocationMonth.query.filter_by(
        monthly_location_id=int(location_id),
        month_date=month_first,
    ).one_or_none()
    if mlm is None:
        raise ValueError(f"No worksheet row for location {location_id}")
    return mlm, run


def persist_location_annual_schedule_row(
    route_id: int,
    month_first: date,
    location_id: int,
    row: dict[str, object],
    *,
    synced_at: datetime | None = None,
) -> None:
    """Write ServiceTrade annual schedule flags for one ``monthly_location_month`` row."""
    mlm, run = _ensure_route_month_mlm(route_id, month_first, location_id)
    if mlm_st_annual_sync_locked(mlm):
        return
    when = synced_at or datetime.now(PACIFIC_TZ)
    cache_fields = _snapshot_row_to_mlm_cache(row, when)
    for attr, value in cache_fields.items():
        setattr(mlm, attr, value)
    if mlm.test_monthly_route_id is None:
        mlm.test_monthly_route_id = int(route_id)
    if mlm.run_id is None:
        mlm.run_id = int(run.id)
    db.session.commit()


def annual_schedule_sync_progress(
    route_id: int,
    month_first: date,
) -> dict[str, object]:
    """Counts and pending location ids for incremental ServiceTrade annual sync."""
    pairs = _worksheet_location_pairs_for_route_month(route_id, month_first)
    pending: list[int] = []
    synced = 0
    for mlm, loc in pairs:
        lid = int(loc.id)
        if mlm is not None and mlm_st_annual_sync_locked(mlm):
            synced += 1
            continue
        if mlm is None or mlm.st_annual_synced_at is None:
            pending.append(lid)
        else:
            synced += 1
    total = len(pairs)
    return {
        "total": total,
        "synced": synced,
        "pending_location_ids": pending,
        "complete": len(pending) == 0,
    }


def sync_location_annual_schedule(
    route_id: int,
    month_first: date,
    location_id: int,
    *,
    force: bool = False,
) -> dict[str, object]:
    """Live ServiceTrade sync for one route stop; persist and return the location row."""
    locs = _resolve_worksheet_route_locations(route_id, month_first)
    loc_by_id = {int(loc.id): loc for loc in locs}
    loc = loc_by_id.get(int(location_id))
    if loc is None:
        raise ValueError(f"Location {location_id} not on route {route_id}")

    mlm, _run = _ensure_route_month_mlm(route_id, month_first, location_id)
    if mlm_st_annual_sync_locked(mlm):
        row = annual_schedule_row_from_mlm(mlm, loc)
        if row is not None:
            return row
        weekday_iso, week_occurrence = _route_schedule_params(route_id)
        return _location_annual_schedule_row(
            loc,
            month_first,
            weekday_iso=weekday_iso,
            week_occurrence=week_occurrence,
            contexts=[],
        )

    if not force and mlm.st_annual_synced_at is not None:
        row = annual_schedule_row_from_mlm(mlm, loc)
        if row is not None:
            return row

    weekday_iso, week_occurrence = _route_schedule_params(route_id)
    row = build_location_annual_schedule_row(
        loc,
        month_first,
        weekday_iso=weekday_iso,
        week_occurrence=week_occurrence,
    )
    synced_at = datetime.now(PACIFIC_TZ)
    persist_location_annual_schedule_row(
        route_id,
        month_first,
        location_id,
        row,
        synced_at=synced_at,
    )
    db.session.refresh(mlm)
    cached = annual_schedule_row_from_mlm(mlm, loc)
    return cached if cached is not None else row


def route_annual_schedule_has_db_cache(route_id: int, month_first: date) -> bool:
    """True when every worksheet stop for the route/month has persisted ST annual flags."""
    progress = annual_schedule_sync_progress(route_id, month_first)
    return bool(progress.get("complete"))


def build_route_annual_schedule_payload_from_db(
    route_id: int,
    month_first: date,
    *,
    include_sync_progress: bool = True,
) -> dict[str, object]:
    """Build annual schedule check JSON from cached ``monthly_location_month`` columns."""
    pairs = _worksheet_location_pairs_for_route_month(route_id, month_first)
    locations: dict[str, dict[str, object]] = {}
    warning_count = 0
    latest_synced_at: datetime | None = None
    for mlm, loc in pairs:
        if mlm is None:
            continue
        row = annual_schedule_row_from_mlm(mlm, loc)
        if row is None:
            continue
        locations[str(int(loc.id))] = row
        if row.get("prep_warning"):
            warning_count += 1
        synced_at = mlm.st_annual_synced_at
        if synced_at is not None and (
            latest_synced_at is None or synced_at > latest_synced_at
        ):
            latest_synced_at = synced_at
    checked_at = (
        latest_synced_at.astimezone(PACIFIC_TZ).isoformat()
        if latest_synced_at is not None
        else datetime.now(PACIFIC_TZ).isoformat()
    )
    payload: dict[str, object] = {
        "route_id": int(route_id),
        "month_date": month_first.isoformat(),
        "checked_at": checked_at,
        "warning_count": warning_count,
        "locations": locations,
    }
    if include_sync_progress:
        payload["sync_progress"] = annual_schedule_sync_progress(route_id, month_first)
    return payload


def sync_route_annual_schedule(route_id: int, month_first: date) -> dict[str, object]:
    """Live ServiceTrade sync, persist to DB (respecting manual locks), return DB payload."""
    snapshot = build_route_annual_schedule_snapshot(route_id, month_first)
    persist_route_annual_schedule_snapshot(route_id, month_first, snapshot)
    return build_route_annual_schedule_payload_from_db(route_id, month_first)


def sync_route_annual_schedule_for_paperwork_view(
    route_id: int,
    month_first: date,
    *,
    force: bool = False,
) -> bool:
    """Best-effort live ST sync when office or portal paperwork is opened."""
    key = (int(route_id), month_first.isoformat())
    now = time.monotonic()
    if not force:
        with _paperwork_st_sync_lock:
            last = _paperwork_st_sync_recent.get(key)
            if last is not None and (now - last) < PAPERWORK_ST_SYNC_DEDUP_SECONDS:
                return False
            _paperwork_st_sync_recent[key] = now
    else:
        with _paperwork_st_sync_lock:
            _paperwork_st_sync_recent[key] = now

    try:
        sync_route_annual_schedule(route_id, month_first)
        return True
    except Exception as exc:
        logger.warning(
            "ServiceTrade annual sync on paperwork view failed for route %s month %s: %s",
            route_id,
            month_first.isoformat(),
            exc,
        )
        with _paperwork_st_sync_lock:
            _paperwork_st_sync_recent.pop(key, None)
        return False


def annual_schedule_row_from_mlm(
    mlm: MonthlyLocationMonth,
    loc: MonthlyLocation,
) -> dict[str, object] | None:
    """Rebuild API schedule row shape from cached MLM columns."""
    if mlm.st_annual_synced_at is None:
        return None
    st_site_id = loc.service_trade_site_location_id
    has_service_trade_link = st_site_id is not None
    st_url = (
        service_trade_site_location_url(int(st_site_id))
        if st_site_id is not None
        else None
    )
    return {
        "location_id": int(mlm.monthly_location_id),
        "has_service_trade_link": has_service_trade_link,
        "service_trade_site_location_url": st_url,
        "has_scheduled_annual_in_month": bool(mlm.st_has_scheduled_annual_in_month),
        "annual_spans_months": bool(mlm.st_annual_spans_months),
        "annual_skip_recommended": bool(mlm.st_annual_skip_recommended),
        "annual_test_recommended": bool(mlm.st_annual_test_recommended),
        "spanning_job_id": mlm.st_spanning_job_id,
        "prep_warning": mlm.st_annual_prep_warning,
    }


def annual_schedule_location_rows_from_db(
    route_id: int,
    month_first: date,
) -> dict[int, dict[str, object]] | None:
    """Read cached ServiceTrade annual schedule rows for a route/month."""
    pairs = _worksheet_location_pairs_for_route_month(route_id, month_first)
    if not pairs:
        return None
    by_id: dict[int, dict[str, object]] = {}
    for mlm, loc in pairs:
        if mlm is None:
            continue
        row = annual_schedule_row_from_mlm(mlm, loc)
        if row is not None:
            by_id[int(loc.id)] = row
    return by_id


def annual_schedule_location_rows_by_id(
    route_id: int,
    month_first: date,
) -> dict[int, dict[str, object]] | None:
    """Per-location cached ServiceTrade annual schedule rows from the database."""
    return annual_schedule_location_rows_from_db(route_id, month_first)


def location_annual_skip_recommended(
    schedule_row: dict[str, object] | None,
    *,
    annual_test_override: bool = False,
) -> bool:
    if annual_test_override:
        return False
    if schedule_row is None:
        return False
    return bool(schedule_row.get("annual_skip_recommended"))
