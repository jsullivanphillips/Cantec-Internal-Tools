"""Run-scoped testing procedures / tech notes: history vs library "current" display."""

from __future__ import annotations

from datetime import date

from sqlalchemy import func

from app.db_models import MonthlyRouteLocation, MonthlyRouteTestHistory, MonthlyTestingSite, db


def _normalize_note(value: str | None) -> str | None:
    text = (value or "").strip()
    return text or None


def latest_history_row_for_location(location_id: int) -> MonthlyRouteTestHistory | None:
    """Most recent ``MonthlyRouteTestHistory`` row by ``month_date`` (any route)."""
    return (
        MonthlyRouteTestHistory.query.filter(
            MonthlyRouteTestHistory.location_id == int(location_id),
        )
        .order_by(MonthlyRouteTestHistory.month_date.desc())
        .first()
    )


def is_latest_history_month_for_location(location_id: int, month_first: date) -> bool:
    """True when ``month_first`` is at or after the latest history month for ``location_id``."""
    latest = (
        db.session.query(func.max(MonthlyRouteTestHistory.month_date))
        .filter(MonthlyRouteTestHistory.location_id == int(location_id))
        .execution_options(autoflush=False)
        .scalar()
    )
    return latest is None or month_first >= latest


def sheet_notes_from_history_row(
    row: MonthlyRouteTestHistory | None,
) -> tuple[str | None, str | None]:
    if row is None:
        return None, None
    return _normalize_note(row.testing_procedures), _normalize_note(row.inspection_tech_notes)


def latest_run_notes_for_location(location_id: int) -> tuple[str | None, str | None]:
    """Procedures / tech notes from the most recent run month (library display)."""
    return sheet_notes_from_history_row(latest_history_row_for_location(location_id))


def mirror_location_sheet_notes_from_latest_history(loc: MonthlyRouteLocation) -> None:
    """Copy latest-run procedures/notes onto legacy location + primary v2 testing site."""
    from sqlalchemy import inspect as sa_inspect

    tp, tn = latest_run_notes_for_location(int(loc.id))
    loc.testing_procedures = tp
    loc.inspection_tech_notes = tn
    if not sa_inspect(db.engine).has_table(MonthlyTestingSite.__tablename__):
        return
    site = loc.monthly_site
    if site is None:
        return
    primary = (
        MonthlyTestingSite.query.filter_by(monthly_site_id=int(site.id))
        .order_by(MonthlyTestingSite.sort_order.asc())
        .first()
    )
    if primary is not None:
        primary.testing_procedures = tp
        primary.inspection_tech_notes = tn


def apply_latest_run_notes_to_location_payload(payload: dict[str, object], location_id: int) -> None:
    """Overlay library JSON with latest-run notes (read path)."""
    tp, tn = latest_run_notes_for_location(location_id)
    payload["testing_procedures"] = tp
    payload["inspection_tech_notes"] = tn
