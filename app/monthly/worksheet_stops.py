"""V2 technician portal worksheet stops (``MonthlyTestingSiteMonth`` grain)."""

from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload, selectinload

from app.db_models import (
    MonthlyRoute,
    MonthlyRouteLocation,
    MonthlyRouteRun,
    MonthlyRouteTestHistory,
    MonthlySite,
    MonthlyTestingSite,
    MonthlyTestingSiteMonth,
    db,
)
from app.monthly.monthly_sites_sync import (
    ensure_monthly_site_for_location,
    sync_testing_sites_from_legacy,
)
from app.monthly.sheet_visit_times import looks_like_sheet_clock
from app.monthly.site_field_template import (
    master_template_fields,
    merge_template_with_prior_fallback,
)
from app.monthly.testing_site_fields import SNAPSHOT_STRING_FIELDS, SNAPSHOT_TEXT_FIELDS

if TYPE_CHECKING:
    pass


def _normalize_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _panel_from_testing_site(ts: MonthlyTestingSite) -> str | None:
    return _normalize_text(ts.panel) or _normalize_text(ts.facp_detail)


_MTSM_OUTCOME_KEYS = (
    "result_status",
    "skip_reason",
    "sheet_time_in_raw",
    "sheet_time_out_raw",
    "source_value_raw",
    "session_route_stop_order",
)

_MTSM_SNAPSHOT_DISPLAY_KEYS = (
    "annual_month",
    "property_management_company",
    "building_name",
    "panel_location",
    "door_code",
    "ring",
    "key_number",
    "panel",
    "facp",
    "testing_procedures",
    "inspection_tech_notes",
    "run_comments",
    "monitoring_company_name",
    "monitoring_notes",
)


def _cleared_outcome_fields() -> dict[str, object]:
    return {
        "session_route_stop_order": None,
        "result_status": None,
        "skip_reason": None,
        "sheet_time_in_raw": None,
        "sheet_time_out_raw": None,
        "source_value_raw": None,
    }


def _snapshot_fields_from_mtsm(mtsm: MonthlyTestingSiteMonth) -> dict[str, object]:
    return {key: getattr(mtsm, key) for key in _MTSM_SNAPSHOT_DISPLAY_KEYS}


def _next_sqlite_bigint_id(model) -> int | None:
    if "sqlite" not in (str(db.engine.url) or "").lower():
        return None
    return int(db.session.query(func.coalesce(func.max(model.id), 0)).scalar() or 0) + 1


def worksheet_stop_open_clock_in(mtsm: MonthlyTestingSiteMonth) -> bool:
    rs = (mtsm.result_status or "").strip().lower()
    if rs in ("tested", "skipped"):
        return False
    tin = _normalize_text(mtsm.sheet_time_in_raw)
    tout = _normalize_text(mtsm.sheet_time_out_raw)
    if not tin or tout:
        return False
    return looks_like_sheet_clock(tin)


def primary_testing_site(ts_list: list[MonthlyTestingSite]) -> MonthlyTestingSite | None:
    if not ts_list:
        return None
    return min(ts_list, key=lambda t: (int(t.sort_order), int(t.id)))


def _display_address(loc: MonthlyRouteLocation | None, location_id: int) -> str:
    if loc is not None:
        addr = (loc.display_address or loc.address or "").strip()
        if addr:
            return addr
    return f"Location {location_id}"


def _monitoring_labels(
    mtsm: MonthlyTestingSiteMonth | None,
    ts: MonthlyTestingSite,
    loc: MonthlyRouteLocation | None,
) -> tuple[str | None, str | None]:
    if mtsm is not None:
        return (
            _normalize_text(mtsm.monitoring_company_name),
            _normalize_text(mtsm.monitoring_notes),
        )
    from app.monthly.site_field_template import _master_monitoring_company_name

    if loc is None:
        company = (
            _normalize_text(ts.monitoring_company.name) if ts.monitoring_company is not None else None
        )
        return company, None
    return _master_monitoring_company_name(ts, loc), None


_HISTORY_SNAPSHOT_TO_MTSM: tuple[tuple[str, str], ...] = (
    ("annual_month", "annual_month"),
    ("ring", "ring"),
    ("key_number", "key_number"),
    ("testing_procedures", "testing_procedures"),
    ("inspection_tech_notes", "inspection_tech_notes"),
    ("monitoring_notes", "monitoring_notes"),
)


def _prior_history_for_location(
    location_id: int,
    month_first: date,
) -> MonthlyRouteTestHistory | None:
    return (
        db.session.query(MonthlyRouteTestHistory)
        .filter(
            MonthlyRouteTestHistory.location_id == int(location_id),
            MonthlyRouteTestHistory.month_date < month_first,
        )
        .order_by(MonthlyRouteTestHistory.month_date.desc())
        .first()
    )


def _fill_snapshot_gaps_from_history(
    base: dict[str, object],
    hist: MonthlyRouteTestHistory,
) -> None:
    """Fill empty stop-month snapshot fields from a ``MonthlyRouteTestHistory`` row."""
    for mtsm_key, hist_key in _HISTORY_SNAPSHOT_TO_MTSM:
        if _normalize_text(base.get(mtsm_key)) is not None:
            continue
        base[mtsm_key] = getattr(hist, hist_key, None)
    if _normalize_text(base.get("panel")) is None:
        panel = _normalize_text(hist.facp)
        base["panel"] = panel
        base["facp"] = panel


