"""Prep-phase hints derived from the prior month run on the same route."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date

from app.db_models import MonthlyLocation, MonthlyRouteRun
from app.monthly.worksheet_locations import worksheet_locations_for_route_month


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

    stops = worksheet_locations_for_route_month(int(route_id), prior, include_portal_extras=False)
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


def _stop_display_address(stop: dict) -> str:
    return (stop.get("display_address") or stop.get("address") or "").strip()


def _tested_after_address_for_out_of_order(
    stops: list[dict],
    visit_rank: dict[int, int],
    out_ids: set[int],
) -> dict[int, str]:
    """Map out-of-order testing site ids to the address visited immediately before last month."""
    if not out_ids:
        return {}
    rank_to_tid = {int(rank): int(tid) for tid, rank in visit_rank.items()}
    stop_by_tid = {
        int(s["testing_site_id"]): s
        for s in stops
        if s.get("testing_site_id") is not None
    }
    result: dict[int, str] = {}
    for tid in out_ids:
        pos = visit_rank.get(int(tid))
        if pos is None or pos <= 1:
            continue
        prev_tid = rank_to_tid.get(int(pos) - 1)
        if prev_tid is None:
            continue
        prev_stop = stop_by_tid.get(prev_tid)
        if prev_stop is None:
            continue
        addr = _stop_display_address(prev_stop)
        if addr:
            result[int(tid)] = addr
    return result


def _prior_month_route_testing_site_ids(route_id: int, month_first: date) -> set[int] | None:
    """Testing site ids on the prior month route worksheet, or None if no prior run."""
    prior = _prior_month_first(month_first)
    prior_run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=int(route_id),
        month_date=prior,
    ).one_or_none()
    if prior_run is None:
        return None
    stops = worksheet_locations_for_route_month(int(route_id), prior, include_portal_extras=False)
    if not stops:
        return set()
    return {
        int(s["testing_site_id"])
        for s in stops
        if s.get("testing_site_id") is not None
    }


def compute_prior_month_new_to_route_site_ids(
    route_id: int,
    month_first: date,
    current_testing_site_ids: Iterable[int],
) -> set[int]:
    """Testing site ids on the current route that were not on the prior month route."""
    prior_ids = _prior_month_route_testing_site_ids(route_id, month_first)
    if prior_ids is None:
        return set()
    return {int(tid) for tid in current_testing_site_ids if int(tid) not in prior_ids}


def prior_month_prep_hints(
    route_id: int,
    month_first: date,
    *,
    current_testing_site_ids: Iterable[int] | None = None,
) -> tuple[set[int], dict[int, str], set[int], set[int]]:
    """Out-of-order site ids, prior visit address hints, prior-month edited locations, new-to-route site ids."""
    prior = _prior_month_first(month_first)
    prior_run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=int(route_id),
        month_date=prior,
    ).one_or_none()
    prior_edit_locs: set[int] = set()
    if prior_run is not None:
        from app.monthly.run_details_review import run_details_audit_location_ids

        prior_edit_locs = run_details_audit_location_ids(int(route_id), prior, run=prior_run)

    new_to_route_ids: set[int] = set()
    if current_testing_site_ids is not None:
        new_to_route_ids = compute_prior_month_new_to_route_site_ids(
            route_id,
            month_first,
            current_testing_site_ids,
        )

    ctx = _prior_month_visit_context(route_id, month_first)
    if ctx is None:
        return set(), {}, prior_edit_locs, new_to_route_ids
    stops, visit_rank = ctx
    out_ids = _out_of_order_from_visit_rank(stops, visit_rank)
    tested_after = _tested_after_address_for_out_of_order(stops, visit_rank, out_ids)
    return out_ids, tested_after, prior_edit_locs, new_to_route_ids


def _normalize_prep_address(value: str) -> str:
    return " ".join((value or "").strip().casefold().split())


def _location_display_address(loc: MonthlyLocation) -> str:
    return _normalize_prep_address((loc.display_address or loc.address or "").strip())


def site_ids_out_of_order_resolved_by_library_order(
    route_id: int,
    month_first: date,
    ordered_location_ids: list[int],
) -> set[int]:
    """
    Out-of-order sites now placed immediately after the address they followed last month.

    When the current library order matches that visit sequence, the prep hint is resolved.
    """
    if len(ordered_location_ids) < 2:
        return set()
    ctx = _prior_month_visit_context(route_id, month_first)
    if ctx is None:
        return set()
    stops, visit_rank = ctx
    out_ids = _out_of_order_from_visit_rank(stops, visit_rank)
    if not out_ids:
        return set()
    tested_after = _tested_after_address_for_out_of_order(stops, visit_rank, out_ids)
    stop_by_tid = {
        int(s["testing_site_id"]): s
        for s in stops
        if s.get("testing_site_id") is not None
    }

    loc_rows = (
        MonthlyLocation.query.filter(
            MonthlyLocation.id.in_([int(lid) for lid in ordered_location_ids])
        ).all()
        if ordered_location_ids
        else []
    )
    loc_by_id = {int(loc.id): loc for loc in loc_rows}
    address_by_lid = {lid: _location_display_address(loc) for lid, loc in loc_by_id.items()}
    index_by_lid = {int(lid): idx for idx, lid in enumerate(ordered_location_ids)}

    resolved: set[int] = set()
    for tid in out_ids:
        after_addr = _normalize_prep_address(tested_after.get(tid, ""))
        if not after_addr:
            continue
        stop = stop_by_tid.get(int(tid))
        if stop is None:
            continue
        lid = int(stop["location_id"])
        my_idx = index_by_lid.get(lid)
        if my_idx is None or my_idx < 1:
            continue
        prev_lid = None
        for olid in ordered_location_ids:
            if address_by_lid.get(int(olid)) == after_addr:
                prev_lid = int(olid)
                break
        if prev_lid is None:
            continue
        prev_idx = index_by_lid.get(prev_lid)
        if prev_idx is not None and my_idx == prev_idx + 1:
            resolved.add(int(tid))
    return resolved


def compute_prior_month_out_of_order_site_ids(route_id: int, month_first: date) -> set[int]:
    """Testing site ids on the current route that were visited out of route order last month."""
    out_ids, _, _, _ = prior_month_prep_hints(route_id, month_first)
    return out_ids


def compute_prior_month_out_of_order_tested_after_addresses(
    route_id: int,
    month_first: date,
) -> dict[int, str]:
    """Map out-of-order testing site ids to the address visited immediately before last month."""
    _, tested_after, _, _ = prior_month_prep_hints(route_id, month_first)
    return tested_after


def prior_month_field_edit_count_by_location(route_id: int, month_first: date) -> dict[int, int]:
    """Count of audit field edits per location on the prior month run (display hint)."""
    _, _, prior_edit_locs, _ = prior_month_prep_hints(route_id, month_first)
    return {int(lid): 1 for lid in prior_edit_locs}
