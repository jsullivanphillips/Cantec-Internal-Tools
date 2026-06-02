"""Technician portal workflow: clock events, test outcomes, billing, deficiencies."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import func, or_

from app.db_models import (
    MonthlyRouteLocation,
    MonthlyRouteRun,
    MonthlyRouteTestHistory,
    MonthlyRouteWorksheetAuditEvent,
    MonthlySite,
    MonthlyStopClockEvent,
    MonthlyTestingSite,
    MonthlyTestingSiteDeficiency,
    MonthlyTestingSiteMonth,
    db,
)
from app.monthly.worksheet_stops import (
    WorksheetAuditEventIdAllocator,
    _next_sqlite_bigint_id,
    is_primary_stop,
    load_stop_for_patch,
    seed_stop_month_fields,
    sync_primary_history_from_stop,
)

TEST_OUTCOMES = frozenset({"all_good", "passed_with_problems", "failed", "skipped"})
BILLABLE_OUTCOMES = frozenset({"all_good", "passed_with_problems", "failed"})
SKIP_CATEGORIES = frozenset({
    "access_issues",
    "construction",
    "lack_of_time",
    "testing_not_required",
    "other",
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
    if source == "csv_import":
        return True
    return False


def is_legacy_outcome(mtsm: MonthlyTestingSiteMonth | None) -> bool:
    if mtsm is None:
        return False
    if _normalize_text(mtsm.test_outcome):
        return False
    return _normalize_text(mtsm.result_status) is not None


def dual_write_legacy_result_fields(mtsm: MonthlyTestingSiteMonth) -> None:
    """Mirror ``test_outcome`` onto legacy ``result_status`` / ``skip_reason``."""
    outcome = (_normalize_text(mtsm.test_outcome) or "").lower()
    if not outcome:
        return
    if outcome == "skipped":
        mtsm.result_status = "skipped"
        cat = _normalize_text(mtsm.skip_category) or ""
        note = _normalize_text(mtsm.skip_note) or ""
        if cat and note:
            mtsm.skip_reason = f"{cat}: {note}"
        elif cat:
            mtsm.skip_reason = cat
        else:
            mtsm.skip_reason = note or "skipped"
    else:
        mtsm.result_status = "tested"
        if outcome != "skipped":
            mtsm.skip_reason = None


def sync_legacy_times_from_clock_events(mtsm: MonthlyTestingSiteMonth) -> None:
    """Keep sheet time columns aligned with first in / last out of clock events."""
    events = (
        MonthlyStopClockEvent.query.filter_by(monthly_testing_site_month_id=int(mtsm.id))
        .order_by(MonthlyStopClockEvent.sort_order.asc(), MonthlyStopClockEvent.id.asc())
        .all()
    )
    if not events:
        mtsm.sheet_time_in_raw = None
        mtsm.sheet_time_out_raw = None
        return
    mtsm.sheet_time_in_raw = events[0].time_in_raw
    closed = [e for e in events if _normalize_text(e.time_out_raw)]
    mtsm.sheet_time_out_raw = closed[-1].time_out_raw if closed else None


def _testing_site_ids_for_location(loc: MonthlyRouteLocation) -> list[int]:
    site = (
        MonthlySite.query.filter_by(legacy_monthly_route_location_id=int(loc.id))
        .one_or_none()
    )
    if site is None:
        return []
    rows = (
        MonthlyTestingSite.query.filter_by(monthly_site_id=int(site.id))
        .order_by(MonthlyTestingSite.sort_order.asc(), MonthlyTestingSite.id.asc())
        .all()
    )
    return [int(r.id) for r in rows]


def _location_history(
    location_id: int,
    month_first: date,
) -> MonthlyRouteTestHistory | None:
    return (
        MonthlyRouteTestHistory.query.filter_by(
            location_id=int(location_id),
            month_date=month_first,
        )
        .one_or_none()
    )


def get_location_billing_status(location_id: int, month_first: date) -> str | None:
    hist = _location_history(location_id, month_first)
    if hist is None:
        return None
    return _normalize_text(hist.billing_status)


def apply_billing_defaults_for_location(
    location_id: int,
    month_first: date,
    route_id: int,
) -> None:
    """Auto-set billing: bill if any stop has a billable outcome; unset if all outcomes are skip."""
    hist = _location_history(location_id, month_first)
    if hist is None:
        hist_kw: dict[str, object] = {
            "location_id": int(location_id),
            "month_date": month_first,
            "test_monthly_route_id": route_id,
            "billing_status": "unset",
        }
        nid = _next_sqlite_bigint_id(MonthlyRouteTestHistory)
        if nid is not None:
            hist_kw["id"] = nid
        hist = MonthlyRouteTestHistory(**hist_kw)
        db.session.add(hist)
        db.session.flush()

    current = (_normalize_text(hist.billing_status) or "").lower()
    if current == "legacy":
        return

    loc = db.session.get(MonthlyRouteLocation, int(location_id))
    if loc is None:
        return
    ts_ids = _testing_site_ids_for_location(loc)
    if not ts_ids:
        return

    rows = (
        MonthlyTestingSiteMonth.query.filter(
            MonthlyTestingSiteMonth.monthly_testing_site_id.in_(ts_ids),
            MonthlyTestingSiteMonth.month_date == month_first,
            MonthlyTestingSiteMonth.test_monthly_route_id == route_id,
        )
        .all()
    )
    outcomes = [
        (_normalize_text(r.test_outcome) or "").lower()
        for r in rows
        if _normalize_text(r.test_outcome)
    ]
    if not outcomes:
        return

    if any(o in BILLABLE_OUTCOMES for o in outcomes):
        hist.billing_status = "bill"
        return

    if all(o == "skipped" for o in outcomes):
        hist.billing_status = "unset"


def set_location_billing_status(
    location_id: int,
    month_first: date,
    route_id: int,
    *,
    billing_status: str,
) -> MonthlyRouteTestHistory:
    """Office processor override for location-month billing (not auto-default)."""
    status = (_normalize_text(billing_status) or "").lower()
    if status not in BILLING_STATUSES:
        raise ValueError("invalid_billing_status")
    if status == "legacy":
        raise ValueError("billing_legacy_locked")

    hist = _location_history(location_id, month_first)
    if hist is None:
        hist_kw: dict[str, object] = {
            "location_id": int(location_id),
            "month_date": month_first,
            "test_monthly_route_id": route_id,
            "billing_status": status,
        }
        nid = _next_sqlite_bigint_id(MonthlyRouteTestHistory)
        if nid is not None:
            hist_kw["id"] = nid
        hist = MonthlyRouteTestHistory(**hist_kw)
        db.session.add(hist)
        db.session.flush()
    else:
        current = (_normalize_text(hist.billing_status) or "").lower()
        if current == "legacy":
            raise ValueError("billing_legacy_locked")
        hist.billing_status = status
        hist.test_monthly_route_id = route_id
    return hist


def find_open_clock_event_on_route(
    route_id: int,
    month_first: date,
    *,
    exclude_testing_site_id: int | None = None,
) -> tuple[MonthlyTestingSiteMonth, MonthlyStopClockEvent] | None:
    rows = (
        MonthlyTestingSiteMonth.query.filter(
            MonthlyTestingSiteMonth.month_date == month_first,
            MonthlyTestingSiteMonth.test_monthly_route_id == route_id,
        )
        .all()
    )
    for mtsm in rows:
        if exclude_testing_site_id is not None and int(mtsm.monthly_testing_site_id) == int(
            exclude_testing_site_id
        ):
            continue
        open_ev = (
            MonthlyStopClockEvent.query.filter_by(monthly_testing_site_month_id=int(mtsm.id))
            .filter(MonthlyStopClockEvent.time_out_raw.is_(None))
            .order_by(MonthlyStopClockEvent.sort_order.desc(), MonthlyStopClockEvent.id.desc())
            .first()
        )
        if open_ev is not None:
            return mtsm, open_ev
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


def list_clock_events(mtsm: MonthlyTestingSiteMonth) -> list[dict[str, object]]:
    events = (
        MonthlyStopClockEvent.query.filter_by(monthly_testing_site_month_id=int(mtsm.id))
        .order_by(MonthlyStopClockEvent.sort_order.asc(), MonthlyStopClockEvent.id.asc())
        .all()
    )
    return [serialize_clock_event(e) for e in events]


def clock_in_stop(
    mtsm: MonthlyTestingSiteMonth,
    *,
    time_in_raw: str,
    tech_id: str | None,
    tech_name: str | None,
) -> MonthlyStopClockEvent:
    open_ev = (
        MonthlyStopClockEvent.query.filter_by(monthly_testing_site_month_id=int(mtsm.id))
        .filter(MonthlyStopClockEvent.time_out_raw.is_(None))
        .first()
    )
    if open_ev is not None:
        return open_ev

    max_sort = (
        db.session.query(func.coalesce(func.max(MonthlyStopClockEvent.sort_order), -1))
        .filter_by(monthly_testing_site_month_id=int(mtsm.id))
        .scalar()
    )
    ev_kw: dict[str, object] = {
        "monthly_testing_site_month_id": int(mtsm.id),
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

    outcome = (_normalize_text(mtsm.test_outcome) or "").lower()
    if outcome == "skipped":
        mtsm.test_outcome = None
        mtsm.skip_category = None
        mtsm.skip_note = None
        mtsm.result_status = None
        mtsm.skip_reason = None

    sync_legacy_times_from_clock_events(mtsm)
    return ev


def clock_out_stop(
    mtsm: MonthlyTestingSiteMonth,
    *,
    time_out_raw: str,
) -> MonthlyStopClockEvent:
    open_ev = (
        MonthlyStopClockEvent.query.filter_by(monthly_testing_site_month_id=int(mtsm.id))
        .filter(MonthlyStopClockEvent.time_out_raw.is_(None))
        .order_by(MonthlyStopClockEvent.sort_order.desc(), MonthlyStopClockEvent.id.desc())
        .first()
    )
    if open_ev is None:
        raise ValueError("no_open_clock")
    open_ev.time_out_raw = time_out_raw.strip()
    sync_legacy_times_from_clock_events(mtsm)
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
    MonthlyTestingSiteMonth,
    MonthlyTestingSiteMonth,
    MonthlyTestingSite,
    MonthlyRouteLocation,
    MonthlyTestingSite,
    MonthlyRouteLocation,
]:
    """Atomically close open clock on ``from`` (if any) and clock in on ``to``."""
    if int(from_testing_site_id) == int(to_testing_site_id):
        raise ValueError("same_stop")

    conflict = find_open_clock_event_on_route(
        route_id,
        month_first,
        exclude_testing_site_id=to_testing_site_id,
    )
    if conflict is not None:
        other_mtsm, _ev = conflict
        if int(other_mtsm.monthly_testing_site_id) != int(from_testing_site_id):
            raise ValueError("open_clock_in_conflict")

    from_mtsm, from_ts, from_loc = load_stop_for_patch(
        route_id, from_testing_site_id, month_first
    )
    to_mtsm, to_ts, to_loc = load_stop_for_patch(route_id, to_testing_site_id, month_first)
    if from_mtsm is None or from_ts is None or from_loc is None:
        raise ValueError("from_stop_not_found")
    if to_mtsm is None or to_ts is None or to_loc is None:
        raise ValueError("to_stop_not_found")

    open_on_to = (
        MonthlyStopClockEvent.query.filter_by(monthly_testing_site_month_id=int(to_mtsm.id))
        .filter(MonthlyStopClockEvent.time_out_raw.is_(None))
        .first()
    )
    if open_on_to is not None and int(from_testing_site_id) != int(to_testing_site_id):
        return from_mtsm, to_mtsm, from_ts, from_loc, to_ts, to_loc

    try:
        clock_out_stop(from_mtsm, time_out_raw=time_out_raw)
    except ValueError as exc:
        if str(exc) != "no_open_clock":
            raise

    clock_in_stop(
        to_mtsm,
        time_in_raw=time_in_raw,
        tech_id=tech_id,
        tech_name=tech_name,
    )
    return from_mtsm, to_mtsm, from_ts, from_loc, to_ts, to_loc


def cancel_clock_in_stop(mtsm: MonthlyTestingSiteMonth) -> None:
    """Remove the open clock-in on this stop (accidental clock-in undo)."""
    if _normalize_text(mtsm.test_outcome):
        raise ValueError("visit_has_outcome")
    open_ev = (
        MonthlyStopClockEvent.query.filter_by(monthly_testing_site_month_id=int(mtsm.id))
        .filter(MonthlyStopClockEvent.time_out_raw.is_(None))
        .order_by(MonthlyStopClockEvent.sort_order.desc(), MonthlyStopClockEvent.id.desc())
        .first()
    )
    if open_ev is None:
        raise ValueError("no_open_clock")
    db.session.delete(open_ev)
    db.session.flush()
    sync_legacy_times_from_clock_events(mtsm)


def _deficiency_query_for_site(testing_site_id: int):
    return MonthlyTestingSiteDeficiency.query.filter_by(
        monthly_testing_site_id=int(testing_site_id),
    )


def count_active_deficiencies(testing_site_id: int) -> int:
    """New or Verified deficiencies visible on the portal card."""
    return (
        _deficiency_query_for_site(testing_site_id)
        .filter(MonthlyTestingSiteDeficiency.status.in_(tuple(DEFICIENCY_CARD_STATUSES)))
        .count()
    )


def count_new_deficiencies(testing_site_id: int) -> int:
    return (
        _deficiency_query_for_site(testing_site_id)
        .filter(MonthlyTestingSiteDeficiency.status == "new")
        .count()
    )


def count_new_deficiencies_requiring_verify(testing_site_id: int, run_id: int | None) -> int:
    """New deficiencies from before this run (or with no run stamp) must be verified before outcome."""
    q = (
        _deficiency_query_for_site(testing_site_id)
        .filter(MonthlyTestingSiteDeficiency.status == "new")
    )
    if run_id is not None:
        q = q.filter(
            or_(
                MonthlyTestingSiteDeficiency.created_run_id.is_(None),
                MonthlyTestingSiteDeficiency.created_run_id != int(run_id),
            )
        )
    return q.count()


def validate_test_outcome(
    testing_site_id: int,
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

    active = count_active_deficiencies(testing_site_id)
    new_count = count_new_deficiencies_requiring_verify(testing_site_id, run_id)

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
    mtsm: MonthlyTestingSiteMonth,
    loc: MonthlyRouteLocation,
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

    testing_site_id = int(mtsm.monthly_testing_site_id)
    validate_test_outcome(
        testing_site_id,
        outcome,
        confirmed_no_deficiencies=confirmed_no_deficiencies,
        run_id=run_id,
    )

    mtsm.test_outcome = outcome
    mtsm.confirmed_no_deficiencies = bool(confirmed_no_deficiencies)

    if outcome == "skipped":
        cat = (_normalize_text(skip_category) or "").lower()
        if cat not in SKIP_CATEGORIES:
            raise ValueError("skip_category_required")
        mtsm.skip_category = cat
        mtsm.skip_note = _normalize_text(skip_note)
    else:
        mtsm.skip_category = None
        mtsm.skip_note = None

    dual_write_legacy_result_fields(mtsm)
    apply_billing_defaults_for_location(int(loc.id), month_first, route_id)


def clear_test_outcome(
    mtsm: MonthlyTestingSiteMonth,
    loc: MonthlyRouteLocation,
    route_id: int,
    month_first: date,
) -> None:
    """Office clears portal test outcome so the stop returns to pending review."""
    mtsm.test_outcome = None
    mtsm.skip_category = None
    mtsm.skip_note = None
    mtsm.confirmed_no_deficiencies = False
    mtsm.result_status = None
    mtsm.skip_reason = None
    apply_billing_defaults_for_location(int(loc.id), month_first, route_id)


def serialize_deficiency(d: MonthlyTestingSiteDeficiency) -> dict[str, object]:
    return {
        "id": int(d.id),
        "monthly_testing_site_id": int(d.monthly_testing_site_id),
        "created_run_id": int(d.created_run_id) if d.created_run_id is not None else None,
        "title": d.title,
        "severity": d.severity,
        "status": d.status,
        "description": _normalize_text(d.description),
        "verification_notes": _normalize_text(d.verification_notes),
        "reported_by_tech_id": _normalize_text(d.reported_by_tech_id),
        "reported_by_tech_name": _normalize_text(d.reported_by_tech_name),
        "last_edited_by_tech_id": _normalize_text(d.last_edited_by_tech_id),
        "last_edited_by_tech_name": _normalize_text(d.last_edited_by_tech_name),
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


def list_deficiencies_for_site(
    testing_site_id: int,
    *,
    include_hidden: bool = False,
) -> list[dict[str, object]]:
    q = MonthlyTestingSiteDeficiency.query.filter_by(
        monthly_testing_site_id=int(testing_site_id),
    )
    if not include_hidden:
        q = q.filter(MonthlyTestingSiteDeficiency.status.in_(tuple(DEFICIENCY_CARD_STATUSES)))
    rows = q.order_by(MonthlyTestingSiteDeficiency.created_at.asc()).all()
    return [serialize_deficiency(d) for d in rows]


def _deficiency_visible_on_run_review(
    row: MonthlyTestingSiteDeficiency,
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
    testing_site_id: int,
    run: MonthlyRouteRun | None,
) -> list[dict[str, object]]:
    """Open deficiencies tied to this field run (reported or verified on the visit)."""
    if run is None:
        return []
    rows = (
        MonthlyTestingSiteDeficiency.query.filter_by(
            monthly_testing_site_id=int(testing_site_id),
        )
        .order_by(MonthlyTestingSiteDeficiency.created_at.asc())
        .all()
    )
    return [
        serialize_deficiency(d)
        for d in rows
        if _deficiency_visible_on_run_review(d, run)
    ]


def create_deficiency(
    testing_site_id: int,
    run_id: int | None,
    *,
    title: str,
    severity: str,
    status: str,
    description: str | None,
    tech_id: str | None,
    tech_name: str | None,
) -> MonthlyTestingSiteDeficiency:
    sev = severity.strip().lower()
    st = status.strip().lower()
    if sev not in DEFICIENCY_SEVERITIES:
        raise ValueError("invalid_severity")
    if st not in DEFICIENCY_STATUSES:
        raise ValueError("invalid_status")

    def_kw: dict[str, object] = {
        "monthly_testing_site_id": int(testing_site_id),
        "created_run_id": int(run_id) if run_id is not None else None,
        "title": title.strip(),
        "severity": sev,
        "status": st,
        "description": _normalize_text(description),
        "reported_by_tech_id": _normalize_text(tech_id),
        "reported_by_tech_name": _normalize_text(tech_name),
        "last_edited_by_tech_id": _normalize_text(tech_id),
        "last_edited_by_tech_name": _normalize_text(tech_name),
    }
    def_nid = _next_sqlite_bigint_id(MonthlyTestingSiteDeficiency)
    if def_nid is not None:
        def_kw["id"] = def_nid
    row = MonthlyTestingSiteDeficiency(**def_kw)
    db.session.add(row)
    db.session.flush()
    return row


def update_deficiency(
    deficiency: MonthlyTestingSiteDeficiency,
    *,
    title: str | None = None,
    severity: str | None = None,
    status: str | None = None,
    description: str | None = None,
    tech_id: str | None = None,
    tech_name: str | None = None,
) -> MonthlyTestingSiteDeficiency:
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
    deficiency: MonthlyTestingSiteDeficiency,
    *,
    tech_id: str | None,
    tech_name: str | None,
    note: str | None = None,
) -> MonthlyTestingSiteDeficiency:
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


def stop_has_run_changes(mtsm: MonthlyTestingSiteMonth, testing_site_id: int, run_id: int | None) -> bool:
    if _normalize_text(mtsm.test_outcome) or _normalize_text(mtsm.result_status):
        return True
    if _normalize_text(mtsm.run_comments):
        return True
    if MonthlyStopClockEvent.query.filter_by(monthly_testing_site_month_id=int(mtsm.id)).count() > 0:
        return True
    if run_id is not None:
        n = (
            MonthlyTestingSiteDeficiency.query.filter_by(
                monthly_testing_site_id=int(testing_site_id),
                created_run_id=int(run_id),
            ).count()
        )
        if n > 0:
            return True
    return False


def reset_stop_on_run(
    route_id: int,
    month_first: date,
    mtsm: MonthlyTestingSiteMonth,
    ts: MonthlyTestingSite,
    loc: MonthlyRouteLocation,
    run: MonthlyRouteRun | None,
) -> None:
    run_id = int(run.id) if run is not None else None

    MonthlyStopClockEvent.query.filter_by(
        monthly_testing_site_month_id=int(mtsm.id),
    ).delete(synchronize_session=False)

    if run_id is not None:
        MonthlyTestingSiteDeficiency.query.filter_by(
            monthly_testing_site_id=int(ts.id),
            created_run_id=run_id,
        ).delete(synchronize_session=False)

    from app.monthly.worksheet_stops import primary_testing_site, _prior_mtsm_by_testing_site, _history_for_locations

    ts_list = (
        MonthlyTestingSite.query.filter_by(monthly_site_id=int(ts.monthly_site_id))
        .order_by(MonthlyTestingSite.sort_order.asc(), MonthlyTestingSite.id.asc())
        .all()
    )
    primary = primary_testing_site(ts_list)
    prior_map = _prior_mtsm_by_testing_site([int(ts.id)], month_first)
    prior = prior_map.get(int(ts.id))
    hist_by_loc = _history_for_locations([int(loc.id)], month_first)
    location_hist = hist_by_loc.get(int(loc.id))

    fresh = seed_stop_month_fields(
        ts,
        loc,
        prior,
        route_id=route_id,
        run_id=run_id,
        month_first=month_first,
        primary=is_primary_stop(ts, loc),
        location_hist=location_hist,
        existing_row=None,
    )
    for key, val in fresh.items():
        if key in ("month_date", "monthly_testing_site_id"):
            continue
        setattr(mtsm, key, val)

    mtsm.test_outcome = None
    mtsm.skip_category = None
    mtsm.skip_note = None
    mtsm.confirmed_no_deficiencies = False

    if is_primary_stop(ts, loc):
        sync_primary_history_from_stop(mtsm, loc, route_id, month_first)

    audit_ids = WorksheetAuditEventIdAllocator()
    hist = _location_history(int(loc.id), month_first)
    if hist is not None:
        db.session.add(
            MonthlyRouteWorksheetAuditEvent(
                **audit_ids.id_kwargs(),
                monthly_route_id=route_id,
                location_id=int(loc.id),
                history_row_id=int(hist.id),
                month_date=month_first,
                field_name="stop_reset",
                old_value=None,
                new_value={"testing_site_id": int(ts.id)},
                source="technician_app",
            )
        )


def portal_workflow_extras_for_stop(
    mtsm: MonthlyTestingSiteMonth | None,
    ts: MonthlyTestingSite,
    loc: MonthlyRouteLocation,
    *,
    route_id: int,
    month_first: date,
    run: MonthlyRouteRun | None,
) -> dict[str, Any]:
    """Fields appended to ``serialize_worksheet_stop`` payload."""
    if mtsm is None:
        return {
            "clock_events": [],
            "deficiencies": list_deficiencies_for_site(int(ts.id)),
            "has_run_changes": False,
            "billing_status": get_location_billing_status(int(loc.id), month_first),
            "is_legacy_outcome": False,
            "portal_read_only": portal_run_is_read_only(run),
            "is_legacy_run": portal_run_is_read_only(run),
        }

    return {
        "clock_events": list_clock_events(mtsm),
        "deficiencies": list_deficiencies_for_site(int(ts.id)),
        "has_run_changes": stop_has_run_changes(
            mtsm, int(ts.id), int(run.id) if run is not None else None
        ),
        "billing_status": get_location_billing_status(int(loc.id), month_first),
        "is_legacy_outcome": is_legacy_outcome(mtsm),
        "portal_read_only": portal_run_is_read_only(run),
        "is_legacy_run": portal_run_is_read_only(run),
    }