def seed_stop_month_fields(
    ts: MonthlyTestingSite,
    loc: MonthlyRouteLocation,
    prior: MonthlyTestingSiteMonth | None,
    *,
    route_id: int,
    run_id: int | None,
    month_first: date,
    primary: bool,
    location_hist: MonthlyRouteTestHistory | None,
    existing_row: MonthlyTestingSiteMonth | None = None,
) -> dict[str, object]:
    """Build insert/update payload for ``MonthlyTestingSiteMonth``."""
    if existing_row is not None:
        base = _snapshot_fields_from_mtsm(existing_row)
        for key in _MTSM_OUTCOME_KEYS:
            base[key] = getattr(existing_row, key)
        if base.get("monitoring_notes") is None and location_hist is not None:
            base["monitoring_notes"] = _normalize_text(location_hist.monitoring_notes)
    else:
        template = master_template_fields(ts, loc)
        base = merge_template_with_prior_fallback(template, prior)
        base.update(_cleared_outcome_fields())
        base["run_comments"] = None
        if primary:
            hist_seed = location_hist or _prior_history_for_location(int(loc.id), month_first)
            if hist_seed is not None:
                _fill_snapshot_gaps_from_history(base, hist_seed)

    if existing_row is None and primary and location_hist is not None:
        base["result_status"] = location_hist.result_status
        base["skip_reason"] = location_hist.skip_reason
        base["sheet_time_in_raw"] = location_hist.sheet_time_in_raw
        base["sheet_time_out_raw"] = location_hist.sheet_time_out_raw
        base["source_value_raw"] = location_hist.source_value_raw
        if location_hist.session_route_stop_order is not None:
            base["session_route_stop_order"] = location_hist.session_route_stop_order
    elif not primary:
        base["result_status"] = None
        base["skip_reason"] = None
        base["sheet_time_in_raw"] = None
        base["sheet_time_out_raw"] = None
        base["source_value_raw"] = None

    base["month_date"] = month_first
    base["test_monthly_route_id"] = route_id
    base["run_id"] = run_id
    return base


def _prior_mtsm_by_testing_site(
    testing_site_ids: list[int],
    month_first: date,
) -> dict[int, MonthlyTestingSiteMonth]:
    if not testing_site_ids:
        return {}
    rows = (
        db.session.query(MonthlyTestingSiteMonth)
        .filter(
            MonthlyTestingSiteMonth.monthly_testing_site_id.in_(testing_site_ids),
            MonthlyTestingSiteMonth.month_date < month_first,
        )
        .order_by(
            MonthlyTestingSiteMonth.monthly_testing_site_id.asc(),
            MonthlyTestingSiteMonth.month_date.desc(),
        )
        .all()
    )
    out: dict[int, MonthlyTestingSiteMonth] = {}
    for row in rows:
        out.setdefault(int(row.monthly_testing_site_id), row)
    return out


def _route_locations(route_id: int) -> list[MonthlyRouteLocation]:
    return (
        MonthlyRouteLocation.query.options(joinedload(MonthlyRouteLocation.monitoring_company))
        .filter(MonthlyRouteLocation.monthly_route_id == route_id)
        .all()
    )


def _history_for_locations(
    location_ids: list[int],
    month_first: date,
) -> dict[int, MonthlyRouteTestHistory]:
    if not location_ids:
        return {}
    rows = (
        db.session.query(MonthlyRouteTestHistory)
        .filter(
            MonthlyRouteTestHistory.location_id.in_(location_ids),
            MonthlyRouteTestHistory.month_date == month_first,
        )
        .all()
    )
    return {int(r.location_id): r for r in rows}


