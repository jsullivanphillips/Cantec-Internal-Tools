"""Monthly route run workflow: stages, serialization, and edit gates."""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.db_models import MonthlyRouteRun

WORKFLOW_STAGES = (
    "draft",
    "prepared",
    "field_in_progress",
    "awaiting_office_review",
    "ready_to_close",
    "completed",
    "skipped",
)

WORKFLOW_STAGE_LABELS: dict[str, str] = {
    "draft": "Draft",
    "prepared": "Prepared",
    "field_in_progress": "Field in progress",
    "awaiting_office_review": "Awaiting office review",
    "ready_to_close": "Ready to close",
    "completed": "Completed",
    "skipped": "Skipped",
}


def run_explicitly_completed(run: MonthlyRouteRun | None) -> bool:
    if run is None:
        return False
    if run.completed_at is not None:
        return True
    st = (run.status or "").strip().lower()
    return st in {"completed", "closed"}


def derive_run_workflow_stage(run: MonthlyRouteRun | None) -> str:
    if run is None:
        return "draft"
    if run_explicitly_completed(run):
        if (run.source or "").strip().lower() == "office_skip":
            return "skipped"
        return "completed"
    if run.office_review_completed_at is not None:
        return "ready_to_close"
    if run.field_ended_at is not None:
        return "awaiting_office_review"
    if run.started_at is not None:
        return "field_in_progress"
    if run.prepared_at is not None:
        return "prepared"
    return "draft"


def workflow_stage_label(stage: str) -> str:
    return WORKFLOW_STAGE_LABELS.get(stage, stage.replace("_", " ").title())


def run_is_prepared(run: MonthlyRouteRun | None) -> bool:
    return run is not None and run.prepared_at is not None


def run_field_in_progress(run: MonthlyRouteRun | None) -> bool:
    if run is None or run_explicitly_completed(run):
        return False
    return run.started_at is not None and run.field_ended_at is None


def run_field_ended(run: MonthlyRouteRun | None) -> bool:
    return run is not None and run.field_ended_at is not None


def run_in_office_prep_phase(run: MonthlyRouteRun | None) -> bool:
    """Draft or prepared — office prep edits before technicians start field work."""
    if run is not None and run_explicitly_completed(run):
        return False
    if run is not None and run.started_at is not None:
        return False
    return True


def portal_may_edit_run(run: MonthlyRouteRun | None) -> bool:
    """Portal stop/clock/deficiency edits while field work is active."""
    if run is None or run_explicitly_completed(run):
        return False
    return run.started_at is not None and run.field_ended_at is None


def office_may_edit_outcomes(run: MonthlyRouteRun | None) -> bool:
    """Office tested/skipped outcome edits after field hands off."""
    if run is None or run_explicitly_completed(run):
        return False
    return run.field_ended_at is not None


def office_may_edit_billing(run: MonthlyRouteRun | None) -> bool:
    return office_may_edit_outcomes(run)


def office_may_complete_run(run: MonthlyRouteRun | None) -> bool:
    if run is None or run_explicitly_completed(run):
        return False
    return run.office_review_completed_at is not None


def _iso(dt) -> str | None:
    if dt is None:
        return None
    return dt.isoformat()


def serialize_run_workflow_fields(run: MonthlyRouteRun) -> dict[str, object]:
    stage = derive_run_workflow_stage(run)
    return {
        "workflow_stage": stage,
        "workflow_stage_label": workflow_stage_label(stage),
        "prepared_at": _iso(run.prepared_at),
        "prepared_by": (run.prepared_by or "").strip() or None,
        "field_ended_at": _iso(run.field_ended_at),
        "office_review_completed_at": _iso(run.office_review_completed_at),
        "office_review_completed_by": (run.office_review_completed_by or "").strip() or None,
    }


def mark_run_prepared(run: MonthlyRouteRun, *, username: str, now) -> None:
    if run.prepared_at is None:
        run.prepared_at = now
        run.prepared_by = username


def office_may_unprepare_run(run: MonthlyRouteRun | None) -> bool:
    """Office may return a prepared run to prep before technicians start field work."""
    if run is None or run_explicitly_completed(run):
        return False
    if run.prepared_at is None:
        return False
    return run.started_at is None


def clear_run_prepared(run: MonthlyRouteRun) -> None:
    run.prepared_at = None
    run.prepared_by = None


def mark_field_ended(run: MonthlyRouteRun, *, now) -> None:
    if run.field_ended_at is None:
        run.field_ended_at = now


def clear_field_ended(run: MonthlyRouteRun) -> None:
    run.field_ended_at = None
    run.office_review_completed_at = None
    run.office_review_completed_by = None


def mark_office_review_complete(run: MonthlyRouteRun, *, username: str, now) -> None:
    if run.office_review_completed_at is None:
        run.office_review_completed_at = now
        run.office_review_completed_by = username


