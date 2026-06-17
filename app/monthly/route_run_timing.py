"""Run timing from ServiceTrade testing-job clock cache."""

from __future__ import annotations

import os
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.dialects.postgresql import insert

from app import db
from app.db_models import MonthlyRouteRunTimingMonth
from app.monthly.service_trade_route_run_timing import RouteRunTimingSyncResult
from app.monthly.visit_clock_times import (
    format_visit_clock_minutes,
    median_minutes,
)

PACIFIC = ZoneInfo("America/Vancouver")
SYNC_STATUS_OK = "ok"

SERVICE_TRADE_APP_JOB_BASE = os.getenv(
    "SERVICE_TRADE_APP_JOB_BASE",
    "https://app.servicetrade.com/job",
).rstrip("/")


def service_trade_job_url(job_id: int | None) -> str | None:
    if job_id is None:
        return None
    return f"{SERVICE_TRADE_APP_JOB_BASE}/{int(job_id)}"


def serialize_service_trade_run_job_row(
    row: MonthlyRouteRunTimingMonth | None,
) -> dict[str, object]:
    job_id = int(row.service_trade_job_id) if row and row.service_trade_job_id is not None else None
    return {
        "service_trade_job_id": job_id,
        "service_trade_job_url": service_trade_job_url(job_id),
        "sync_status": row.sync_status if row else None,
        "service_trade_job_status": row.service_trade_job_status if row else None,
        "service_trade_appointment_released": row.service_trade_appointment_released if row else None,
        "service_trade_qualifying_appointment_on": (
            row.service_trade_qualifying_appointment_on.isoformat()
            if row and row.service_trade_qualifying_appointment_on is not None
            else None
        ),
    }


def service_trade_run_job_for_month(route_id: int, month_first: date) -> dict[str, object]:
    row = MonthlyRouteRunTimingMonth.query.filter_by(
        monthly_route_id=int(route_id),
        month_first=month_first,
    ).one_or_none()
    return serialize_service_trade_run_job_row(row)


def service_trade_run_jobs_by_month_for_route(route_id: int) -> dict[str, dict[str, object]]:
    rows = (
        MonthlyRouteRunTimingMonth.query.filter_by(monthly_route_id=int(route_id))
        .order_by(MonthlyRouteRunTimingMonth.month_first.asc())
        .all()
    )
    return {row.month_first.isoformat(): serialize_service_trade_run_job_row(row) for row in rows}


def upsert_route_month_timing_row(
    *,
    monthly_route_id: int,
    month_first: date,
    result: RouteRunTimingSyncResult,
) -> None:
    """Upsert one ``monthly_route_run_timing_month`` row from a sync result."""
    now = datetime.now(timezone.utc)
    stmt = insert(MonthlyRouteRunTimingMonth).values(
        monthly_route_id=int(monthly_route_id),
        month_first=month_first,
        service_trade_job_id=result.service_trade_job_id,
        clock_in_at=result.clock_in_at,
        clock_out_at=result.clock_out_at,
        duration_minutes=result.duration_minutes,
        sync_status=result.sync_status,
        service_trade_job_status=result.service_trade_job_status,
        service_trade_appointment_released=result.service_trade_appointment_released,
        service_trade_qualifying_appointment_on=result.service_trade_qualifying_appointment_on,
        last_updated_at=now,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_monthly_route_run_timing_month_route_month",
        set_={
            "service_trade_job_id": stmt.excluded.service_trade_job_id,
            "clock_in_at": stmt.excluded.clock_in_at,
            "clock_out_at": stmt.excluded.clock_out_at,
            "duration_minutes": stmt.excluded.duration_minutes,
            "sync_status": stmt.excluded.sync_status,
            "service_trade_job_status": stmt.excluded.service_trade_job_status,
            "service_trade_appointment_released": stmt.excluded.service_trade_appointment_released,
            "service_trade_qualifying_appointment_on": stmt.excluded.service_trade_qualifying_appointment_on,
            "last_updated_at": stmt.excluded.last_updated_at,
        },
    )
    db.session.execute(stmt)


def _month_keys_to_dates(month_keys: set[str]) -> list[date]:
    return sorted(date.fromisoformat(key) for key in month_keys)


def _timing_rows_for_window(route_id: int, month_keys: set[str]) -> list[MonthlyRouteRunTimingMonth]:
    if not month_keys:
        return []
    month_dates = _month_keys_to_dates(month_keys)
    return (
        MonthlyRouteRunTimingMonth.query.filter(
            MonthlyRouteRunTimingMonth.monthly_route_id == int(route_id),
            MonthlyRouteRunTimingMonth.month_first.in_(month_dates),
            MonthlyRouteRunTimingMonth.sync_status == SYNC_STATUS_OK,
            MonthlyRouteRunTimingMonth.duration_minutes.isnot(None),
        )
        .order_by(MonthlyRouteRunTimingMonth.month_first.asc())
        .all()
    )


def route_median_run_duration_minutes(
    route_id: int,
    month_keys: set[str],
) -> tuple[int | None, int]:
    rows = _timing_rows_for_window(route_id, month_keys)
    month_durations = [int(row.duration_minutes) for row in rows if row.duration_minutes is not None]
    typical = median_minutes(month_durations)
    if typical is None:
        return None, 0
    return typical, len(month_durations)


def route_typical_end_time(
    route_id: int,
    month_keys: set[str],
) -> tuple[str | None, int]:
    rows = _timing_rows_for_window(route_id, month_keys)
    month_run_ends: list[int] = []
    for row in rows:
        if row.clock_out_at is None:
            continue
        out_pacific = row.clock_out_at.astimezone(PACIFIC)
        month_run_ends.append(out_pacific.hour * 60 + out_pacific.minute)

    typical = median_minutes(month_run_ends)
    if typical is None:
        return None, 0
    return format_visit_clock_minutes(typical), len(month_run_ends)