def ensure_worksheet_stops_for_route_month(
    route_id: int,
    month_first: date,
    run: MonthlyRouteRun,
) -> None:
    """Idempotently materialize ``MonthlyTestingSiteMonth`` for every testing site on the route."""
    locs = _route_locations(route_id)
    if not locs:
        return
    loc_ids = [int(loc.id) for loc in locs]
    hist_by_loc = _history_for_locations(loc_ids, month_first)
    run_id = int(run.id)

    all_ts_ids: list[int] = []
    loc_ts: dict[int, list[MonthlyTestingSite]] = {}
    for loc in locs:
        site = ensure_monthly_site_for_location(loc)
        ts_rows = sync_testing_sites_from_legacy(loc)
        if not ts_rows:
            ts_rows = (
                MonthlyTestingSite.query.filter_by(monthly_site_id=int(site.id))
                .order_by(MonthlyTestingSite.sort_order.asc(), MonthlyTestingSite.id.asc())
                .all()
            )
        loc_ts[int(loc.id)] = ts_rows
        all_ts_ids.extend(int(t.id) for t in ts_rows)

    prior_by_ts = _prior_mtsm_by_testing_site(all_ts_ids, month_first)

    existing = {
        int(r.monthly_testing_site_id): r
        for r in db.session.query(MonthlyTestingSiteMonth)
        .filter(
            MonthlyTestingSiteMonth.month_date == month_first,
            MonthlyTestingSiteMonth.monthly_testing_site_id.in_(all_ts_ids),
        )
        .all()
    } if all_ts_ids else {}

    for loc in locs:
        ts_list = loc_ts.get(int(loc.id), [])
        if not ts_list:
            continue
        primary = primary_testing_site(ts_list)
        loc_hist = hist_by_loc.get(int(loc.id))
        for ts in ts_list:
            ts_id = int(ts.id)
            is_primary = primary is not None and int(primary.id) == ts_id
            prior = prior_by_ts.get(ts_id)
            row = existing.get(ts_id)
            fields = seed_stop_month_fields(
                ts,
                loc,
                prior,
                route_id=route_id,
                run_id=run_id,
                month_first=month_first,
                primary=is_primary,
                location_hist=loc_hist if is_primary else None,
                existing_row=row,
            )
            if row is None:
                fields["monthly_testing_site_id"] = ts_id
                kw = dict(fields)
                nid = _next_sqlite_bigint_id(MonthlyTestingSiteMonth)
                if nid is not None:
                    kw["id"] = nid
                try:
                    with db.session.begin_nested():
                        db.session.add(MonthlyTestingSiteMonth(**kw))
                except IntegrityError:
                    row = (
                        MonthlyTestingSiteMonth.query.filter_by(
                            monthly_testing_site_id=ts_id,
                            month_date=month_first,
                        ).one_or_none()
                    )
            if row is not None:
                for key, val in fields.items():
                    if key in ("month_date", "monthly_testing_site_id"):
                        continue
                    setattr(row, key, val)
    db.session.flush()


def _mtsm_has_field_progress(mtsm: MonthlyTestingSiteMonth) -> bool:
    rs = (mtsm.result_status or "").strip().lower()
    if rs in ("tested", "skipped"):
        return True
    if _normalize_text(mtsm.sheet_time_in_raw) or _normalize_text(mtsm.sheet_time_out_raw):
        return True
    return _normalize_text(mtsm.run_comments) is not None


def refresh_worksheet_stops_for_route_month(
    route_id: int,
    month_first: date,
    run: MonthlyRouteRun,
) -> tuple[int, int]:
    """Re-seed stop-month snapshot paperwork from master + prior run data.

    Preserves tested/skipped outcomes, clock times, and run comments on each stop.
    Returns ``(stops_created, stops_refreshed)``.
    """
    locs = _route_locations(route_id)
    if not locs:
        return 0, 0
    loc_ids = [int(loc.id) for loc in locs]
    hist_by_loc = _history_for_locations(loc_ids, month_first)
    run_id = int(run.id)

    all_ts_ids: list[int] = []
    loc_ts: dict[int, list[MonthlyTestingSite]] = {}
    for loc in locs:
        site = ensure_monthly_site_for_location(loc)
        ts_rows = sync_testing_sites_from_legacy(loc)
        if not ts_rows:
            ts_rows = (
                MonthlyTestingSite.query.filter_by(monthly_site_id=int(site.id))
                .order_by(MonthlyTestingSite.sort_order.asc(), MonthlyTestingSite.id.asc())
                .all()
            )
        loc_ts[int(loc.id)] = ts_rows
        all_ts_ids.extend(int(t.id) for t in ts_rows)

    prior_by_ts = _prior_mtsm_by_testing_site(all_ts_ids, month_first)
    existing = {
        int(r.monthly_testing_site_id): r
        for r in db.session.query(MonthlyTestingSiteMonth)
        .filter(
            MonthlyTestingSiteMonth.month_date == month_first,
            MonthlyTestingSiteMonth.monthly_testing_site_id.in_(all_ts_ids),
        )
        .all()
    } if all_ts_ids else {}

    created = 0
    refreshed = 0
    for loc in locs:
        ts_list = loc_ts.get(int(loc.id), [])
        if not ts_list:
            continue
        primary = primary_testing_site(ts_list)
        loc_hist = hist_by_loc.get(int(loc.id))
        for ts in ts_list:
            ts_id = int(ts.id)
            is_primary = primary is not None and int(primary.id) == ts_id
            prior = prior_by_ts.get(ts_id)
            row = existing.get(ts_id)
            fresh = seed_stop_month_fields(
                ts,
                loc,
                prior,
                route_id=route_id,
                run_id=run_id,
                month_first=month_first,
                primary=is_primary,
                location_hist=loc_hist if is_primary else None,
                existing_row=None,
            )
            if row is None:
                fields = dict(fresh)
                fields["monthly_testing_site_id"] = ts_id
                nid = _next_sqlite_bigint_id(MonthlyTestingSiteMonth)
                if nid is not None:
                    fields["id"] = nid
                try:
                    with db.session.begin_nested():
                        db.session.add(MonthlyTestingSiteMonth(**fields))
                    created += 1
                    continue
                except IntegrityError:
                    row = (
                        MonthlyTestingSiteMonth.query.filter_by(
                            monthly_testing_site_id=ts_id,
                            month_date=month_first,
                        ).one_or_none()
                    )
            if row is None:
                continue
            for key in _MTSM_SNAPSHOT_DISPLAY_KEYS:
                setattr(row, key, fresh.get(key))
            if not _mtsm_has_field_progress(row):
                row.session_route_stop_order = fresh.get("session_route_stop_order")
            row.run_id = run_id
            row.test_monthly_route_id = route_id
            refreshed += 1
    db.session.flush()
    return created, refreshed


