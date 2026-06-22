"""Technician portal workflow: clock events, test outcomes, billing, deficiencies."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import func, or_

from app.db_models import (
    MonthlyLocation,
    MonthlyLocationDeficiency,
    MonthlyLocationMonth,
    MonthlyRouteRun,
    MonthlyRouteWorksheetAuditEvent,
    MonthlyStopClockEvent,
    db,
)
from app.monthly.history_source import HISTORY_SOURCE_TECHNICIAN_PORTAL
from app.monthly.worksheet_locations import (
    WorksheetAuditEventIdAllocator,
    _cleared_outcome_fields,
    _next_sqlite_bigint_id,
    load_stop_for_patch,
    seed_location_month_fields,
)

TEST_OUTCOMES = frozenset({"all_good", "passed_with_problems", "failed", "skipped"})
BILLABLE_OUTCOMES = frozenset({"all_good", "passed_with_problems", "failed"})
SKIP_CATEGORIES = frozenset({
    "access_issues",
    "construction",
    "lack_of_time",
    "testing_not_required",
    "other",
    "annual",
})
DEFICIENCY_SEVERITIES = frozenset({"inoperable", "deficient", "suggested"})
DEFICIENCY_STATUSES = frozenset({"new", "verified", "invalid", "fixed"})
DEFICIENCY_CARD_STATUSES = frozenset({"new", "verified"})
BILLING_STATUSES = frozenset({"bill", "do_not_bill", "unset", "legacy"})

SHOP_TECH_ID = "shop_tech"
SHOP_TECH_NAME = "Shop Tech"


def _normalize_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def portal_run_is_read_only(run: MonthlyRouteRun | None) -> bool:
    if run is None:
        return False
    source = (run.source or "").strip().lower()
    if source in {"csv_import", "office_skip"}:
        return True
    return False


def is_legacy_outcome(mlm: MonthlyLocationMonth | None) -> bool:
    if mlm is None:
        return False
    if _normalize_text(mlm.test_outcome):
        return False
    return _normalize_text(mlm.result_status) is not None


def dual_write_legacy_result_fields(mlm: MonthlyLocationMonth) -> None:
    """Keep ``result_status`` aligned with ``test_outcome`` on the month row."""
    outcome = (_normalize_text(mlm.test_outcome) or "").lower()
    if outcome == "skipped":
        mlm.result_status = "skipped"
    elif outcome in {"all_good", "passed_with_problems", "failed"}:
        mlm.result_status = "tested"
        mlm.skip_reason = None
        mlm.skip_category = None
        mlm.skip_note = None


def sync_legacy_times_from_clock_events(mlm: MonthlyLocationMonth) -> None:
    """Keep sheet time columns aligned with first in / last out of clock events."""
    events = (
        MonthlyStopClockEvent.query.filter_by(monthly_location_month_id=int(mlm.id))
        .order_by(MonthlyStopClockEvent.sort_order.asc(), MonthlyStopClockEvent.id.asc())
        .all()
    )
    if not events:
        mlm.sheet_time_in_raw = None
        mlm.sheet_time_out_raw = None
        return
    mlm.sheet_time_in_raw = events[0].time_in_raw
    closed = [e for e in events if _normalize_text(e.time_out_raw)]
    mlm.sheet_time_out_raw = closed[-1].time_out_raw if closed else None


def _mlm_for_location_month(
    location_id: int,
    month_first: date,
    *,
    route_id: int | None = None,
) -> MonthlyLocationMonth | None:
    q = MonthlyLocationMonth.query.filter_by(
        monthly_location_id=int(location_id),
        month_date=month_first,
    )
    if route_id is not None:
        q = q.filter(MonthlyLocationMonth.test_monthly_route_id == int(route_id))
    return q.one_or_none()


def _prior_mlm_for_location(location_id: int, month_first: date) -> MonthlyLocationMonth | None:
    return (
        MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.monthly_location_id == int(location_id),
            MonthlyLocationMonth.month_date < month_first,
        )
        .order_by(MonthlyLocationMonth.month_date.desc())
        .first()
    )


def _ensure_mlm_for_billing(
    location_id: int,
    month_first: date,
    route_id: int,
    *,
    billing_status: str | None = None,
) -> MonthlyLocationMonth:
    mlm = _mlm_for_location_month(location_id, month_first)
    if mlm is not None:
        return mlm

    loc = db.session.get(MonthlyLocation, int(location_id))
    if loc is None:
        raise ValueError("location_not_found")

    prior = _prior_mlm_for_location(location_id, month_first)
    fields = seed_location_month_fields(
        loc,
        prior,
        route_id=route_id,
        run_id=None,
        month_first=month_first,
        existing_row=None,
    )
    if billing_status is not None:
        fields["billing_status"] = billing_status
    fields["monthly_location_id"] = int(location_id)
    mlm_kw: dict[str, object] = dict(fields)
    nid = _next_sqlite_bigint_id(MonthlyLocationMonth)
    if nid is not None:
        mlm_kw["id"] = nid
    mlm = MonthlyLocationMonth(**mlm_kw)
    db.session.add(mlm)
    db.session.flush()
    return mlm


def get_location_billing_status(location_id: int, month_first: date) -> str | None:
    mlm = _mlm_for_location_month(location_id, month_first)
    if mlm is None:
        return None
    return _normalize_text(mlm.billing_status)


def _mlm_qualifies_for_auto_do_not_bill(
    mlm: MonthlyLocationMonth,
    month_first: date,
    *,
    loc: MonthlyLocation | None = None,
) -> bool:
    """Annual skip or annual month — same gate as office run-review orange cells."""
    from app.monthly.worksheet_locations import _is_annual_for_month, _sheet_skip_reason_is_annual

    if loc is None:
        loc = MonthlyLocation.query.get(int(mlm.monthly_location_id))
    annual_month = loc.annual_month if loc is not None else None

    outcome = (_normalize_text(mlm.test_outcome) or "").lower()
    result = (_normalize_text(mlm.result_status) or "").lower()
    if outcome == "skipped" or result == "skipped":
        cat = (_normalize_text(mlm.skip_category) or "").lower()
        if cat == "annual" or _sheet_skip_reason_is_annual(mlm.skip_reason):
            return True
        from app.monthly.worksheet_locations import (
            _explicit_skip_reason_blocks_annual_month_inference,
        )

        if _explicit_skip_reason_blocks_annual_month_inference(
            skip_category=mlm.skip_category,
            skip_reason=mlm.skip_reason,
        ):
            return False
        return _is_annual_for_month(month_first, annual_month)

    return _is_annual_for_month(month_first, annual_month)


def apply_billing_defaults_for_location(
    location_id: int,
    month_first: date,
    route_id: int,
) -> None:
    """Auto-set billing on the location-month row from its test outcome."""
    mlm = _mlm_for_location_month(location_id, month_first, route_id=route_id)
    if mlm is None:
        return

    current = (_normalize_text(mlm.billing_status) or "").lower()
    if current in ("legacy", "bill", "do_not_bill"):
        return

    outcome = (_normalize_text(mlm.test_outcome) or "").lower()
    if not outcome:
        return

    if outcome in BILLABLE_OUTCOMES:
        mlm.billing_status = "bill"
        return

    if outcome == "skipped":
        loc = MonthlyLocation.query.get(int(location_id))
        if _mlm_qualifies_for_auto_do_not_bill(mlm, month_first, loc=loc):
            mlm.billing_status = "do_not_bill"
        else:
            mlm.billing_status = "unset"


def set_location_billing_status(
    location_id: int,
    month_first: date,
    route_id: int,
    *,
    billing_status: str,
) -> MonthlyLocationMonth:
    """Office processor override for location-month billing (not auto-default)."""
    status = (_normalize_text(billing_status) or "").lower()
    if status not in BILLING_STATUSES:
        raise ValueError("invalid_billing_status")
    if status == "legacy":
        raise ValueError("billing_legacy_locked")

    mlm = _mlm_for_location_month(location_id, month_first)
    if mlm is None:
        mlm = _ensure_mlm_for_billing(
            location_id,
            month_first,
            route_id,
            billing_status=status,
        )
    else:
        current = (_normalize_text(mlm.billing_status) or "").lower()
        if current == "legacy":
            raise ValueError("billing_legacy_locked")
        mlm.billing_status = status
        mlm.test_monthly_route_id = route_id
    return mlm


def find_open_clock_event_on_route(
    route_id: int,
    month_first: date,
    *,
    exclude_testing_site_id: int | None = None,
) -> tuple[MonthlyLocationMonth, MonthlyStopClockEvent] | None:
    rows = (
        MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.month_date == month_first,
            MonthlyLocationMonth.test_monthly_route_id == route_id,
        )
        .all()
    )
    for mlm in rows:
        if exclude_testing_site_id is not None and int(mlm.monthly_location_id) == int(
            exclude_testing_site_id
        ):
            continue
        open_ev = (
            MonthlyStopClockEvent.query.filter_by(monthly_location_month_id=int(mlm.id))
            .filter(MonthlyStopClockEvent.time_out_raw.is_(None))
            .order_by(MonthlyStopClockEvent.sort_order.desc(), MonthlyStopClockEvent.id.desc())
            .first()
        )
        if open_ev is not None:
            return mlm, open_ev
    return None


def serialize_clock_event(ev: MonthlyStopClockEvent) -> dict[str, object]:
    return {
        "id": int(ev.id),
        "sort_order": int(ev.sort_order),
        "time_in": ev.time_in_raw,
        "time_out": _normalize_text(ev.time_out_raw),
        "created_by_tech_id": _normalize_text(ev.created_by_tech_id),
        "created_by_tech_name": _normalize_text(ev.created_by_tech_name),
    }


def list_clock_events(mlm: MonthlyLocationMonth) -> list[dict[str, object]]:
    events = (
        MonthlyStopClockEvent.query.filter_by(monthly_location_month_id=int(mlm.id))
        .order_by(MonthlyStopClockEvent.sort_order.asc(), MonthlyStopClockEvent.id.asc())
        .all()
    )
    return [serialize_clock_event(e) for e in events]


def clock_in_stop(
    mlm: MonthlyLocationMonth,
    *,
    time_in_raw: str,
    tech_id: str | None,
    tech_name: str | None,
) -> MonthlyStopClockEvent:
    open_ev = (
        MonthlyStopClockEvent.query.filter_by(monthly_location_month_id=int(mlm.id))
        .filter(MonthlyStopClockEvent.time_out_raw.is_(None))
        .first()
    )
    if open_ev is not None:
        return open_ev

    max_sort = (
        db.session.query(func.coalesce(func.max(MonthlyStopClockEvent.sort_order), -1))
        .filter_by(monthly_location_month_id=int(mlm.id))
        .scalar()
    )
    ev_kw: dict[str, object] = {
        "monthly_location_month_id": int(mlm.id),
        "sort_order": int(max_sort or -1) + 1,
        "time_in_raw": time_in_raw.strip(),
        "time_out_raw": None,
        "created_by_tech_id": _normalize_text(tech_id),
        "created_by_tech_name": _normalize_text(tech_name),
    }
    ev_nid = _next_sqlite_bigint_id(MonthlyStopClockEvent)
    if ev_nid is not None:
        ev_kw["id"] = ev_nid
    ev = MonthlyStopClockEvent(**ev_kw)
    db.session.add(ev)
    db.session.flush()

    outcome = (_normalize_text(mlm.test_outcome) or "").lower()
    if outcome == "skipped":
        mlm.test_outcome = None
        mlm.skip_category = None
        mlm.skip_note = None
        mlm.result_status = None
        mlm.skip_reason = None

    sync_legacy_times_from_clock_events(mlm)
    return ev


def clock_out_stop(
    mlm: MonthlyLocationMonth,
    *,
    time_out_raw: str,
) -> MonthlyStopClockEvent:
    open_ev = (
        MonthlyStopClockEvent.query.filter_by(monthly_location_month_id=int(mlm.id))
        .filter(MonthlyStopClockEvent.time_out_raw.is_(None))
        .order_by(MonthlyStopClockEvent.sort_order.desc(), MonthlyStopClockEvent.id.desc())
        .first()
    )
    if open_ev is None:
        raise ValueError("no_open_clock")
    open_ev.time_out_raw = time_out_raw.strip()
    sync_legacy_times_from_clock_events(mlm)
    return open_ev


def transition_clock_between_stops(
    route_id: int,
    month_first: date,
    from_testing_site_id: int,
    to_testing_site_id: int,
    *,
    time_out_raw: str,
    time_in_raw: str,
    tech_id: str | None,
    tech_name: str | None,
) -> tuple[
    MonthlyLocationMonth,
    MonthlyLocationMonth,
    MonthlyLocation,
    MonthlyLocation,
    MonthlyLocation,
    MonthlyLocation,
]:
    """Atomically close open clock on ``from`` (if any) and clock in on ``to``.

    ``testing_site_id`` parameters are flat ``MonthlyLocation.id`` values (API compat).
    """
    if int(from_testing_site_id) == int(to_testing_site_id):
        raise ValueError("same_stop")

    conflict = find_open_clock_event_on_route(
        route_id,
        month_first,
        exclude_testing_site_id=to_testing_site_id,
    )
    if conflict is not None:
        other_mlm, _ev = conflict
        if int(other_mlm.monthly_location_id) != int(from_testing_site_id):
            raise ValueError("open_clock_in_conflict")

    from_mlm, from_loc, _ = load_stop_for_patch(route_id, from_testing_site_id, month_first)
    to_mlm, to_loc, _ = load_stop_for_patch(route_id, to_testing_site_id, month_first)
    if from_mlm is None or from_loc is None:
        raise ValueError("from_stop_not_found")
    if to_mlm is None or to_loc is None:
        raise ValueError("to_stop_not_found")

    open_on_to = (
        MonthlyStopClockEvent.query.filter_by(monthly_location_month_id=int(to_mlm.id))
        .filter(MonthlyStopClockEvent.time_out_raw.is_(None))
        .first()
    )
    if open_on_to is not None and int(from_testing_site_id) != int(to_testing_site_id):
        return from_mlm, to_mlm, from_loc, from_loc, to_loc, to_loc

    try:
        clock_out_stop(from_mlm, time_out_raw=time_out_raw)
    except ValueError as exc:
        if str(exc) != "no_open_clock":
            raise

    clock_in_stop(
        to_mlm,
        time_in_raw=time_in_raw,
        tech_id=tech_id,
        tech_name=tech_name,
    )
    return from_mlm, to_mlm, from_loc, from_loc, to_loc, to_loc


def cancel_clock_in_stop(mlm: MonthlyLocationMonth) -> None:
    """Remove the open clock-in on this stop (accidental clock-in undo)."""
    if _normalize_text(mlm.test_outcome):
        raise ValueError("visit_has_outcome")
    open_ev = (
        MonthlyStopClockEvent.query.filter_by(monthly_location_month_id=int(mlm.id))
        .filter(MonthlyStopClockEvent.time_out_raw.is_(None))
        .order_by(MonthlyStopClockEvent.sort_order.desc(), MonthlyStopClockEvent.id.desc())
        .first()
    )
    if open_ev is None:
        raise ValueError("no_open_clock")
    db.session.delete(open_ev)
    db.session.flush()
    sync_legacy_times_from_clock_events(mlm)


def _deficiency_query_for_location(location_id: int):
    return MonthlyLocationDeficiency.query.filter_by(
        monthly_location_id=int(location_id),
    )


def count_active_deficiencies(location_id: int) -> int:
    """New or Verified deficiencies visible on the portal card."""
    return (
        _deficiency_query_for_location(location_id)
        .filter(MonthlyLocationDeficiency.status.in_(tuple(DEFICIENCY_CARD_STATUSES)))
        .count()
    )


def count_new_deficiencies(location_id: int) -> int:
    return (
        _deficiency_query_for_location(location_id)
        .filter(MonthlyLocationDeficiency.status == "new")
        .count()
    )


def count_new_deficiencies_requiring_verify(location_id: int, run_id: int | None) -> int:
    """New deficiencies from before this run (or with no run stamp) must be verified before outcome."""
    q = (
        _deficiency_query_for_location(location_id)
        .filter(MonthlyLocationDeficiency.status == "new")
    )
    if run_id is not None:
        q = q.filter(
            or_(
                MonthlyLocationDeficiency.created_run_id.is_(None),
                MonthlyLocationDeficiency.created_run_id != int(run_id),
            )
        )
    return q.count()


def validate_test_outcome(
    location_id: int,
    test_outcome: str,
    *,
    confirmed_no_deficiencies: bool = False,
    run_id: int | None = None,
) -> None:
    outcome = test_outcome.strip().lower()
    if outcome not in TEST_OUTCOMES:
        raise ValueError("invalid_test_outcome")

    if outcome == "skipped":
        return

    active = count_active_deficiencies(location_id)
    new_count = count_new_deficiencies_requiring_verify(location_id, run_id)

    if outcome == "all_good":
        if active > 0:
            raise ValueError("deficiencies_block_all_good")
        return

    if outcome == "passed_with_problems":
        if active == 0:
            if not confirmed_no_deficiencies:
                raise ValueError("confirmed_no_deficiencies_required")
            return
        if new_count > 0:
            raise ValueError("unverified_deficiencies")
        return

    if outcome == "failed":
        if new_count > 0:
            raise ValueError("unverified_deficiencies")
        return


def set_test_outcome(
    mlm: MonthlyLocationMonth,
    loc: MonthlyLocation,
    route_id: int,
    month_first: date,
    *,
    test_outcome: str,
    skip_category: str | None = None,
    skip_note: str | None = None,
    confirmed_no_deficiencies: bool = False,
    run_id: int | None = None,
) -> None:
    outcome = test_outcome.strip().lower()
    if outcome not in TEST_OUTCOMES:
        raise ValueError("invalid_test_outcome")

    location_id = int(loc.id)
    validate_test_outcome(
        location_id,
        outcome,
        confirmed_no_deficiencies=confirmed_no_deficiencies,
        run_id=run_id,
    )

    mlm.test_outcome = outcome
    mlm.confirmed_no_deficiencies = bool(confirmed_no_deficiencies)

    if outcome == "skipped":
        cat = (_normalize_text(skip_category) or "").lower()
        if cat not in SKIP_CATEGORIES:
            raise ValueError("skip_category_required")
        mlm.skip_category = cat
        mlm.skip_note = _normalize_text(skip_note)
        mlm.result_status = "skipped"
        cat_note = _normalize_text(skip_note) or ""
        if cat and cat_note:
            mlm.skip_reason = f"{cat}: {cat_note}"
        elif cat:
            mlm.skip_reason = cat
        else:
            mlm.skip_reason = cat_note or "skipped"
    else:
        mlm.skip_category = None
        mlm.skip_note = None
        mlm.result_status = "tested"
        mlm.skip_reason = None

    mlm.history_source = HISTORY_SOURCE_TECHNICIAN_PORTAL

    apply_billing_defaults_for_location(location_id, month_first, route_id)


def clear_test_outcome(
    mlm: MonthlyLocationMonth,
    loc: MonthlyLocation,
    route_id: int,
    month_first: date,
) -> None:
    """Office clears portal test outcome so the stop returns to pending review."""
    mlm.test_outcome = None
    mlm.skip_category = None
    mlm.skip_note = None
    mlm.confirmed_no_deficiencies = False
    mlm.result_status = None
    mlm.skip_reason = None
    mlm.history_source = None
    apply_billing_defaults_for_location(int(loc.id), month_first, route_id)


def serialize_deficiency(d: MonthlyLocationDeficiency) -> dict[str, object]:
    return {
        "id": int(d.id),
        "monthly_location_id": int(d.monthly_location_id),
        "testing_site_id": int(d.monthly_location_id),
        "created_run_id": int(d.created_run_id) if d.created_run_id is not None else None,
        "title": d.title,
        "severity": d.severity,
        "status": d.status,
        "description": _normalize_text(d.description),
        "service_line": _normalize_text(d.service_line),
        "service_trade_deficiency_id": (
            int(d.service_trade_deficiency_id) if d.service_trade_deficiency_id is not None else None
        ),
        "verification_notes": _normalize_text(d.verification_notes),
        "reported_by_tech_id": _normalize_text(d.reported_by_tech_id),
        "reported_by_tech_name": _normalize_text(d.reported_by_tech_name),
        "last_edited_by_tech_id": _normalize_text(d.last_edited_by_tech_id),
        "last_edited_by_tech_name": _normalize_text(d.last_edited_by_tech_name),
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


def list_deficiencies_for_site(
    location_id: int,
    *,
    include_hidden: bool = False,
) -> list[dict[str, object]]:
    q = _deficiency_query_for_location(location_id)
    if not include_hidden:
        q = q.filter(MonthlyLocationDeficiency.status.in_(tuple(DEFICIENCY_CARD_STATUSES)))
    rows = q.order_by(MonthlyLocationDeficiency.created_at.asc()).all()
    return [serialize_deficiency(d) for d in rows]


def _deficiency_visible_on_run_review(
    row: MonthlyLocationDeficiency,
    run: MonthlyRouteRun | None,
) -> bool:
    """Deficiencies reported on this run, or verified during this field visit."""
    if run is None:
        return False
    status = (row.status or "").strip().lower()
    if status not in DEFICIENCY_CARD_STATUSES:
        return False
    run_id = int(run.id)
    created_run_id = int(row.created_run_id) if row.created_run_id is not None else None
    if created_run_id == run_id:
        return True
    if status != "verified":
        return False
    started_at = run.started_at
    if started_at is None:
        return False
    updated_at = row.updated_at
    if updated_at is None:
        return False
    if updated_at < started_at:
        return False
    field_ended_at = run.field_ended_at
    if field_ended_at is not None and updated_at > field_ended_at:
        return False
    return True


def list_deficiencies_for_run_review(
    location_id: int,
    run: MonthlyRouteRun | None,
) -> list[dict[str, object]]:
    """Open deficiencies tied to this field run (reported or verified on the visit)."""
    if run is None:
        return []
    return batch_deficiency_summaries_for_testing_sites([int(location_id)], run=run).get(
        int(location_id),
        [],
    )


def batch_deficiency_summaries_for_testing_sites(
    location_ids: list[int],
    *,
    run: MonthlyRouteRun | None = None,
) -> dict[int, list[dict[str, object]]]:
    """Load card-visible deficiencies for many stops in one query.

    ``location_ids`` are flat ``MonthlyLocation.id`` values (API compat alias).
    """
    if not location_ids:
        return {}
    ids = [int(i) for i in location_ids]
    rows = (
        MonthlyLocationDeficiency.query.filter(
            MonthlyLocationDeficiency.monthly_location_id.in_(ids),
            MonthlyLocationDeficiency.status.in_(tuple(DEFICIENCY_CARD_STATUSES)),
        )
        .order_by(
            MonthlyLocationDeficiency.monthly_location_id.asc(),
            MonthlyLocationDeficiency.created_at.asc(),
        )
        .all()
    )
    grouped: dict[int, list[MonthlyLocationDeficiency]] = {}
    for row in rows:
        grouped.setdefault(int(row.monthly_location_id), []).append(row)
    run_scoped = run is not None and run.started_at is not None
    out: dict[int, list[dict[str, object]]] = {}
    for loc_id in ids:
        site_rows = grouped.get(loc_id, [])
        if run_scoped:
            site_rows = [row for row in site_rows if _deficiency_visible_on_run_review(row, run)]
        out[loc_id] = [serialize_deficiency(row) for row in site_rows]
    return out


def batch_site_has_open_deficiencies(location_ids: list[int]) -> dict[int, bool]:
    """True when a stop has any card-visible deficiency (location-wide, not run-scoped)."""
    if not location_ids:
        return {}
    ids = [int(i) for i in location_ids]
    rows = (
        db.session.query(MonthlyLocationDeficiency.monthly_location_id)
        .filter(
            MonthlyLocationDeficiency.monthly_location_id.in_(ids),
            MonthlyLocationDeficiency.status.in_(tuple(DEFICIENCY_CARD_STATUSES)),
        )
        .distinct()
        .all()
    )
    open_ids = {int(r[0]) for r in rows}
    return {loc_id: loc_id in open_ids for loc_id in ids}


def create_deficiency(
    location_id: int,
    run_id: int | None,
    *,
    title: str,
    severity: str,
    status: str,
    description: str | None,
    tech_id: str | None,
    tech_name: str | None,
    service_line: str | None = None,
    service_trade_deficiency_id: int | None = None,
) -> MonthlyLocationDeficiency:
    sev = severity.strip().lower()
    st = status.strip().lower()
    if sev not in DEFICIENCY_SEVERITIES:
        raise ValueError("invalid_severity")
    if st not in DEFICIENCY_STATUSES:
        raise ValueError("invalid_status")

    def_kw: dict[str, object] = {
        "monthly_location_id": int(location_id),
        "created_run_id": int(run_id) if run_id is not None else None,
        "title": title.strip(),
        "severity": sev,
        "status": st,
        "description": _normalize_text(description),
        "service_line": _normalize_text(service_line),
        "service_trade_deficiency_id": (
            int(service_trade_deficiency_id) if service_trade_deficiency_id is not None else None
        ),
        "reported_by_tech_id": _normalize_text(tech_id),
        "reported_by_tech_name": _normalize_text(tech_name),
        "last_edited_by_tech_id": _normalize_text(tech_id),
        "last_edited_by_tech_name": _normalize_text(tech_name),
    }
    def_nid = _next_sqlite_bigint_id(MonthlyLocationDeficiency)
    if def_nid is not None:
        def_kw["id"] = def_nid
    row = MonthlyLocationDeficiency(**def_kw)
    db.session.add(row)
    db.session.flush()
    return row


def update_deficiency(
    deficiency: MonthlyLocationDeficiency,
    *,
    title: str | None = None,
    severity: str | None = None,
    status: str | None = None,
    description: str | None = None,
    tech_id: str | None = None,
    tech_name: str | None = None,
) -> MonthlyLocationDeficiency:
    if title is not None:
        deficiency.title = title.strip()
    if severity is not None:
        sev = severity.strip().lower()
        if sev not in DEFICIENCY_SEVERITIES:
            raise ValueError("invalid_severity")
        deficiency.severity = sev
    if status is not None:
        st = status.strip().lower()
        if st not in DEFICIENCY_STATUSES:
            raise ValueError("invalid_status")
        deficiency.status = st
    if description is not None:
        deficiency.description = _normalize_text(description)
    deficiency.last_edited_by_tech_id = _normalize_text(tech_id)
    deficiency.last_edited_by_tech_name = _normalize_text(tech_name)
    return deficiency


def verify_deficiency(
    deficiency: MonthlyLocationDeficiency,
    *,
    tech_id: str | None,
    tech_name: str | None,
    note: str | None = None,
) -> MonthlyLocationDeficiency:
    deficiency.status = "verified"
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    tech_label = _normalize_text(tech_name) or _normalize_text(tech_id) or "Unknown"
    line = f"Verified by {tech_label} on {stamp}"
    if _normalize_text(note):
        line = f"{line}: {note.strip()}"
    existing = _normalize_text(deficiency.verification_notes) or ""
    deficiency.verification_notes = f"{existing}\n{line}".strip() if existing else line
    deficiency.last_edited_by_tech_id = _normalize_text(tech_id)
    deficiency.last_edited_by_tech_name = _normalize_text(tech_name)
    return deficiency


def stop_has_run_changes(
    mlm: MonthlyLocationMonth,
    location_id: int,
    run_id: int | None,
) -> bool:
    if _normalize_text(mlm.test_outcome) or _normalize_text(mlm.result_status):
        return True
    if _normalize_text(mlm.run_comments):
        return True
    if MonthlyStopClockEvent.query.filter_by(monthly_location_month_id=int(mlm.id)).count() > 0:
        return True
    if run_id is not None:
        n = (
            MonthlyLocationDeficiency.query.filter_by(
                monthly_location_id=int(location_id),
                created_run_id=int(run_id),
            ).count()
        )
        if n > 0:
            return True
    return False


def reset_stop_on_run(
    route_id: int,
    month_first: date,
    mlm: MonthlyLocationMonth,
    loc: MonthlyLocation,
    run: MonthlyRouteRun | None,
) -> None:
    run_id = int(run.id) if run is not None else None

    MonthlyStopClockEvent.query.filter_by(
        monthly_location_month_id=int(mlm.id),
    ).delete(synchronize_session=False)

    if run_id is not None:
        MonthlyLocationDeficiency.query.filter_by(
            monthly_location_id=int(loc.id),
            created_run_id=run_id,
        ).delete(synchronize_session=False)

    prior = _prior_mlm_for_location(int(loc.id), month_first)
    fresh = seed_location_month_fields(
        loc,
        prior,
        route_id=route_id,
        run_id=run_id,
        month_first=month_first,
        existing_row=None,
    )
    for key, val in fresh.items():
        if key in ("month_date", "monthly_location_id"):
            continue
        setattr(mlm, key, val)

    for key, val in _cleared_outcome_fields().items():
        setattr(mlm, key, val)
    sync_legacy_times_from_clock_events(mlm)

    audit_ids = WorksheetAuditEventIdAllocator()
    db.session.add(
        MonthlyRouteWorksheetAuditEvent(
            **audit_ids.id_kwargs(),
            monthly_route_id=route_id,
            location_id=int(loc.id),
            location_month_row_id=int(mlm.id),
            month_date=month_first,
            field_name="stop_reset",
            old_value=None,
            new_value={"location_id": int(loc.id)},
            source="technician_app",
        )
    )


def portal_workflow_extras_for_stop(
    mlm: MonthlyLocationMonth | None,
    loc: MonthlyLocation,
    *,
    route_id: int,
    month_first: date,
    run: MonthlyRouteRun | None,
) -> dict[str, Any]:
    """Fields appended to ``serialize_worksheet_stop`` payload."""
    billing_status = get_location_billing_status(int(loc.id), month_first)
    if mlm is None:
        return {
            "clock_events": [],
            "deficiencies": list_deficiencies_for_site(int(loc.id)),
            "has_run_changes": False,
            "billing_status": billing_status,
            "is_legacy_outcome": False,
            "portal_read_only": portal_run_is_read_only(run),
            "is_legacy_run": portal_run_is_read_only(run),
        }

    return {
        "clock_events": list_clock_events(mlm),
        "deficiencies": list_deficiencies_for_site(int(loc.id)),
        "has_run_changes": stop_has_run_changes(
            mlm,
            int(loc.id),
            int(run.id) if run is not None else None,
        ),
        "billing_status": billing_status,
        "is_legacy_outcome": is_legacy_outcome(mlm),
        "portal_read_only": portal_run_is_read_only(run),
        "is_legacy_run": portal_run_is_read_only(run),
    }
