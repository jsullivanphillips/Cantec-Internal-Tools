"""Office prep: skip or unskip a single active library site for a route-month."""

from __future__ import annotations

from datetime import date

from app.db_models import MonthlyLocation, MonthlyLocationMonth, MonthlyRouteRun
from app.monthly.history_source import HISTORY_SOURCE_OFFICE_PREP
from app.monthly.portal_workflow import SKIP_CATEGORIES, _normalize_text
from app.monthly.rich_text_sanitize import sanitize_rich_text_comment
from app.monthly.run_workflow import run_in_office_draft_prep_phase
from app.monthly.runs import get_or_create_monthly_route_run
from app.monthly.skip_run import _build_skip_reason
from app.monthly.worksheet_locations import ensure_worksheet_stops_for_route_month, load_stop_for_patch

OFFICE_PREP_SKIP_CATEGORIES = frozenset(c for c in SKIP_CATEGORIES if c != "annual")


class PrepSiteSkipError(Exception):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def _location_is_active_for_prep_skip(loc: MonthlyLocation) -> bool:
    status = (loc.status_normalized or "active").strip().lower()
    return status == "active"


def _validate_prep_skip_input(
    skip_category: str | None,
    skip_note: str | None,
) -> tuple[str, str]:
    cat = (_normalize_text(skip_category) or "").lower()
    note = _normalize_text(skip_note) or ""
    if cat not in OFFICE_PREP_SKIP_CATEGORIES:
        raise PrepSiteSkipError("A skip category is required.", "skip_category_required")
    if not note:
        raise PrepSiteSkipError("An office job comment is required when skipping a site.", "skip_reason_required")
    return cat, note


def apply_office_prep_site_skip(
    mlm: MonthlyLocationMonth,
    *,
    skip_category: str,
    skip_note: str,
) -> None:
    office_comment = sanitize_rich_text_comment(skip_note)
    mlm.annual_test_override = False
    mlm.annual_test_override_reason = None
    mlm.test_outcome = "skipped"
    mlm.skip_category = skip_category
    mlm.skip_note = skip_note
    mlm.result_status = "skipped"
    mlm.skip_reason = _build_skip_reason(skip_category, skip_note)
    mlm.office_job_comment = office_comment
    mlm.office_attention = office_comment is not None
    mlm.history_source = HISTORY_SOURCE_OFFICE_PREP
    mlm.confirmed_no_deficiencies = False


def clear_office_prep_site_skip(mlm: MonthlyLocationMonth) -> None:
    mlm.test_outcome = None
    mlm.skip_category = None
    mlm.skip_note = None
    mlm.result_status = None
    mlm.skip_reason = None
    mlm.office_job_comment = None
    mlm.office_attention = False
    mlm.history_source = None
    mlm.confirmed_no_deficiencies = False


def _stop_is_prep_skipped(mlm: MonthlyLocationMonth) -> bool:
    outcome = (_normalize_text(mlm.test_outcome) or "").lower()
    return outcome == "skipped"


def office_manual_prep_skip_locks_st_annual_sync(mlm: MonthlyLocationMonth) -> bool:
    """True when office prep manually skipped a site (ST sync must not overwrite)."""
    return _stop_is_prep_skipped(mlm) and (mlm.history_source or "").strip() == HISTORY_SOURCE_OFFICE_PREP


def office_prep_skip_site(
    route_id: int,
    location_id: int,
    month_first: date,
    *,
    skip_category: str | None,
    skip_note: str | None,
    run: MonthlyRouteRun | None,
) -> tuple[MonthlyLocationMonth, MonthlyLocation, MonthlyRouteRun]:
    if run is not None and not run_in_office_draft_prep_phase(run):
        raise PrepSiteSkipError(
            "Sites can only be skipped during draft preparation.",
            "run_prep_locked",
        )

    cat, note = _validate_prep_skip_input(skip_category, skip_note)

    if run is None:
        run = get_or_create_monthly_route_run(
            route_id,
            month_first,
            source="office_manual",
        )
    elif not run_in_office_draft_prep_phase(run):
        raise PrepSiteSkipError(
            "Sites can only be skipped during draft preparation.",
            "run_prep_locked",
        )

    ensure_worksheet_stops_for_route_month(route_id, month_first, run)
    mlm, loc, _ts = load_stop_for_patch(route_id, location_id, month_first)
    if mlm is None or loc is None:
        raise PrepSiteSkipError("Worksheet location not found for route/month", "location_not_found")
    if mlm.test_monthly_route_id is not None and int(mlm.test_monthly_route_id) != int(route_id):
        raise PrepSiteSkipError(
            "Worksheet location does not belong to this route",
            "location_route_mismatch",
        )
    if not _location_is_active_for_prep_skip(loc):
        raise PrepSiteSkipError(
            "Only active library sites can be skipped from preparation.",
            "location_not_active",
        )
    if _stop_is_prep_skipped(mlm):
        raise PrepSiteSkipError("This site is already marked skipped.", "already_skipped")

    apply_office_prep_site_skip(mlm, skip_category=cat, skip_note=note)
    if mlm.run_id is None:
        mlm.run_id = int(run.id)
    return mlm, loc, run


def office_prep_unskip_site(
    route_id: int,
    location_id: int,
    month_first: date,
    *,
    run: MonthlyRouteRun | None,
) -> tuple[MonthlyLocationMonth, MonthlyLocation]:
    if run is not None and not run_in_office_draft_prep_phase(run):
        raise PrepSiteSkipError(
            "Sites can only be unskipped during draft preparation.",
            "run_prep_locked",
        )

    mlm, loc, _ts = load_stop_for_patch(route_id, location_id, month_first)
    if mlm is None or loc is None:
        raise PrepSiteSkipError("Worksheet location not found for route/month", "location_not_found")
    if mlm.test_monthly_route_id is not None and int(mlm.test_monthly_route_id) != int(route_id):
        raise PrepSiteSkipError(
            "Worksheet location does not belong to this route",
            "location_route_mismatch",
        )
    if not _stop_is_prep_skipped(mlm):
        raise PrepSiteSkipError("This site is not marked skipped.", "not_skipped")

    clear_office_prep_site_skip(mlm)
    return mlm, loc