def _stop_sort_key(
    mtsm: MonthlyTestingSiteMonth | None,
    ts: MonthlyTestingSite,
    loc: MonthlyRouteLocation,
) -> tuple[int, int, int, int]:
    sess = mtsm.session_route_stop_order if mtsm is not None else None
    if sess is not None:
        tier = 0
        order = int(sess)
    elif loc.route_stop_order is not None:
        tier = 1
        order = int(loc.route_stop_order) * 1000 + int(ts.sort_order)
    else:
        tier = 2
        order = int(ts.sort_order)
    return (tier, order, int(loc.id), int(ts.id))


def _overlay_history_on_stop(
    stop: dict[str, object],
    hist: MonthlyRouteTestHistory,
    *,
    ts: MonthlyTestingSite,
    loc: MonthlyRouteLocation,
) -> dict[str, object]:
    """Apply run-scoped location history onto a stop dict (prior runs without MTSM rows)."""
    panel = _normalize_text(hist.facp)
    monitoring_notes = _normalize_text(hist.monitoring_notes)
    company = monitoring_notes or stop.get("monitoring_company")
    merged = {
        **stop,
        "history_month_row_id": int(hist.id),
        "annual_month": hist.annual_month,
        "ring": hist.ring,
        "key_number": hist.key_number,
        "panel": panel,
        "monitoring_company": company,
        "monitoring_notes": monitoring_notes if monitoring_notes and not company else stop.get("monitoring_notes"),
        "result_status": hist.result_status,
        "skip_reason": hist.skip_reason,
        "testing_procedures": hist.testing_procedures,
        "inspection_tech_notes": hist.inspection_tech_notes,
        "time_in": hist.sheet_time_in_raw,
        "time_out": hist.sheet_time_out_raw,
        "session_route_stop_order": (
            int(hist.session_route_stop_order) if hist.session_route_stop_order is not None else None
        ),
        "version_updated_at": hist.updated_at.isoformat() if hist.updated_at else None,
    }
    return merged


def run_comments_for_route_month(route_id: int, month_first: date) -> list[dict[str, object]]:
    """Non-empty run comments for office run-details (avoids full stop serialization)."""
    rows = (
        MonthlyTestingSiteMonth.query.filter(
            MonthlyTestingSiteMonth.month_date == month_first,
            MonthlyTestingSiteMonth.test_monthly_route_id == route_id,
            MonthlyTestingSiteMonth.run_comments.isnot(None),
        )
        .options(
            joinedload(MonthlyTestingSiteMonth.testing_site)
            .joinedload(MonthlyTestingSite.monthly_site)
            .joinedload(MonthlySite.legacy_location),
        )
        .all()
    )
    out: list[dict[str, object]] = []
    for mtsm in rows:
        text = _normalize_text(mtsm.run_comments)
        if not text:
            continue
        ts = mtsm.testing_site
        if ts is None:
            continue
        site = ts.monthly_site
        if site is None or site.legacy_monthly_route_location_id is None:
            continue
        loc = site.legacy_location
        if loc is None or int(loc.monthly_route_id) != int(route_id):
            continue
        building = _normalize_text(mtsm.building_name) or _normalize_text(loc.building)
        out.append(
            {
                "testing_site_id": int(ts.id),
                "location_id": int(loc.id),
                "display_address": (loc.display_address or loc.address or "").strip(),
                "building": building,
                "run_comments": text,
            }
        )
    out.sort(
        key=lambda row: (
            str(row["display_address"]).casefold(),
            int(row["location_id"]),
            int(row["testing_site_id"]),
        )
    )
    return out


def _attributed_history_for_route_month(
    route_id: int,
    month_first: date,
) -> list[MonthlyRouteTestHistory]:
    loc_ids = [
        int(lid)
        for (lid,) in db.session.query(MonthlyRouteLocation.id)
        .filter(MonthlyRouteLocation.monthly_route_id == route_id)
        .all()
    ]
    hist_attr = MonthlyRouteTestHistory.query.filter(
        MonthlyRouteTestHistory.test_monthly_route_id == route_id,
        MonthlyRouteTestHistory.month_date == month_first,
    ).all()
    hist_legacy: list[MonthlyRouteTestHistory] = []
    if loc_ids:
        hist_legacy = MonthlyRouteTestHistory.query.filter(
            MonthlyRouteTestHistory.test_monthly_route_id.is_(None),
            MonthlyRouteTestHistory.location_id.in_(loc_ids),
            MonthlyRouteTestHistory.month_date == month_first,
        ).all()
    merged: dict[tuple[int, date], MonthlyRouteTestHistory] = {}
    for row in hist_attr + hist_legacy:
        merged[(int(row.location_id), row.month_date)] = row
    return list(merged.values())


