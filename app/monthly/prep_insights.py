"""Prep-phase hints derived from the prior month run on the same route."""

from __future__ import annotations

from datetime import date

from app.db_models import MonthlyRouteRun
from app.monthly.field_submission import get_field_submission_for_run
from app.monthly.worksheet_stops import worksheet_stops_for_route_month


def _prior_month_first(month_first: date) -> date:
    y, m = month_first.year, month_first.month
    if m == 1:
        return date(y - 1, 12, 1)
    return date(y, m - 1, 1)


def _visit_order_from_submission_stops(stops: list[dict]) -> dict[int, int]:
    """Map testing_site_id -> visit sequence (1-based) by first clock-in order."""
    ranked: list[tuple[str, int]] = []
    for stop in stops:
        tid = stop.get("testing_site_id")
        if tid is None:
            continue
        clock_events = stop.get("clock_events")
        tin = None
        if isinstance(clock_events, list) and clock_events:
            ev0 = clock_events[0]
            if isinstance(ev0, dict):
                tin = (ev0.get("time_in") or "").strip() or None
        if not tin:
            tin = (stop.get("time_in") or stop.get("sheet_time_in_raw") or "").strip() or None
        if tin:
            ranked.append((tin, int(tid)))
    ranked.sort(key=lambda pair: pair[0])
    return {tid: idx + 1 for idx, (_, tid) in enumerate(ranked)}


def _visit_order_from_worksheet_stops(stops: list[dict]) -> dict[int, int]:
    """Build visit rank from lean worksheet stop rows (uses ``time_in`` when present)."""
    ranked: list[tuple[str, int]] = []
    for stop in stops:
        tid = stop.get("testing_site_id")
        if tid is None:
            continue
        tin = (stop.get("time_in") or stop.get("sheet_time_in_raw") or "").strip() or None
        if tin:
            ranked.append((tin, int(tid)))
    ranked.sort(key=lambda pair: pair[0])
    return {tid: idx + 1 for idx, (_, tid) in enumerate(ranked)}


def _prior_month_visit_context(
    route_id: int,
    month_first: date,
) -> tuple[list[dict], dict[int, int]] | None:
    """Return prior-month worksheet stops and 1-based visit rank by testing site id."""
    prior = _prior_month_first(month_first)
    prior_run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=int(route_id),
        month_date=prior,
    ).one_or_none()
    if prior_run is None:
        return None

    submission = get_field_submission_for_run(int(prior_run.id))
    if submission is not None and isinstance(submission.payload_json, dict):
        stops = submission.payload_json.get("stops")
        if isinstance(stops, list):
            visit_rank = _visit_order_from_submission_stops(stops)
            return stops, visit_rank

    stops = worksheet_stops_for_route_month(int(route_id), prior, include_portal_extras=False)
    if not stops:
        return None

    visit_rank = _visit_order_from_worksheet_stops(stops)
    return stops, visit_rank


def _out_of_order_from_visit_rank(
    stops: list[dict],
    visit_rank: dict[int, int],
) -> set[int]:
    if len(visit_rank) < 2:
        return set()
    route_ordered = sorted(
        (int(s["testing_site_id"]), int(s.get("stop_number") or 0))
        for s in stops
        if s.get("testing_site_id") is not None and int(s["testing_site_id"]) in visit_rank
    )
    route_ordered.sort(key=lambda pair: pair[1])
    route_sequence = [tid for tid, _ in route_ordered]
    actual_sequence = sorted(visit_rank.keys(), key=lambda tid: visit_rank[tid])
    if route_sequence == actual_sequence:
        return set()
    out: set[int] = set()
    route_rank = {tid: i for i, tid in enumerate(route_sequence)}
    for tid in actual_sequence:
        pos = visit_rank[tid]
        expected = route_rank.get(tid)
        if expected is None:
            continue
        if pos - 1 != expected:
            out.add(tid)
    return out


def _expected_stops_for_out_of_order(
    stops: list[dict],
    visit_rank: dict[int, int],
    out_ids: set[int],
) -> dict[int, int]:
    if not out_ids:
        return {}
    route_ordered = sorted(
        (int(s["testing_site_id"]), int(s.get("stop_number") or 0))
        for s in stops
        if s.get("testing_site_id") is not None and int(s["testing_site_id"]) in visit_rank
    )
    route_ordered.sort(key=lambda pair: pair[1])
    route_rank = {tid: idx + 1 for idx, (tid, _) in enumerate(route_ordered)}
    return {tid: route_rank[tid] for tid in out_ids if tid in route_rank}


def prior_month_prep_hints(
    route_id: int,
    month_first: date,
) -> tuple[set[int], dict[int, int], set[int]]:
    """Out-of-order site ids, expected stop numbers, and prior-month edited location ids."""
    prior = _prior_month_first(month_first)
    prior_run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=int(route_id),
        month_date=prior,
    ).one_or_none()
    prior_edit_locs: set[int] = set()
    if prior_run is not None:
        from app.monthly.run_details_review import run_details_audit_location_ids

        prior_edit_locs = run_details_audit_location_ids(int(route_id), prior, run=prior_run)

    ctx = _prior_month_visit_context(route_id, month_first)
    if ctx is None:
        return set(), {}, prior_edit_locs
    stops, visit_rank = ctx
    out_ids = _out_of_order_from_visit_rank(stops, visit_rank)
    expected = _expected_stops_for_out_of_order(stops, visit_rank, out_ids)
    return out_ids, expected, prior_edit_locs


def compute_prior_month_out_of_order_site_ids(route_id: int, month_first: date) -> set[int]:
    """Testing site ids on the current route that were visited out of route order last month."""
    out_ids, _, _ = prior_month_prep_hints(route_id, month_first)
    return out_ids


def compute_prior_month_out_of_order_expected_stops(
    route_id: int,
    month_first: date,
) -> dict[int, int]:
    """Map out-of-order testing site ids to their planned stop # on the prior month route."""
    _, expected, _ = prior_month_prep_hints(route_id, month_first)
    return expected


def prior_month_field_edit_count_by_location(route_id: int, month_first: date) -> dict[int, int]:
    """Count of audit field edits per location on the prior month run (display hint)."""
    _, _, prior_edit_locs = prior_month_prep_hints(route_id, month_first)
    return {int(lid): 1 for lid in prior_edit_locs}
