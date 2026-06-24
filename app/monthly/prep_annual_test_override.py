"""Office prep: force monthly test when ServiceTrade recommends annual skip."""

from __future__ import annotations

from datetime import date

from app.db_models import MonthlyLocation, MonthlyLocationMonth, MonthlyRouteRun
from app.monthly.portal_workflow import _normalize_text
from app.monthly.prep_site_skip import clear_office_prep_site_skip
from app.monthly.rich_text_sanitize import sanitize_rich_text_comment
from app.monthly.run_workflow import run_in_office_draft_prep_phase
from app.monthly.runs import get_or_create_monthly_route_run
from app.monthly.worksheet_locations import ensure_worksheet_stops_for_route_month, load_stop_for_patch


class PrepAnnualTestError(Exception):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def _location_is_active(loc: MonthlyLocation) -> bool:
    status = (loc.status_normalized or "active").strip().lower()
    return status == "active"


def apply_office_prep_annual_test_override(
    mlm: MonthlyLocationMonth,
    *,
    reason: str | None = None,
) -> None:
    clear_office_prep_site_skip(mlm)
    mlm.annual_test_override = True
    note = _normalize_text(reason)
    mlm.annual_test_override_reason = note
    if note:
        office_comment = sanitize_rich_text_comment(note)
        if office_comment:
            mlm.office_job_comment = office_comment
            mlm.office_attention = True


def clear_office_prep_annual_test_override(mlm: MonthlyLocationMonth) -> None:
    mlm.annual_test_override = False
    mlm.annual_test_override_reason = None


def office_prep_apply_annual_test_override(
    route_id: int,
    location_id: int,
    month_first: date,
    *,
    reason: str | None = None,
    run: MonthlyRouteRun | None,
) -> tuple[MonthlyLocationMonth, MonthlyLocation, MonthlyRouteRun]:
    if run is not None and not run_in_office_draft_prep_phase(run):
        raise PrepAnnualTestError(
            "Annual test overrides can only be set during draft preparation.",
            "run_prep_locked",
        )

    if run is None:
        run = get_or_create_monthly_route_run(
            route_id,
            month_first,
            source="office_manual",
        )
    elif not run_in_office_draft_prep_phase(run):
        raise PrepAnnualTestError(
            "Annual test overrides can only be set during draft preparation.",
            "run_prep_locked",
        )

    ensure_worksheet_stops_for_route_month(route_id, month_first, run)
    mlm, loc, _ts = load_stop_for_patch(route_id, location_id, month_first)
    if mlm is None or loc is None:
        raise PrepAnnualTestError("Worksheet location not found for route/month", "location_not_found")
    if mlm.test_monthly_route_id is not None and int(mlm.test_monthly_route_id) != int(route_id):
        raise PrepAnnualTestError(
            "Worksheet location does not belong to this route",
            "location_route_mismatch",
        )
    if not _location_is_active(loc):
        raise PrepAnnualTestError(
            "Only active library sites can be forced to test from preparation.",
            "location_not_active",
        )
    if mlm.annual_test_override:
        return mlm, loc, run

    apply_office_prep_annual_test_override(mlm, reason=reason)
    if mlm.run_id is None:
        mlm.run_id = int(run.id)
    return mlm, loc, run


def office_prep_clear_annual_test_override(
    route_id: int,
    location_id: int,
    month_first: date,
    *,
    run: MonthlyRouteRun | None,
) -> tuple[MonthlyLocationMonth, MonthlyLocation]:
    if run is not None and not run_in_office_draft_prep_phase(run):
        raise PrepAnnualTestError(
            "Annual test overrides can only be cleared during draft preparation.",
            "run_prep_locked",
        )

    mlm, loc, _ts = load_stop_for_patch(route_id, location_id, month_first)
    if mlm is None or loc is None:
        raise PrepAnnualTestError("Worksheet location not found for route/month", "location_not_found")
    if mlm.test_monthly_route_id is not None and int(mlm.test_monthly_route_id) != int(route_id):
        raise PrepAnnualTestError(
            "Worksheet location does not belong to this route",
            "location_route_mismatch",
        )
    if not mlm.annual_test_override:
        return mlm, loc

    clear_office_prep_annual_test_override(mlm)
    return mlm, loc
