"""Office skip-run: mark every library site on a route-month skipped and do-not-bill."""

from __future__ import annotations

from datetime import date, datetime

from app.db_models import MonthlyRouteRun, db
from app.monthly.run_workflow import (
    close_skipped_run_from_office,
    mark_run_prepared,
)
from app.monthly.worksheet_locations import (
    _active_library_route_locations,
    _attributed_history_for_route_month,
    ensure_worksheet_stops_for_route_month,
    load_stop_for_patch,
)
from app.monthly.runs import get_or_create_monthly_route_run

SKIP_REASON = "month_skipped"
SKIP_CATEGORY = "testing_not_required"
RUN_SOURCE = "office_skip"


class SkipRunError(Exception):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def _max_selectable_month_first(current_month_first: date) -> date:
    """Last calendar month office may act on (current Pacific month + 1)."""
    if current_month_first.month == 12:
        return date(current_month_first.year + 1, 1, 1)
    return date(current_month_first.year, current_month_first.month + 1, 1)


def _location_sort_key(loc) -> tuple[int, int]:
    order = loc.route_stop_order
    tier = 0 if order is not None else 1
    ord_ = int(order) if order is not None else int(loc.id)
    return (tier, ord_, int(loc.id))


def _apply_skipped_location_month(mlm, *, run_id: int, stop_order: int) -> None:
    mlm.session_route_stop_order = stop_order
    mlm.run_id = run_id
    mlm.test_outcome = "skipped"
    mlm.skip_category = SKIP_CATEGORY
    mlm.skip_note = None
    mlm.result_status = "skipped"
    mlm.skip_reason = SKIP_REASON
    mlm.billing_status = "do_not_bill"


def skip_route_month_run(
    route_id: int,
    month_first: date,
    *,
    username: str,
    now: datetime,
    current_month_first: date | None = None,
) -> tuple[MonthlyRouteRun, int]:
    """Create a completed office-skipped run for ``route_id`` / ``month_first``.

    Returns ``(run, locations_skipped)``. Raises :class:`SkipRunError` when blocked.
    """
    from app.routes.monthly_routes import _current_pacific_month_first, _get_monthly_route

    if _get_monthly_route(route_id) is None:
        raise SkipRunError("Route not found", "route_not_found")

    if current_month_first is None:
        current_month_first = _current_pacific_month_first()
    max_month = _max_selectable_month_first(current_month_first)
    if month_first > max_month:
        raise SkipRunError(
            "That month is not yet available for skip or upload.",
            "month_out_of_range",
        )

    existing_run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()
    if existing_run is not None:
        raise SkipRunError(
            "A run already exists for this month.",
            "run_exists",
        )

    if _attributed_history_for_route_month(route_id, month_first):
        raise SkipRunError(
            "Testing history already exists for this month.",
            "history_exists",
        )

    locs = _active_library_route_locations(route_id)
    locs_sorted = sorted(locs, key=_location_sort_key)

    run = get_or_create_monthly_route_run(
        route_id,
        month_first,
        source=RUN_SOURCE,
    )
    mark_run_prepared(run, username=username, now=now)
    run_id = int(run.id)

    ensure_worksheet_stops_for_route_month(route_id, month_first, run)

    locations_skipped = 0
    for idx, loc in enumerate(locs_sorted):
        mlm, loaded_loc, _ = load_stop_for_patch(route_id, int(loc.id), month_first)
        if mlm is None or loaded_loc is None:
            continue
        _apply_skipped_location_month(mlm, run_id=run_id, stop_order=idx)
        locations_skipped += 1

    close_skipped_run_from_office(run, username=username, now=now)
    db.session.flush()
    return run, locations_skipped