def serialize_worksheet_stop(
    ts: MonthlyTestingSite,
    loc: MonthlyRouteLocation,
    mtsm: MonthlyTestingSiteMonth | None,
    *,
    route_id: int,
    month_first: date,
    stop_number: int,
) -> dict[str, object]:
    company, mon_notes = _monitoring_labels(mtsm, ts, loc)
    panel = None
    ring = None
    key_number = None
    annual_month = None
    procedures = None
    tech_notes = None
    run_comments = None
    result_status = None
    skip_reason = None
    time_in = None
    time_out = None
    sess_order = None
    version = None
    row_id = 0

    if mtsm is not None:
        panel = _normalize_text(mtsm.panel) or _normalize_text(mtsm.facp)
        ring = mtsm.ring
        key_number = mtsm.key_number
        annual_month = mtsm.annual_month
        procedures = mtsm.testing_procedures
        tech_notes = mtsm.inspection_tech_notes
        run_comments = mtsm.run_comments
        result_status = mtsm.result_status
        skip_reason = mtsm.skip_reason
        time_in = mtsm.sheet_time_in_raw
        time_out = mtsm.sheet_time_out_raw
        sess_order = mtsm.session_route_stop_order
        version = mtsm.updated_at.isoformat() if mtsm.updated_at else None
        row_id = int(mtsm.id)
        pmc = _normalize_text(mtsm.property_management_company)
        building = _normalize_text(mtsm.building_name)
        panel_loc = mtsm.panel_location
        door = mtsm.door_code
    else:
        preview = master_template_fields(ts, loc)
        panel = _normalize_text(preview.get("panel"))
        ring = preview.get("ring")
        key_number = preview.get("key_number")
        annual_month = preview.get("annual_month")
        procedures = preview.get("testing_procedures")
        tech_notes = preview.get("inspection_tech_notes")
        run_comments = None
        pmc = _normalize_text(preview.get("property_management_company"))
        building = _normalize_text(preview.get("building_name"))
        panel_loc = preview.get("panel_location")
        door = preview.get("door_code")
        result_status = None
        skip_reason = None
        time_in = None
        time_out = None
        sess_order = None
        version = None
        row_id = 0

    library_order = int(loc.route_stop_order) if loc.route_stop_order is not None else None

    stop = {
        "testing_site_id": int(ts.id),
        "location_id": int(loc.id),
        "history_month_row_id": row_id,
        "month_date": month_first.isoformat(),
        "display_address": _display_address(loc, int(loc.id)),
        "building_name": building,
        "property_management_company": pmc,
        "label": _normalize_text(ts.label),
        "panel": panel,
        "panel_location": panel_loc,
        "door_code": door,
        "ring": ring,
        "key_number": key_number,
        "annual_month": annual_month,
        "monitoring_company": company,
        "monitoring_notes": mon_notes,
        "result_status": result_status,
        "skip_reason": skip_reason,
        "testing_procedures": procedures,
        "inspection_tech_notes": tech_notes,
        "run_comments": run_comments,
        "time_in": time_in,
        "time_out": time_out,
        "route_stop_order": library_order,
        "session_route_stop_order": int(sess_order) if sess_order is not None else None,
        "stop_number": stop_number,
        "version_updated_at": version,
    }
    return stop


def portal_worksheet_preview_stops(
    route_id: int,
    month_first: date,
) -> list[dict[str, object]]:
    """Preview stops from library master data (no ``MonthlyTestingSiteMonth`` rows)."""
    locs = _route_locations(route_id)
    locs_sorted = sorted(
        locs,
        key=lambda loc: (0, int(loc.route_stop_order)) if loc.route_stop_order is not None else (1, 10**9),
    )
    stops: list[dict[str, object]] = []
    stop_num = 0
    for loc in locs_sorted:
        site = ensure_monthly_site_for_location(loc)
        ts_rows = (
            MonthlyTestingSite.query.options(joinedload(MonthlyTestingSite.monitoring_company))
            .filter_by(monthly_site_id=int(site.id))
            .order_by(MonthlyTestingSite.sort_order.asc(), MonthlyTestingSite.id.asc())
            .all()
        )
        if not ts_rows:
            ts_rows = sync_testing_sites_from_legacy(loc)
        for ts in ts_rows:
            stop_num += 1
            stops.append(
                serialize_worksheet_stop(ts, loc, None, route_id=route_id, month_first=month_first, stop_number=stop_num)
            )
    return stops


def _testing_sites_for_location(loc: MonthlyRouteLocation) -> list[MonthlyTestingSite]:
    site = ensure_monthly_site_for_location(loc)
    ts_rows = (
        MonthlyTestingSite.query.options(joinedload(MonthlyTestingSite.monitoring_company))
        .filter_by(monthly_site_id=int(site.id))
        .order_by(MonthlyTestingSite.sort_order.asc(), MonthlyTestingSite.id.asc())
        .all()
    )
    if not ts_rows:
        ts_rows = sync_testing_sites_from_legacy(loc)
    return ts_rows


