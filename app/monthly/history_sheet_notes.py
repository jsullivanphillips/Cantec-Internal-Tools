"""Run-scoped testing procedures / tech notes: month snapshot vs library "current" display."""

from __future__ import annotations

from datetime import date

from sqlalchemy import func

from app.db_models import MonthlyLocation, MonthlyLocationMonth, db


def _normalize_note(value: str | None) -> str | None:
    text = (value or "").strip()
    return text or None


def latest_history_row_for_location(location_id: int) -> MonthlyLocationMonth | None:
    """Most recent ``MonthlyLocationMonth`` row by ``month_date`` (any route)."""
    return (
        MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.monthly_location_id == int(location_id),
        )
        .order_by(MonthlyLocationMonth.month_date.desc())
        .first()
    )


def is_latest_history_month_for_location(location_id: int, month_first: date) -> bool:
    """True when ``month_first`` is at or after the latest run month for ``location_id``."""
    latest = (
        db.session.query(func.max(MonthlyLocationMonth.month_date))
        .filter(MonthlyLocationMonth.monthly_location_id == int(location_id))
        .execution_options(autoflush=False)
        .scalar()
    )
    return latest is None or month_first >= latest


def sheet_notes_from_history_row(
    row: MonthlyLocationMonth | None,
) -> tuple[str | None, str | None]:
    if row is None:
        return None, None
    return _normalize_note(row.testing_procedures), _normalize_note(row.inspection_tech_notes)


def latest_run_notes_for_location(location_id: int) -> tuple[str | None, str | None]:
    """Procedures / tech notes from the most recent run month (library display)."""
    return sheet_notes_from_history_row(latest_history_row_for_location(location_id))


def mirror_location_sheet_notes_from_latest_history(loc: MonthlyLocation) -> None:
    """Copy latest-run procedures/notes onto the library location master."""
    tp, tn = latest_run_notes_for_location(int(loc.id))
    loc.testing_procedures = tp
    loc.inspection_tech_notes = tn


def mirror_master_sheet_notes_to_latest_history(loc: MonthlyLocation) -> bool:
    """After a library master edit, copy procedures/notes onto the latest run-month row."""
    latest = latest_history_row_for_location(int(loc.id))
    if latest is None:
        return False
    tp = _normalize_note(loc.testing_procedures)
    tn = _normalize_note(loc.inspection_tech_notes)
    changed = False
    if latest.testing_procedures != tp:
        latest.testing_procedures = tp
        changed = True
    if latest.inspection_tech_notes != tn:
        latest.inspection_tech_notes = tn
        changed = True
    return changed


def apply_latest_run_notes_to_location_payload(payload: dict[str, object], location_id: int) -> None:
    """Overlay library JSON with latest-run notes (read path)."""
    tp, tn = latest_run_notes_for_location(location_id)
    payload["testing_procedures"] = tp
    payload["inspection_tech_notes"] = tn