def clear_office_review_complete(run: MonthlyRouteRun) -> None:
    run.office_review_completed_at = None
    run.office_review_completed_by = None


def clear_office_completion(run: MonthlyRouteRun) -> None:
    run.status = "open"
    run.completed_at = None
    clear_office_review_complete(run)


def clear_workflow_on_reset(run: MonthlyRouteRun) -> None:
    """Reset field phase; keep prepared_at so office need not re-prepare."""
    run.started_at = None
    run.field_ended_at = None
    clear_office_review_complete(run)


def count_unset_billing_for_route_month(route_id: int, month_first: date) -> int:
    from app.db_models import MonthlyLocationMonth
    from app.monthly.worksheet_locations import office_review_billing_location_ids

    location_ids = office_review_billing_location_ids(route_id, month_first)
    if not location_ids:
        return 0

    rows = MonthlyLocationMonth.query.filter(
        MonthlyLocationMonth.test_monthly_route_id == int(route_id),
        MonthlyLocationMonth.month_date == month_first,
        MonthlyLocationMonth.monthly_location_id.in_(location_ids),
    ).all()
    unset = 0
    for row in rows:
        status = (row.billing_status or "").strip().lower()
        if status in ("", "unset"):
            unset += 1
    return unset


def prepare_billing_for_office_review_complete(route_id: int, month_first: date) -> None:
    """Apply outcome-based billing defaults before the review-complete gate."""
    from app.db_models import MonthlyLocationMonth
    from app.monthly.portal_workflow import BILLABLE_OUTCOMES, apply_billing_defaults_for_location
    from app.monthly.worksheet_locations import office_review_billing_location_ids

    location_ids = office_review_billing_location_ids(route_id, month_first)
    if not location_ids:
        return

    rows = MonthlyLocationMonth.query.filter(
        MonthlyLocationMonth.test_monthly_route_id == int(route_id),
        MonthlyLocationMonth.month_date == month_first,
        MonthlyLocationMonth.monthly_location_id.in_(location_ids),
    ).all()
    for row in rows:
        location_id = int(row.monthly_location_id)
        apply_billing_defaults_for_location(location_id, month_first, route_id)
        status = (row.billing_status or "").strip().lower()
        if status in ("bill", "do_not_bill", "legacy"):
            continue
        outcome = (row.test_outcome or "").strip().lower()
        result = (row.result_status or "").strip().lower()
        if outcome == "skipped" or result == "skipped":
            row.billing_status = "do_not_bill"
        elif outcome in BILLABLE_OUTCOMES or result == "tested":
            row.billing_status = "bill"


def is_historical_run_month(
    month_first: date,
    *,
    current_month_first: date | None = None,
) -> bool:
    """True when ``month_first`` is strictly before the Pacific calendar current month."""
    if current_month_first is None:
        from app.routes.monthly_routes import _current_pacific_month_first

        current_month_first = _current_pacific_month_first()
    return month_first < current_month_first


def should_auto_close_run_from_csv_import(
    month_first: date,
    *,
    current_month_first: date | None = None,
) -> bool:
    """True when a successful CSV import should mark paperwork completed.

    Current and prior months auto-close — the sheet represents finished field
    results. Future months stay at prepared so office can still prep live runs.
    """
    if current_month_first is None:
        from app.routes.monthly_routes import _current_pacific_month_first

        current_month_first = _current_pacific_month_first()
    return month_first <= current_month_first


def close_historical_run_from_csv_import(
    run: MonthlyRouteRun,
    *,
    username: str,
    now,
) -> None:
    """Mark paperwork closed after importing a prior-month technician CSV."""
    if run.started_at is None:
        run.started_at = now
    mark_field_ended(run, now=now)
    mark_office_review_complete(run, username=username, now=now)
    run.status = "completed"
    run.completed_at = now


def close_skipped_run_from_office(
    run: MonthlyRouteRun,
    *,
    username: str,
    now,
) -> None:
    """Mark a route-month closed after office bulk-skips every library site."""
    if run.started_at is None:
        run.started_at = now
    mark_field_ended(run, now=now)
    mark_office_review_complete(run, username=username, now=now)
    run.status = "completed"
    run.completed_at = now


def office_future_month_prep_blocked_reason(
    route_id: int,
    month_first: date,
) -> tuple[str, str] | None:
    """Block office prep for a future calendar month until the current month run is closed.

    Returns ``(message, code)`` when blocked, else ``None``.
    """
    from app.db_models import MonthlyRouteRun
    from app.routes.monthly_routes import _current_pacific_month_first

    current_month = _current_pacific_month_first()
    if month_first <= current_month:
        return None

    current_run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=int(route_id),
        month_date=current_month,
    ).one_or_none()
    if run_explicitly_completed(current_run):
        return None

    return (
        "Close the current month's paperwork before preparing a future month.",
        "current_month_not_closed",
    )