def worksheet_stops_from_attributed_history(
    route_id: int,
    month_first: date,
) -> list[dict[str, object]]:
    """Build portal stops from legacy history when no v2 stop-month rows exist yet."""
    hist_rows = _attributed_history_for_route_month(route_id, month_first)
    if not hist_rows:
        return []
    locs = _route_locations(route_id)
    loc_by_id = {int(loc.id): loc for loc in locs}
    hist_by_loc = {int(h.location_id): h for h in hist_rows}

    pairs: list[tuple[MonthlyRouteTestHistory, MonthlyTestingSite, MonthlyRouteLocation]] = []
    for loc_id, hist in hist_by_loc.items():
        loc = loc_by_id.get(loc_id)
        if loc is None:
            continue
        ts_rows = _testing_sites_for_location(loc)
        primary = primary_testing_site(ts_rows)
        if primary is None:
            continue
        pairs.append((hist, primary, loc))

    def _hist_pair_sort_key(item: tuple[MonthlyRouteTestHistory, MonthlyTestingSite, MonthlyRouteLocation]) -> tuple[int, int, int, int]:
        hist, ts, loc = item
        if hist.session_route_stop_order is not None:
            return (0, int(hist.session_route_stop_order), int(loc.id), int(ts.id))
        if loc.route_stop_order is not None:
            return (1, int(loc.route_stop_order) * 1000 + int(ts.sort_order), int(loc.id), int(ts.id))
        return (2, int(ts.sort_order), int(loc.id), int(ts.id))

    pairs.sort(key=_hist_pair_sort_key)

    out: list[dict[str, object]] = []
    for idx, (hist, ts, loc) in enumerate(pairs, start=1):
        mtsm = (
            MonthlyTestingSiteMonth.query.filter_by(
                monthly_testing_site_id=int(ts.id),
                month_date=month_first,
            )
            .one_or_none()
        )
        stop = serialize_worksheet_stop(
            ts,
            loc,
            mtsm,
            route_id=route_id,
            month_first=month_first,
            stop_number=idx,
        )
        if mtsm is None:
            stop = _overlay_history_on_stop(stop, hist, ts=ts, loc=loc)
        out.append(stop)
    return out


def worksheet_stops_for_route_month(
    route_id: int,
    month_first: date,
) -> list[dict[str, object]]:
    """Load and sort portal worksheet stops for an active run month."""
    locs = _route_locations(route_id)
    if not locs:
        return []
    loc_by_id = {int(loc.id): loc for loc in locs}
    loc_ids = list(loc_by_id.keys())
    hist_by_loc = _history_for_locations(loc_ids, month_first)

    ts_rows: list[MonthlyTestingSite] = []
    ts_by_loc: dict[int, list[MonthlyTestingSite]] = {}
    for loc in locs:
        for ts in _testing_sites_for_location(loc):
            ts_rows.append(ts)
            ts_by_loc.setdefault(int(loc.id), []).append(ts)

    if not ts_rows:
        return worksheet_stops_from_attributed_history(route_id, month_first)

    ts_by_id = {int(ts.id): ts for ts in ts_rows}
    ts_ids = list(ts_by_id.keys())

    mtsm_rows = (
        MonthlyTestingSiteMonth.query.filter(
            MonthlyTestingSiteMonth.month_date == month_first,
            MonthlyTestingSiteMonth.monthly_testing_site_id.in_(ts_ids),
            MonthlyTestingSiteMonth.test_monthly_route_id == route_id,
        )
        .all()
    )
    mtsm_by_ts = {int(m.monthly_testing_site_id): m for m in mtsm_rows}

    pairs: list[tuple[MonthlyTestingSiteMonth | None, MonthlyTestingSite, MonthlyRouteLocation]] = []
    for ts_id, ts in ts_by_id.items():
        site = ts.monthly_site
        if site is None or site.legacy_monthly_route_location_id is None:
            continue
        loc = loc_by_id.get(int(site.legacy_monthly_route_location_id))
        if loc is None or int(loc.monthly_route_id) != int(route_id):
            continue
        pairs.append((mtsm_by_ts.get(ts_id), ts, loc))

    pairs.sort(key=lambda item: _stop_sort_key(item[0], item[1], item[2]))

    out: list[dict[str, object]] = []
    for idx, (mtsm, ts, loc) in enumerate(pairs, start=1):
        hist = hist_by_loc.get(int(loc.id))
        primary = primary_testing_site(ts_by_loc.get(int(loc.id), []))
        is_primary = primary is not None and int(primary.id) == int(ts.id)
        stop = serialize_worksheet_stop(
            ts,
            loc,
            mtsm,
            route_id=route_id,
            month_first=month_first,
            stop_number=idx,
        )
        if is_primary and hist is not None and mtsm is None:
            stop = _overlay_history_on_stop(stop, hist, ts=ts, loc=loc)
        out.append(stop)
    return out


def _route_month_has_run_comments(route_id: int, month_first: date) -> bool:
    return (
        db.session.query(MonthlyTestingSiteMonth.id)
        .filter(
            MonthlyTestingSiteMonth.month_date == month_first,
            MonthlyTestingSiteMonth.test_monthly_route_id == route_id,
            MonthlyTestingSiteMonth.run_comments.isnot(None),
            func.trim(MonthlyTestingSiteMonth.run_comments) != "",
        )
        .limit(1)
        .first()
        is not None
    )


def _route_month_has_skipped_stops(route_id: int, month_first: date) -> bool:
    if (
        db.session.query(MonthlyTestingSiteMonth.id)
        .filter(
            MonthlyTestingSiteMonth.month_date == month_first,
            MonthlyTestingSiteMonth.test_monthly_route_id == route_id,
            MonthlyTestingSiteMonth.result_status == "skipped",
        )
        .limit(1)
        .first()
        is not None
    ):
        return True
    for row in _attributed_history_for_route_month(route_id, month_first):
        if (row.result_status or "").strip().lower() == "skipped":
            return True
    return False


