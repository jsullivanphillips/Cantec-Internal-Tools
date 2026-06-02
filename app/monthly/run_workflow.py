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
)

WORKFLOW_STAGE_LABELS: dict[str, str] = {
    "draft": "Draft",
    "prepared": "Prepared",
    "field_in_progress": "Field in progress",
    "awaiting_office_review": "Awaiting office review",
    "ready_to_close": "Ready to close",
    "completed": "Completed",
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
    from app.db_models import MonthlyRouteTestHistory

    return (
        MonthlyRouteTestHistory.query.filter(
            MonthlyRouteTestHistory.test_monthly_route_id == int(route_id),
            MonthlyRouteTestHistory.month_date == month_first,
            MonthlyRouteTestHistory.billing_status == "unset",
        ).count()
    )
