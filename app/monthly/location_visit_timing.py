"""Cached per-location-month visit duration for dashboard Location Metrics."""

from __future__ import annotations

from datetime import date, datetime, timezone

from app.db_models import MonthlyLocationVisitTimingMonth, db
from app.monthly.route_performance_breakdown import visit_minutes_by_mlm_id

REFRESH_INTERVAL_SECONDS = 1800
SYNC_STATUS_OK = "ok"
SYNC_STATUS_NO_CLOCKS = "no_clocks"
MAX_PLAUSIBLE_VISIT_MINUTES = 8 * 60


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _row_is_stale(
    row: MonthlyLocationVisitTimingMonth | None,
    mlm,
    *,
    force: bool,
) -> bool:
    if force or row is None:
        return True
    if (
        row.sync_status == SYNC_STATUS_OK
        and row.visit_minutes is not None
        and int(row.visit_minutes) > MAX_PLAUSIBLE_VISIT_MINUTES
    ):
        return True
    updated_at = row.last_updated_at
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    age_seconds = (_utc_now() - updated_at).total_seconds()
    return age_seconds > REFRESH_INTERVAL_SECONDS


def _upsert_visit_timing_rows(
    mlms: list,
    computed: dict[int, tuple[int | None, str | None]],
) -> None:
    if not mlms:
        return

    from app.monthly.worksheet_locations import _next_sqlite_bigint_id

    mlm_ids = [int(mlm.id) for mlm in mlms]
    existing = {
        int(row.monthly_location_month_id): row
        for row in MonthlyLocationVisitTimingMonth.query.filter(
            MonthlyLocationVisitTimingMonth.monthly_location_month_id.in_(mlm_ids)
        ).all()
    }
    now = _utc_now()
    next_id = _next_sqlite_bigint_id(MonthlyLocationVisitTimingMonth)

    for mlm in mlms:
        mlm_id = int(mlm.id)
        minutes, source = computed.get(mlm_id, (None, None))
        sync_status = SYNC_STATUS_OK if minutes is not None else SYNC_STATUS_NO_CLOCKS
        row = existing.get(mlm_id)
        if row is None:
            row_kwargs: dict[str, object] = {
                "monthly_location_month_id": mlm_id,
                "monthly_location_id": int(mlm.monthly_location_id),
                "month_first": mlm.month_date,
                "visit_minutes": minutes,
                "visit_time_source": source,
                "sync_status": sync_status,
                "last_updated_at": now,
            }
            if next_id is not None:
                row_kwargs["id"] = next_id
                next_id += 1
            row = MonthlyLocationVisitTimingMonth(**row_kwargs)
            db.session.add(row)
        else:
            row.monthly_location_id = int(mlm.monthly_location_id)
            row.month_first = mlm.month_date
            row.visit_minutes = minutes
            row.visit_time_source = source
            row.sync_status = sync_status
            row.last_updated_at = now


def ensure_visit_timing_for_mlms(
    mlms: list,
    *,
    force: bool = False,
) -> dict[int, int | None]:
    """
    Return visit minutes keyed by ``monthly_location_month.id``.

    Refreshes lookup rows that are missing or older than ``REFRESH_INTERVAL_SECONDS``.
    """
    if not mlms:
        return {}

    mlm_by_id = {int(mlm.id): mlm for mlm in mlms}
    existing = {
        int(row.monthly_location_month_id): row
        for row in MonthlyLocationVisitTimingMonth.query.filter(
            MonthlyLocationVisitTimingMonth.monthly_location_month_id.in_(mlm_by_id.keys())
        ).all()
    }

    stale_mlms = [
        mlm_by_id[mlm_id]
        for mlm_id in mlm_by_id
        if _row_is_stale(existing.get(mlm_id), mlm_by_id[mlm_id], force=force)
    ]
    if stale_mlms:
        computed = visit_minutes_by_mlm_id(stale_mlms)
        _upsert_visit_timing_rows(stale_mlms, computed)
        db.session.flush()
        stale_ids = [int(mlm.id) for mlm in stale_mlms]
        for row in MonthlyLocationVisitTimingMonth.query.filter(
            MonthlyLocationVisitTimingMonth.monthly_location_month_id.in_(stale_ids)
        ).all():
            existing[int(row.monthly_location_month_id)] = row

    out: dict[int, int | None] = {}
    for mlm_id in mlm_by_id:
        row = existing.get(mlm_id)
        if row is None or row.sync_status != SYNC_STATUS_OK or row.visit_minutes is None:
            out[mlm_id] = None
        elif int(row.visit_minutes) > MAX_PLAUSIBLE_VISIT_MINUTES:
            out[mlm_id] = None
        else:
            out[mlm_id] = int(row.visit_minutes)
    return out


def refresh_visit_timing_for_month_dates(
    month_dates: list[date],
    *,
    force: bool = False,
) -> int:
    """Refresh lookup rows for all MLMs in the given Pacific month-first dates."""
    from app.db_models import MonthlyLocationMonth

    if not month_dates:
        return 0

    mlms = (
        MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.month_date.in_(month_dates),
        )
        .order_by(MonthlyLocationMonth.id.asc())
        .all()
    )
    if not mlms:
        return 0

    mlm_by_id = {int(mlm.id): mlm for mlm in mlms}
    existing = {
        int(row.monthly_location_month_id): row
        for row in MonthlyLocationVisitTimingMonth.query.filter(
            MonthlyLocationVisitTimingMonth.monthly_location_month_id.in_(mlm_by_id.keys())
        ).all()
    }
    stale_mlms = [
        mlm_by_id[mlm_id]
        for mlm_id in mlm_by_id
        if _row_is_stale(existing.get(mlm_id), mlm_by_id[mlm_id], force=force)
    ]
    if not stale_mlms:
        return 0

    computed = visit_minutes_by_mlm_id(stale_mlms)
    _upsert_visit_timing_rows(stale_mlms, computed)
    db.session.commit()
    return len(stale_mlms)
