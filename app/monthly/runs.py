"""Helpers for ``MonthlyRouteRun`` row lifecycle.

Lifted out of ``app.routes.monthly_routes`` so both the worksheet handler and
the route inspection CSV importer can share a single get-or-create implementation
without circular imports.
"""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func

from app.db_models import MonthlyRouteRun, db

PACIFIC_TZ = ZoneInfo("America/Vancouver")


def _next_monthly_route_run_id() -> int:
    """SQLite test DB does not auto-generate BIGINT PK reliably; assign defensively."""
    current = db.session.query(func.coalesce(func.max(MonthlyRouteRun.id), 0)).scalar()
    return int(current or 0) + 1


def get_or_create_monthly_route_run(
    route_id: int,
    month_first: date,
    *,
    source: str = "technician_app",
    set_started_at: bool = False,
) -> MonthlyRouteRun:
    """Idempotently fetch (or create) the ``MonthlyRouteRun`` for ``(route, month)``.

    New rows get ``opened_at`` when created (run file exists). ``started_at`` is the
    **field run start** and is only set when ``set_started_at`` is true (legacy callers)
    or when the technician portal explicitly starts the run — not when staff merely opens
    the worksheet.

    On subsequent calls, leaves the existing run intact: source is not downgraded from a
    human surface to ``csv_import``. Race-safe: retry-fetch on IntegrityError.
    """
    now = datetime.now(PACIFIC_TZ)
    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id, month_date=month_first
    ).one_or_none()
    if run is not None:
        if set_started_at and run.started_at is None:
            run.started_at = now
            db.session.commit()
        return run
    run = MonthlyRouteRun(
        id=_next_monthly_route_run_id(),
        monthly_route_id=route_id,
        month_date=month_first,
        opened_at=now,
        started_at=now if set_started_at else None,
        status="open",
        source=source,
    )
    db.session.add(run)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        run = MonthlyRouteRun.query.filter_by(
            monthly_route_id=route_id, month_date=month_first
        ).one()
    return run