def notable_worksheet_stops_for_run_details(
    route_id: int,
    month_first: date,
    property_change_location_ids: set[int],
) -> list[dict[str, object]]:
    """Worksheet stops for run-details: skipped, property audit edits, or non-empty job comments."""
    if (
        not property_change_location_ids
        and not _route_month_has_skipped_stops(route_id, month_first)
        and not _route_month_has_run_comments(route_id, month_first)
    ):
        return []

    all_stops = worksheet_stops_for_route_month(route_id, month_first)
    filtered: list[dict[str, object]] = []
    for stop in all_stops:
        lid = int(stop["location_id"])
        rs = (str(stop.get("result_status") or "")).strip().lower()
        has_run_comments = _normalize_text(stop.get("run_comments")) is not None
        if lid in property_change_location_ids or rs == "skipped" or has_run_comments:
            filtered.append(dict(stop))

    return filtered


def worksheet_stops_revision_token(route_id: int, month_first: date) -> str | None:
    """Fingerprint for portal worksheet stop rows (SSE)."""
    max_ts = (
        db.session.query(func.max(MonthlyTestingSiteMonth.updated_at))
        .filter(
            MonthlyTestingSiteMonth.month_date == month_first,
            MonthlyTestingSiteMonth.test_monthly_route_id == route_id,
        )
        .scalar()
    )
    count = (
        db.session.query(func.count(MonthlyTestingSiteMonth.id))
        .filter(
            MonthlyTestingSiteMonth.month_date == month_first,
            MonthlyTestingSiteMonth.test_monthly_route_id == route_id,
        )
        .scalar()
    )
    ts_part = max_ts.isoformat() if max_ts is not None else "none"
    return f"mtsm:{ts_part}:{int(count or 0)}"


def load_stop_for_patch(
    route_id: int,
    testing_site_id: int,
    month_first: date,
) -> tuple[MonthlyTestingSiteMonth | None, MonthlyTestingSite | None, MonthlyRouteLocation | None]:
    ts = (
        MonthlyTestingSite.query.options(
            joinedload(MonthlyTestingSite.monitoring_company),
            joinedload(MonthlyTestingSite.monthly_site).joinedload(MonthlySite.legacy_location),
        )
        .filter_by(id=testing_site_id)
        .one_or_none()
    )
    if ts is None:
        return None, None, None
    site = ts.monthly_site
    if site is None or site.legacy_monthly_route_location_id is None:
        return None, ts, None
    loc = site.legacy_location
    if loc is None or int(loc.monthly_route_id) != int(route_id):
        return None, ts, loc
    mtsm = (
        MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=testing_site_id,
            month_date=month_first,
        )
        .one_or_none()
    )
    return mtsm, ts, loc


# Editable PATCH field map (API key -> ORM attribute on MonthlyTestingSiteMonth)
def patch_will_start_open_clock_in(
    mtsm: MonthlyTestingSiteMonth,
    changes_eff: dict[str, object],
) -> bool:
    if "time_in" not in changes_eff:
        return False
    tin = _normalize_text(changes_eff.get("time_in"))
    if not tin or not looks_like_sheet_clock(tin):
        return False
    if worksheet_stop_open_clock_in(mtsm):
        return False
    tout = (
        _normalize_text(changes_eff.get("time_out"))
        if "time_out" in changes_eff
        else _normalize_text(mtsm.sheet_time_out_raw)
    )
    if tout:
        return False
    rs = (
        _normalize_text(changes_eff.get("result_status"))
        if "result_status" in changes_eff
        else _normalize_text(mtsm.result_status)
    )
    if (rs or "").lower() == "skipped":
        return False
    return True


def find_open_clock_in_stop_on_route(
    route_id: int,
    month_first: date,
    *,
    exclude_testing_site_id: int | None = None,
) -> MonthlyTestingSiteMonth | None:
    rows = (
        MonthlyTestingSiteMonth.query.filter(
            MonthlyTestingSiteMonth.month_date == month_first,
            MonthlyTestingSiteMonth.test_monthly_route_id == route_id,
        )
        .all()
    )
    for row in rows:
        if exclude_testing_site_id is not None and int(row.monthly_testing_site_id) == int(
            exclude_testing_site_id
        ):
            continue
        if worksheet_stop_open_clock_in(row):
            return row
    return None


def sync_primary_history_from_stop(
    mtsm: MonthlyTestingSiteMonth,
    loc: MonthlyRouteLocation,
    route_id: int,
    month_first: date,
) -> MonthlyRouteTestHistory:
    """Dual-write portal stop outcomes onto the location history row (audit FK)."""
    hist = (
        MonthlyRouteTestHistory.query.filter_by(
            location_id=int(loc.id),
            month_date=month_first,
        )
        .one_or_none()
    )
    if hist is None:
        hist_kw: dict[str, object] = {
            "location_id": int(loc.id),
            "month_date": month_first,
            "test_monthly_route_id": route_id,
            "run_id": mtsm.run_id,
            "result_status": None,
        }
        nid = _next_sqlite_bigint_id(MonthlyRouteTestHistory)
        if nid is not None:
            hist_kw["id"] = nid
        hist = MonthlyRouteTestHistory(**hist_kw)
        db.session.add(hist)
        db.session.flush()
    hist.result_status = mtsm.result_status
    hist.skip_reason = mtsm.skip_reason
    hist.sheet_time_in_raw = mtsm.sheet_time_in_raw
    hist.sheet_time_out_raw = mtsm.sheet_time_out_raw
    hist.session_route_stop_order = mtsm.session_route_stop_order
    if mtsm.testing_procedures is not None:
        hist.testing_procedures = mtsm.testing_procedures
    if mtsm.inspection_tech_notes is not None:
        hist.inspection_tech_notes = mtsm.inspection_tech_notes
    if mtsm.ring is not None:
        hist.ring = mtsm.ring
    if mtsm.key_number is not None:
        hist.key_number = mtsm.key_number
    if mtsm.annual_month is not None:
        hist.annual_month = mtsm.annual_month
    panel = _normalize_text(mtsm.panel) or _normalize_text(mtsm.facp)
    if panel is not None:
        hist.facp = panel
    if mtsm.monitoring_notes is not None:
        hist.monitoring_notes = mtsm.monitoring_notes
    if hist.test_monthly_route_id is None:
        hist.test_monthly_route_id = route_id
    if hist.run_id is None and mtsm.run_id is not None:
        hist.run_id = mtsm.run_id
    return hist


def _mtsm_is_preserved_annual_skip(mtsm: MonthlyTestingSiteMonth) -> bool:
    if (mtsm.result_status or "").strip().lower() != "skipped":
        return False
    sr = (mtsm.skip_reason or "").strip().lower()
    return sr in ("annual", "annual_booked")


def reset_worksheet_stops_for_route_month(route_id: int, month_first: date) -> tuple[int, int]:
    """Clear portal stop outcomes for a route-month (preserves annual skips)."""
    cleared = 0
    preserved = 0
    rows = (
        MonthlyTestingSiteMonth.query.filter(
            MonthlyTestingSiteMonth.month_date == month_first,
            MonthlyTestingSiteMonth.test_monthly_route_id == route_id,
        )
        .all()
    )
    for mtsm in rows:
        if _mtsm_is_preserved_annual_skip(mtsm):
            preserved += 1
            continue
        has_outcome = (
            mtsm.result_status is not None
            or _normalize_text(mtsm.sheet_time_in_raw) is not None
            or _normalize_text(mtsm.sheet_time_out_raw) is not None
        )
        has_run_comments = _normalize_text(mtsm.run_comments) is not None
        if not has_outcome and not has_run_comments:
            continue
        mtsm.run_comments = None
        if has_outcome:
            mtsm.result_status = None
            mtsm.skip_reason = None
            mtsm.sheet_time_in_raw = None
            mtsm.sheet_time_out_raw = None
        cleared += 1
    return cleared, preserved


def is_primary_stop(ts: MonthlyTestingSite, loc: MonthlyRouteLocation) -> bool:
    ts_list = (
        MonthlyTestingSite.query.filter_by(monthly_site_id=int(ts.monthly_site_id))
        .order_by(MonthlyTestingSite.sort_order.asc(), MonthlyTestingSite.id.asc())
        .all()
    )
    primary = primary_testing_site(ts_list)
    return primary is not None and int(primary.id) == int(ts.id)


STOP_PATCH_FIELD_MAP: dict[str, str] = {
    "result_status": "result_status",
    "skip_reason": "skip_reason",
    "testing_procedures": "testing_procedures",
    "inspection_tech_notes": "inspection_tech_notes",
    "run_comments": "run_comments",
    "time_in": "sheet_time_in_raw",
    "time_out": "sheet_time_out_raw",
    "annual_month": "annual_month",
    "ring": "ring",
    "key_number": "key_number",
    "panel": "panel",
    "facp": "facp",
    "panel_location": "panel_location",
    "door_code": "door_code",
    "property_management_company": "property_management_company",
    "building_name": "building_name",
    "monitoring_notes": "monitoring_notes",
    "monitoring_company": "monitoring_company_name",
}

# Subset of stop PATCH keys mirrored on ``MonthlyRouteTestHistory`` for audit/dual-write.
# Other snapshot fields (building, door, PMC, panel location, monitoring company name)
# live on ``MonthlyTestingSiteMonth`` only until history columns are extended.
STOP_PATCH_HISTORY_AUDIT_ATTR: dict[str, str] = {
    "result_status": "result_status",
    "skip_reason": "skip_reason",
    "testing_procedures": "testing_procedures",
    "inspection_tech_notes": "inspection_tech_notes",
    "time_in": "sheet_time_in_raw",
    "time_out": "sheet_time_out_raw",
    "annual_month": "annual_month",
    "ring": "ring",
    "key_number": "key_number",
    "panel": "facp",
    "facp": "facp",
    "monitoring_notes": "monitoring_notes",
}

# Office run-details field-changes card: omit test workflow, run comments, and reset-run audit.
RUN_DETAILS_EXCLUDED_AUDIT_FIELDS = frozenset({
    "result_status",
    "skip_reason",
    "time_in",
    "time_out",
    "run_comments",
    "reset_run",
})
