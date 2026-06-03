"""V2 technician portal worksheet stops (``MonthlyTestingSiteMonth`` grain)."""

from __future__ import annotations

from datetime import date, datetime
from collections.abc import Iterable
from typing import TYPE_CHECKING

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload, selectinload

from app.db_models import (
    MonitoringCompany,
    MonthlyRoute,
    MonthlyRouteLocation,
    MonthlyRouteRun,
    MonthlyRouteTestHistory,
    MonthlyRouteWorksheetAuditEvent,
    MonthlySite,
    MonthlyTestingSite,
    MonthlyTestingSiteMonth,
    db,
)
from app.monthly.monthly_sites_sync import (
    ensure_monthly_site_for_location,
    mirror_mtsm_snapshot_to_primary_master,
    push_primary_testing_site_display_to_legacy,
    sync_testing_sites_from_legacy,
)
from app.monthly.sheet_visit_times import SheetTimeImportRow, looks_like_sheet_clock
from app.monthly.site_field_template import (
    master_template_fields,
    merge_template_with_prior_fallback,
)
from app.monthly.testing_site_fields import SNAPSHOT_STRING_FIELDS, SNAPSHOT_TEXT_FIELDS
from app.monthly.monitoring_companies import serialize_monitoring_company

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
    "test_outcome",
    "skip_category",
    "skip_note",
    "confirmed_no_deficiencies",
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
    "monitoring_company_id",
    "monitoring_company_name",
    "monitoring_account_number",
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
        "test_outcome": None,
        "skip_category": None,
        "skip_note": None,
        "confirmed_no_deficiencies": False,
    }


def _snapshot_fields_from_mtsm(mtsm: MonthlyTestingSiteMonth) -> dict[str, object]:
    return {key: getattr(mtsm, key) for key in _MTSM_SNAPSHOT_DISPLAY_KEYS}


def _fill_snapshot_gaps_from_master(
    values: dict[str, object],
    ts: MonthlyTestingSite,
    loc: MonthlyRouteLocation,
) -> None:
    """Use library master for empty stop-month snapshot fields (prep / display parity)."""
    template = master_template_fields(ts, loc)
    for key in (
        "annual_month",
        "property_management_company",
        "building_name",
        "panel_location",
        "door_code",
        "ring",
        "key_number",
        "testing_procedures",
        "inspection_tech_notes",
        "monitoring_company_id",
        "monitoring_company_name",
        "monitoring_account_number",
        "monitoring_notes",
    ):
        if _normalize_text(values.get(key)) is not None:
            continue
        if key in template:
            values[key] = template[key]
    if _normalize_text(values.get("panel")) is None:
        panel = _normalize_text(template.get("panel"))
        values["panel"] = panel
        values["facp"] = panel


def _coalesce_with_master(value: object, master_value: object) -> object:
    return value if _normalize_text(value) is not None else master_value


def _next_sqlite_bigint_id(model) -> int | None:
    if "sqlite" not in (str(db.engine.url) or "").lower():
        return None
    return int(db.session.query(func.coalesce(func.max(model.id), 0)).scalar() or 0) + 1


class WorksheetAuditEventIdAllocator:
    """Explicit PKs for SQLite tests only; PostgreSQL uses the table sequence."""

    def __init__(self) -> None:
        self._next = _next_sqlite_bigint_id(MonthlyRouteWorksheetAuditEvent)

    def id_kwargs(self) -> dict[str, int]:
        if self._next is None:
            return {}
        assigned = {"id": self._next}
        self._next += 1
        return assigned


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


def _monitoring_company_record(
    mcid: int | None,
    mtsm: MonthlyTestingSiteMonth | None,
    ts: MonthlyTestingSite,
    loc: MonthlyRouteLocation | None,
) -> MonitoringCompany | None:
    if mcid is not None:
        if mtsm is not None and mtsm.monitoring_company is not None and int(mtsm.monitoring_company.id) == int(mcid):
            return mtsm.monitoring_company
        if ts.monitoring_company is not None and int(ts.monitoring_company.id) == int(mcid):
            return ts.monitoring_company
        return db.session.get(MonitoringCompany, int(mcid))
    return None


def _monitoring_labels(
    mtsm: MonthlyTestingSiteMonth | None,
    ts: MonthlyTestingSite,
    loc: MonthlyRouteLocation | None,
) -> tuple[str | None, str | None, int | None, str | None, MonitoringCompany | None]:
    mcid: int | None = None
    acct: str | None = None
    mon_notes: str | None = None
    company_name: str | None = None

    if mtsm is not None:
        mcid = int(mtsm.monitoring_company_id) if mtsm.monitoring_company_id is not None else None
        acct = _normalize_text(mtsm.monitoring_account_number)
        mon_notes = _normalize_text(mtsm.monitoring_notes)
        company_name = _normalize_text(mtsm.monitoring_company_name)
        if loc is not None:
            preview = master_template_fields(ts, loc)
            if mcid is None and preview.get("monitoring_company_id") is not None:
                mcid = int(preview["monitoring_company_id"])
            if acct is None:
                acct = _normalize_text(preview.get("monitoring_account_number"))
            if mon_notes is None:
                mon_notes = _normalize_text(preview.get("monitoring_notes"))
            if company_name is None:
                company_name = _normalize_text(preview.get("monitoring_company_name"))
    else:
        preview = master_template_fields(ts, loc) if loc is not None else {}
        mcid = int(ts.monitoring_company_id) if ts.monitoring_company_id is not None else None
        acct = _normalize_text(preview.get("monitoring_account_number") or ts.monitoring_account_number)
        mon_notes = _normalize_text(preview.get("monitoring_notes"))
        company_name = _normalize_text(preview.get("monitoring_company_name"))

    mc = _monitoring_company_record(mcid, mtsm, ts, loc)
    if mc is not None:
        company_name = _normalize_text(mc.name)
    elif not company_name and loc is not None:
        from app.monthly.site_field_template import _master_monitoring_company_name

        company_name = _master_monitoring_company_name(ts, loc)
    elif not company_name and ts.monitoring_company is not None:
        company_name = _normalize_text(ts.monitoring_company.name)

    return company_name, mon_notes, mcid, acct, mc


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


def _apply_history_outcome_to_base(
    base: dict[str, object],
    hist: MonthlyRouteTestHistory,
) -> None:
    """Copy sheet-derived visit outcome from history onto a primary stop-month row."""
    if hist.result_status is None:
        return
    base["result_status"] = hist.result_status
    base["skip_reason"] = hist.skip_reason
    base["sheet_time_in_raw"] = hist.sheet_time_in_raw
    base["sheet_time_out_raw"] = hist.sheet_time_out_raw
    base["source_value_raw"] = hist.source_value_raw
    if hist.session_route_stop_order is not None:
        base["session_route_stop_order"] = hist.session_route_stop_order


def _apply_history_outcome_to_row(
    row: MonthlyTestingSiteMonth,
    hist: MonthlyRouteTestHistory,
) -> None:
    """Copy sheet-derived visit outcome from history onto an existing primary stop-month row."""
    if hist.result_status is None or row.result_status is not None:
        return
    row.result_status = hist.result_status
    row.skip_reason = hist.skip_reason
    row.sheet_time_in_raw = hist.sheet_time_in_raw
    row.sheet_time_out_raw = hist.sheet_time_out_raw
    row.source_value_raw = hist.source_value_raw
    if hist.session_route_stop_order is not None and row.session_route_stop_order is None:
        row.session_route_stop_order = hist.session_route_stop_order


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
    include_history_gap_fill: bool = True,
) -> dict[str, object]:
    """Build insert/update payload for ``MonthlyTestingSiteMonth``."""
    if existing_row is not None:
        base = _snapshot_fields_from_mtsm(existing_row)
        _fill_snapshot_gaps_from_master(base, ts, loc)
        for key in _MTSM_OUTCOME_KEYS:
            base[key] = getattr(existing_row, key)
        if base.get("monitoring_notes") is None and location_hist is not None:
            base["monitoring_notes"] = _normalize_text(location_hist.monitoring_notes)
    else:
        template = master_template_fields(ts, loc)
        base = merge_template_with_prior_fallback(template, prior)
        base.update(_cleared_outcome_fields())
        base["run_comments"] = None
        base["office_job_comment"] = None
        base["office_attention"] = False
        base["prior_month_out_of_order_dismissed"] = False
        if primary and include_history_gap_fill:
            hist_seed = location_hist or _prior_history_for_location(int(loc.id), month_first)
            if hist_seed is not None:
                _fill_snapshot_gaps_from_history(base, hist_seed)

    if primary and location_hist is not None:
        _apply_history_outcome_to_base(base, location_hist)
    elif not primary:
        base["result_status"] = None
        base["skip_reason"] = None
        base["sheet_time_in_raw"] = None
        base["sheet_time_out_raw"] = None
        base["source_value_raw"] = None

    base["month_date"] = month_first
    base["test_monthly_route_id"] = route_id
    base["run_id"] = run_id
    if existing_row is not None:
        base["office_attention"] = bool(existing_row.office_attention)
        base["prior_month_out_of_order_dismissed"] = bool(
            existing_row.prior_month_out_of_order_dismissed
        )
    elif "office_attention" not in base:
        base["office_attention"] = False
    if "prior_month_out_of_order_dismissed" not in base:
        base["prior_month_out_of_order_dismissed"] = False
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


def route_month_has_worksheet_stops(route_id: int, month_first: date) -> bool:
    """True when at least one stop-month row exists for this route and calendar month."""
    row = (
        db.session.query(MonthlyTestingSiteMonth.id)
        .filter(
            MonthlyTestingSiteMonth.month_date == month_first,
            MonthlyTestingSiteMonth.test_monthly_route_id == route_id,
        )
        .limit(1)
        .first()
    )
    return row is not None


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
                # Row already exists — only link route metadata. Do not re-seed snapshot
                # fields on read (run_details prep load); that overwrote office prep edits.
                if row.run_id is None and run_id is not None:
                    row.run_id = run_id
                if row.test_monthly_route_id is None:
                    row.test_monthly_route_id = route_id
                if is_primary and loc_hist is not None:
                    _apply_history_outcome_to_row(row, loc_hist)
                continue
    db.session.flush()


def apply_session_stop_order_from_history_for_route_month(
    route_id: int,
    month_first: date,
    *,
    overwrite: bool = False,
) -> int:
    """Copy ``session_route_stop_order`` from history onto worksheet stops at each location.

    When ``overwrite`` is false (default), only rows with a null session order are updated.
    CSV import passes ``overwrite=True`` so run review always follows the sheet ``#`` column
    without changing library ``route_stop_order``.
    """
    locs = _route_locations(route_id)
    if not locs:
        return 0
    loc_ids = [int(loc.id) for loc in locs]
    hist_by_loc = _history_for_locations(loc_ids, month_first)
    updated = 0
    for loc in locs:
        hist = hist_by_loc.get(int(loc.id))
        if hist is None or hist.session_route_stop_order is None:
            continue
        order = int(hist.session_route_stop_order)
        ts_rows = sync_testing_sites_from_legacy(loc)
        if not ts_rows:
            continue
        ts_ids = [int(t.id) for t in ts_rows]
        rows = (
            db.session.query(MonthlyTestingSiteMonth)
            .filter(
                MonthlyTestingSiteMonth.month_date == month_first,
                MonthlyTestingSiteMonth.monthly_testing_site_id.in_(ts_ids),
            )
            .all()
        )
        for row in rows:
            if not overwrite and row.session_route_stop_order is not None:
                continue
            if row.session_route_stop_order == order:
                continue
            row.session_route_stop_order = order
            updated += 1
    db.session.flush()
    return updated


def upsert_stop_month_from_csv_import(
    *,
    ts: MonthlyTestingSite,
    loc: MonthlyRouteLocation,
    route_id: int,
    run_id: int,
    month_first: date,
    session_route_stop_order: int,
    sheet_times: SheetTimeImportRow,
    panel: str | None,
    panel_location: str | None,
    ring_detail: str | None,
    keys_text: str | None,
    annual_month: str | None,
    testing_procedures: str | None,
    inspection_tech_notes: str | None,
    monitoring_notes: str | None,
    monitoring_account_number: str | None,
    monitoring_company_id: int | None,
    sheet_time_in_raw: str | None,
    sheet_time_out_raw: str | None,
    preserve_existing_outcome: bool = True,
) -> MonthlyTestingSiteMonth:
    """Write or update one ``MonthlyTestingSiteMonth`` row from a route inspection CSV row."""
    ts_id = int(ts.id)
    row = (
        MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=ts_id,
            month_date=month_first,
        ).one_or_none()
    )

    upsert_result_status = sheet_times.result_status
    upsert_skip_reason = sheet_times.skip_reason
    upsert_source_value_raw = sheet_times.source_value_raw
    if (
        preserve_existing_outcome
        and row is not None
        and row.result_status is not None
    ):
        upsert_result_status = row.result_status
        upsert_skip_reason = row.skip_reason
        upsert_source_value_raw = row.source_value_raw
        upsert_time_in = row.sheet_time_in_raw
        upsert_time_out = row.sheet_time_out_raw
    else:
        upsert_time_in = sheet_time_in_raw
        upsert_time_out = sheet_time_out_raw

    snapshot_values: dict[str, object] = {
        "annual_month": annual_month,
        "ring": ring_detail,
        "key_number": keys_text,
        "panel": panel,
        "facp": panel,
        "panel_location": panel_location,
        "testing_procedures": testing_procedures,
        "inspection_tech_notes": inspection_tech_notes,
        "monitoring_notes": monitoring_notes,
        "monitoring_account_number": monitoring_account_number,
        "monitoring_company_id": monitoring_company_id,
        "property_management_company": loc.property_management_company,
        "building_name": ts.building_name or loc.building,
        "result_status": upsert_result_status,
        "skip_reason": upsert_skip_reason,
        "source_value_raw": upsert_source_value_raw,
        "sheet_time_in_raw": upsert_time_in,
        "sheet_time_out_raw": upsert_time_out,
        "session_route_stop_order": session_route_stop_order,
        "test_monthly_route_id": route_id,
        "run_id": run_id,
        "month_date": month_first,
    }

    if row is None:
        prior = (
            MonthlyTestingSiteMonth.query.filter(
                MonthlyTestingSiteMonth.monthly_testing_site_id == ts_id,
                MonthlyTestingSiteMonth.month_date < month_first,
            )
            .order_by(MonthlyTestingSiteMonth.month_date.desc())
            .first()
        )
        base = seed_stop_month_fields(
            ts,
            loc,
            prior,
            route_id=route_id,
            run_id=run_id,
            month_first=month_first,
            primary=False,
            location_hist=None,
            include_history_gap_fill=False,
        )
        base.update(snapshot_values)
        base["monthly_testing_site_id"] = ts_id
        kw = dict(base)
        nid = _next_sqlite_bigint_id(MonthlyTestingSiteMonth)
        if nid is not None:
            kw["id"] = nid
        row = MonthlyTestingSiteMonth(**kw)
        db.session.add(row)
    else:
        for key, value in snapshot_values.items():
            if key in SNAPSHOT_STRING_FIELDS or key in SNAPSHOT_TEXT_FIELDS:
                setattr(row, key, value)
            elif key in (
                "result_status",
                "skip_reason",
                "source_value_raw",
                "sheet_time_in_raw",
                "sheet_time_out_raw",
                "session_route_stop_order",
                "test_monthly_route_id",
                "run_id",
                "monitoring_company_id",
            ):
                setattr(row, key, value)

    db.session.flush()
    return row


def dismiss_prior_month_out_of_order_for_testing_sites(
    route_id: int,
    month_first: date,
    testing_site_ids: Iterable[int],
) -> int:
    """Persist office resolution of prior-month out-of-order prep hints."""
    ids = {int(tid) for tid in testing_site_ids}
    if not ids:
        return 0
    rows = (
        MonthlyTestingSiteMonth.query.filter(
            MonthlyTestingSiteMonth.month_date == month_first,
            MonthlyTestingSiteMonth.test_monthly_route_id == int(route_id),
            MonthlyTestingSiteMonth.monthly_testing_site_id.in_(ids),
        )
        .all()
    )
    updated = 0
    for row in rows:
        if not bool(row.prior_month_out_of_order_dismissed):
            row.prior_month_out_of_order_dismissed = True
            updated += 1
    if updated:
        db.session.flush()
    return updated


def sync_session_route_stop_order_from_library_route(route_id: int) -> int:
    """After library ``route_stop_order`` changes, align worksheet session order on that route."""
    locs = _route_locations(route_id)
    if not locs:
        return 0
    ts_by_loc = _testing_sites_by_location_bulk(locs)
    updated = 0
    for loc in locs:
        if loc.route_stop_order is None:
            continue
        order = int(loc.route_stop_order)
        ts_rows = ts_by_loc.get(int(loc.id), [])
        if not ts_rows:
            continue
        ts_ids = [int(t.id) for t in ts_rows]
        rows = (
            MonthlyTestingSiteMonth.query.filter(
                MonthlyTestingSiteMonth.monthly_testing_site_id.in_(ts_ids),
                MonthlyTestingSiteMonth.test_monthly_route_id == int(route_id),
            )
            .all()
        )
        for row in rows:
            if row.session_route_stop_order != order:
                row.session_route_stop_order = order
                updated += 1
    if updated:
        db.session.flush()
    return updated


def _mtsm_has_field_progress(mtsm: MonthlyTestingSiteMonth) -> bool:
    from app.db_models import MonthlyStopClockEvent

    rs = (mtsm.result_status or "").strip().lower()
    if rs in ("tested", "skipped"):
        return True
    if _normalize_text(mtsm.test_outcome):
        return True
    if _normalize_text(mtsm.sheet_time_in_raw) or _normalize_text(mtsm.sheet_time_out_raw):
        return True
    if _normalize_text(mtsm.run_comments) is not None:
        return True
    return (
        MonthlyStopClockEvent.query.filter_by(monthly_testing_site_month_id=int(mtsm.id)).count()
        > 0
    )


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
                existing_row=row,
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
    hist: MonthlyRouteTestHistory | None = None,
) -> tuple[int, int, int, int]:
    sess = mtsm.session_route_stop_order if mtsm is not None else None
    if sess is None and hist is not None and hist.session_route_stop_order is not None:
        sess = int(hist.session_route_stop_order)
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
    run: MonthlyRouteRun | None = None,
    include_portal_extras: bool = True,
    billing_status: str | None = None,
    site_count: int = 1,
    site_index: int = 0,
) -> dict[str, object]:
    company, mon_notes, mcid, mon_acct, mc = _monitoring_labels(mtsm, ts, loc)
    panel = None
    ring = None
    key_number = None
    annual_month = None
    procedures = None
    tech_notes = None
    run_comments = None
    office_job_comment = None
    office_attention = False
    prior_month_out_of_order_dismissed = False
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
        office_job_comment = mtsm.office_job_comment
        office_attention = bool(mtsm.office_attention)
        prior_month_out_of_order_dismissed = bool(mtsm.prior_month_out_of_order_dismissed)
        result_status = mtsm.result_status
        skip_reason = mtsm.skip_reason
        test_outcome = mtsm.test_outcome
        skip_category = mtsm.skip_category
        skip_note = mtsm.skip_note
        confirmed_no_deficiencies = bool(mtsm.confirmed_no_deficiencies)
        time_in = mtsm.sheet_time_in_raw
        time_out = mtsm.sheet_time_out_raw
        sess_order = mtsm.session_route_stop_order
        version = mtsm.updated_at.isoformat() if mtsm.updated_at else None
        row_id = int(mtsm.id)
        pmc = _normalize_text(mtsm.property_management_company)
        building = _normalize_text(mtsm.building_name)
        panel_loc = mtsm.panel_location
        door = mtsm.door_code
        master = master_template_fields(ts, loc)
        ring = _coalesce_with_master(ring, master.get("ring"))
        key_number = _coalesce_with_master(key_number, master.get("key_number"))
        annual_month = _coalesce_with_master(annual_month, master.get("annual_month"))
        procedures = _coalesce_with_master(procedures, master.get("testing_procedures"))
        tech_notes = _coalesce_with_master(tech_notes, master.get("inspection_tech_notes"))
        panel = panel or _normalize_text(master.get("panel"))
        pmc = pmc or _normalize_text(master.get("property_management_company"))
        building = building or _normalize_text(master.get("building_name"))
        panel_loc = _coalesce_with_master(panel_loc, master.get("panel_location"))
        door = _coalesce_with_master(door, master.get("door_code"))
    else:
        preview = master_template_fields(ts, loc)
        panel = _normalize_text(preview.get("panel"))
        ring = preview.get("ring")
        key_number = preview.get("key_number")
        annual_month = preview.get("annual_month")
        procedures = preview.get("testing_procedures")
        tech_notes = preview.get("inspection_tech_notes")
        run_comments = None
        office_job_comment = None
        office_attention = False
        prior_month_out_of_order_dismissed = False
        pmc = _normalize_text(preview.get("property_management_company"))
        building = _normalize_text(preview.get("building_name"))
        panel_loc = preview.get("panel_location")
        door = preview.get("door_code")
        result_status = None
        skip_reason = None
        test_outcome = None
        skip_category = None
        skip_note = None
        confirmed_no_deficiencies = False
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
        "latitude": float(loc.latitude) if loc.latitude is not None else None,
        "longitude": float(loc.longitude) if loc.longitude is not None else None,
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
        "monitoring_company_id": mcid,
        "monitoring_company_record": serialize_monitoring_company(mc),
        "monitoring_account_number": mon_acct,
        "monitoring_notes": mon_notes,
        "result_status": result_status,
        "skip_reason": skip_reason,
        "test_outcome": test_outcome,
        "skip_category": skip_category,
        "skip_note": skip_note,
        "confirmed_no_deficiencies": confirmed_no_deficiencies,
        "testing_procedures": procedures,
        "inspection_tech_notes": tech_notes,
        "run_comments": run_comments,
        "office_job_comment": office_job_comment,
        "office_attention": office_attention,
        "prior_month_out_of_order_dismissed": prior_month_out_of_order_dismissed,
        "time_in": time_in,
        "time_out": time_out,
        "route_stop_order": library_order,
        "session_route_stop_order": int(sess_order) if sess_order is not None else None,
        "stop_number": stop_number,
        "version_updated_at": version,
    }
    if include_portal_extras:
        from app.monthly.portal_workflow import portal_workflow_extras_for_stop

        stop.update(
            portal_workflow_extras_for_stop(
                mtsm,
                ts,
                loc,
                route_id=route_id,
                month_first=month_first,
                run=run,
            )
        )
    else:
        from app.monthly.portal_workflow import is_legacy_outcome, portal_run_is_read_only

        stop.update(
            {
                "clock_events": [],
                "deficiencies": [],
                "has_run_changes": False,
                "billing_status": billing_status,
                "is_legacy_outcome": is_legacy_outcome(mtsm),
                "portal_read_only": portal_run_is_read_only(run),
                "is_legacy_run": portal_run_is_read_only(run),
            }
        )
    from app.monthly.testing_site_display import enrich_stop_display_fields

    enrich_stop_display_fields(
        stop,
        ts,
        loc,
        site_count=site_count,
        site_index=site_index,
    )
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
        for index, ts in enumerate(ts_rows):
            stop_num += 1
            stops.append(
                serialize_worksheet_stop(
                    ts,
                    loc,
                    None,
                    route_id=route_id,
                    month_first=month_first,
                    stop_number=stop_num,
                    site_count=len(ts_rows),
                    site_index=index,
                )
            )
    return stops


def _testing_sites_by_location_bulk(
    locs: list[MonthlyRouteLocation],
) -> dict[int, list[MonthlyTestingSite]]:
    """Load testing sites for many route locations in O(1) queries (fallback sync per missing site)."""
    if not locs:
        return {}
    loc_ids = [int(loc.id) for loc in locs]
    site_rows = MonthlySite.query.filter(
        MonthlySite.legacy_monthly_route_location_id.in_(loc_ids)
    ).all()
    site_by_loc_id = {int(s.legacy_monthly_route_location_id): s for s in site_rows}
    site_ids = [int(s.id) for s in site_rows]
    ts_by_site_id: dict[int, list[MonthlyTestingSite]] = {}
    if site_ids:
        for ts in (
            MonthlyTestingSite.query.options(joinedload(MonthlyTestingSite.monitoring_company))
            .filter(MonthlyTestingSite.monthly_site_id.in_(site_ids))
            .order_by(MonthlyTestingSite.sort_order.asc(), MonthlyTestingSite.id.asc())
            .all()
        ):
            ts_by_site_id.setdefault(int(ts.monthly_site_id), []).append(ts)

    out: dict[int, list[MonthlyTestingSite]] = {}
    for loc in locs:
        lid = int(loc.id)
        site = site_by_loc_id.get(lid)
        if site is None:
            ts_rows = sync_testing_sites_from_legacy(loc)
            out[lid] = ts_rows
            continue
        ts_rows = ts_by_site_id.get(int(site.id), [])
        if not ts_rows:
            ts_rows = sync_testing_sites_from_legacy(loc)
        out[lid] = ts_rows
    return out


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
    *,
    include_portal_extras: bool = True,
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
    ts_by_loc = _testing_sites_by_location_bulk([loc for _, _, loc in pairs] if pairs else [])
    for idx, (hist, ts, loc) in enumerate(pairs, start=1):
        ts_rows = ts_by_loc.get(int(loc.id), [])
        site_count = len(ts_rows) or 1
        site_index = next(
            (i for i, row in enumerate(ts_rows) if int(row.id) == int(ts.id)),
            0,
        )
        mtsm = (
            MonthlyTestingSiteMonth.query.filter_by(
                monthly_testing_site_id=int(ts.id),
                month_date=month_first,
            )
            .one_or_none()
        )
        billing_status = None
        if not include_portal_extras:
            billing_status = _normalize_text(hist.billing_status)
        stop = serialize_worksheet_stop(
            ts,
            loc,
            mtsm,
            route_id=route_id,
            month_first=month_first,
            stop_number=idx,
            include_portal_extras=include_portal_extras,
            billing_status=billing_status,
            site_count=site_count,
            site_index=site_index,
        )
        if mtsm is None:
            stop = _overlay_history_on_stop(stop, hist, ts=ts, loc=loc)
        out.append(stop)
    return out


def _worksheet_stop_pairs_for_route_month(
    route_id: int,
    month_first: date,
    *,
    locs: list[MonthlyRouteLocation] | None = None,
    ts_by_loc: dict[int, list[MonthlyTestingSite]] | None = None,
) -> list[tuple[MonthlyTestingSiteMonth | None, MonthlyTestingSite, MonthlyRouteLocation]]:
    """Ordered (mtsm, testing site, location) tuples for one route month — no serialization."""
    if locs is None:
        locs = _route_locations(route_id)
    if not locs:
        return []
    loc_by_id = {int(loc.id): loc for loc in locs}

    if ts_by_loc is None:
        ts_by_loc = _testing_sites_by_location_bulk(locs)

    ts_rows: list[MonthlyTestingSite] = []
    for loc in locs:
        ts_rows.extend(ts_by_loc.get(int(loc.id), []))
    if not ts_rows:
        return []

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

    loc_ids = [int(loc.id) for loc in locs]
    hist_by_loc = _history_for_locations(loc_ids, month_first)
    pairs.sort(
        key=lambda item: _stop_sort_key(
            item[0],
            item[1],
            item[2],
            hist_by_loc.get(int(item[2].id)),
        )
    )
    return pairs


def worksheet_stop_number_for_site(
    route_id: int,
    month_first: date,
    testing_site_id: int,
    *,
    pairs: list[tuple[MonthlyTestingSiteMonth | None, MonthlyTestingSite, MonthlyRouteLocation]]
    | None = None,
) -> int:
    """1-based route stop number without building the full worksheet payload."""
    if pairs is None:
        pairs = _worksheet_stop_pairs_for_route_month(route_id, month_first)
    for idx, (_mtsm, ts, _loc) in enumerate(pairs, start=1):
        if int(ts.id) == int(testing_site_id):
            return idx
    return 0


def resolve_worksheet_stop_number(
    route_id: int,
    month_first: date,
    testing_site_id: int,
    *,
    hint: int | None = None,
) -> int:
    """Use client ``stop_number`` when valid to avoid re-sorting the whole route on PATCH."""
    if isinstance(hint, int) and int(hint) > 0:
        return int(hint)
    return worksheet_stop_number_for_site(route_id, month_first, testing_site_id)


_OFFICE_PREP_ONLY_PATCH_FIELDS = frozenset({
    "office_job_comment",
    "office_attention",
    "prior_month_out_of_order_dismissed",
})


def serialize_worksheet_stop_office_prep_patch(
    ts: MonthlyTestingSite,
    loc: MonthlyRouteLocation,
    mtsm: MonthlyTestingSiteMonth,
    *,
    month_first: date,
    stop_number: int,
    site_count: int = 1,
    site_index: int = 0,
) -> dict[str, object]:
    """Minimal worksheet stop JSON for office run-prep PATCH (no portal extras / master merge)."""
    company, mon_notes, mcid, mon_acct, mc = _monitoring_labels(mtsm, ts, loc)
    panel = _normalize_text(mtsm.panel) or _normalize_text(mtsm.facp)
    stop: dict[str, object] = {
        "testing_site_id": int(ts.id),
        "location_id": int(loc.id),
        "month_date": month_first.isoformat(),
        "display_address": _display_address(loc, int(loc.id)),
        "latitude": float(loc.latitude) if loc.latitude is not None else None,
        "longitude": float(loc.longitude) if loc.longitude is not None else None,
        "building_name": _normalize_text(mtsm.building_name),
        "property_management_company": _normalize_text(mtsm.property_management_company),
        "label": _normalize_text(ts.label),
        "panel": panel,
        "panel_location": mtsm.panel_location,
        "door_code": mtsm.door_code,
        "ring": mtsm.ring,
        "key_number": mtsm.key_number,
        "annual_month": mtsm.annual_month,
        "monitoring_company": company,
        "monitoring_company_id": mcid,
        "monitoring_company_record": serialize_monitoring_company(mc),
        "monitoring_account_number": mon_acct,
        "monitoring_notes": mon_notes,
        "testing_procedures": mtsm.testing_procedures,
        "inspection_tech_notes": mtsm.inspection_tech_notes,
        "run_comments": mtsm.run_comments,
        "office_job_comment": mtsm.office_job_comment,
        "office_attention": bool(mtsm.office_attention),
        "prior_month_out_of_order_dismissed": bool(mtsm.prior_month_out_of_order_dismissed),
        "stop_number": int(stop_number),
    }
    from app.monthly.testing_site_display import enrich_stop_display_fields

    return enrich_stop_display_fields(
        stop,
        ts,
        loc,
        site_count=site_count,
        site_index=site_index,
    )


def worksheet_stops_for_route_month(
    route_id: int,
    month_first: date,
    *,
    include_portal_extras: bool = True,
) -> list[dict[str, object]]:
    """Load and sort portal worksheet stops for an active run month."""
    locs = _route_locations(route_id)
    if not locs:
        return []
    loc_by_id = {int(loc.id): loc for loc in locs}
    loc_ids = list(loc_by_id.keys())
    hist_by_loc = _history_for_locations(loc_ids, month_first)
    ts_by_loc = _testing_sites_by_location_bulk(locs)

    if not any(ts_by_loc.values()):
        return worksheet_stops_from_attributed_history(
            route_id,
            month_first,
            include_portal_extras=include_portal_extras,
        )

    pairs = _worksheet_stop_pairs_for_route_month(
        route_id,
        month_first,
        locs=locs,
        ts_by_loc=ts_by_loc,
    )

    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()

    out: list[dict[str, object]] = []
    for idx, (mtsm, ts, loc) in enumerate(pairs, start=1):
        hist = hist_by_loc.get(int(loc.id))
        ts_rows = ts_by_loc.get(int(loc.id), [])
        site_count = len(ts_rows) or 1
        site_index = next(
            (i for i, row in enumerate(ts_rows) if int(row.id) == int(ts.id)),
            0,
        )
        primary = primary_testing_site(ts_rows)
        is_primary = primary is not None and int(primary.id) == int(ts.id)
        billing_status = None
        if not include_portal_extras and hist is not None:
            billing_status = _normalize_text(hist.billing_status)
        stop = serialize_worksheet_stop(
            ts,
            loc,
            mtsm,
            route_id=route_id,
            month_first=month_first,
            stop_number=idx,
            run=run,
            include_portal_extras=include_portal_extras,
            billing_status=billing_status,
            site_count=site_count,
            site_index=site_index,
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


def _is_annual_for_month(month_first: date, annual_month: object) -> bool:
    """True when the site's annual month matches this worksheet month (portal parity)."""
    annual = (str(annual_month).strip().lower() if annual_month is not None else "")
    if not annual or annual == "to":
        return False
    full = month_first.strftime("%B").lower()
    short = month_first.strftime("%b").lower()
    return annual in {full, short}


def _sheet_skip_reason_is_annual(skip_reason: object) -> bool:
    s = (str(skip_reason).strip().lower() if skip_reason is not None else "")
    return s in {"annual", "annual_booked"}


_PORTAL_OUTCOME_COUNT_KEYS = (
    "all_good",
    "passed_with_problems",
    "failed",
    "skipped",
)


def _worksheet_stop_portal_outcome(stop: dict[str, object]) -> str | None:
    """Portal outcome for run-details KPIs (stop grain), with legacy fallback."""
    outcome = (str(stop.get("test_outcome") or "")).strip().lower()
    if outcome in _PORTAL_OUTCOME_COUNT_KEYS:
        return outcome
    rs = (str(stop.get("result_status") or "")).strip().lower()
    if rs == "tested":
        return "all_good"
    if rs == "skipped":
        return "skipped"
    return None


def run_details_counts_for_route_month(route_id: int, month_first: date) -> dict[str, int]:
    """Stop-level KPI counts from portal ``test_outcome`` (legacy ``result_status`` fallback)."""
    from app.monthly.run_details_review import run_details_counts_from_stop_months

    return run_details_counts_from_stop_months(route_id, month_first)


def _run_details_counts_from_stops(stops: list[dict[str, object]]) -> dict[str, int]:
    """Shared counter for lean stop dicts."""
    counts = {
        "all_good_count": 0,
        "passed_with_problems_count": 0,
        "failed_count": 0,
        "skipped_count": 0,
    }
    for stop in stops:
        outcome = _worksheet_stop_portal_outcome(stop)
        if outcome is None:
            continue
        key = f"{outcome}_count"
        if key in counts:
            counts[key] += 1
    return counts


def run_details_counts_for_route_month_legacy(route_id: int, month_first: date) -> dict[str, int]:
    """Full worksheet serialization path (tests / legacy callers)."""
    stops = worksheet_stops_for_route_month(route_id, month_first)
    return _run_details_counts_from_stops(stops)


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
    """Worksheet stops for office run review: updates, skips, comments, tested, and annual month."""
    all_stops = worksheet_stops_for_route_month(route_id, month_first)
    filtered: list[dict[str, object]] = []
    for stop in all_stops:
        lid = int(stop["location_id"])
        rs = (str(stop.get("result_status") or "")).strip().lower()
        has_run_comments = _normalize_text(stop.get("run_comments")) is not None
        is_annual_month = _is_annual_for_month(month_first, stop.get("annual_month"))
        has_outcome = _normalize_text(stop.get("test_outcome")) is not None
        has_updates = (
            lid in property_change_location_ids or rs == "skipped" or has_run_comments
        )
        if has_updates or rs == "tested" or is_annual_month or has_outcome:
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
        MonthlyTestingSiteMonth.query.options(joinedload(MonthlyTestingSiteMonth.monitoring_company))
        .filter_by(
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


def sync_mtsm_snapshots_from_history_for_location(
    route_id: int,
    month_first: date,
    loc: MonthlyRouteLocation,
    hist: MonthlyRouteTestHistory,
) -> None:
    """Push legacy staff-worksheet row edits onto portal stop-month rows (tech portal reads MTSM)."""
    site = ensure_monthly_site_for_location(loc)
    ts_rows = (
        MonthlyTestingSite.query.filter_by(monthly_site_id=int(site.id))
        .order_by(MonthlyTestingSite.sort_order.asc(), MonthlyTestingSite.id.asc())
        .all()
    )
    if not ts_rows:
        return
    panel = _normalize_text(hist.facp)
    for ts in ts_rows:
        mtsm = (
            MonthlyTestingSiteMonth.query.filter_by(
                monthly_testing_site_id=int(ts.id),
                month_date=month_first,
                test_monthly_route_id=route_id,
            )
            .one_or_none()
        )
        if mtsm is None:
            continue
        for mtsm_key, hist_key in _HISTORY_SNAPSHOT_TO_MTSM:
            setattr(mtsm, mtsm_key, getattr(hist, hist_key))
        if panel is not None:
            mtsm.panel = panel
            mtsm.facp = panel


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
    from app.monthly.portal_workflow import dual_write_legacy_result_fields

    dual_write_legacy_result_fields(mtsm)
    hist.result_status = mtsm.result_status
    hist.skip_reason = mtsm.skip_reason
    hist.sheet_time_in_raw = mtsm.sheet_time_in_raw
    hist.sheet_time_out_raw = mtsm.sheet_time_out_raw
    hist.session_route_stop_order = mtsm.session_route_stop_order
    hist.testing_procedures = mtsm.testing_procedures
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


_HISTORY_RUN_RESET_ATTRS = (
    "result_status",
    "skip_reason",
    "source_value_raw",
    "sheet_time_in_raw",
    "sheet_time_out_raw",
    "session_route_stop_order",
    "facp",
    "ring",
    "key_number",
    "annual_month",
    "testing_procedures",
    "inspection_tech_notes",
    "monitoring_notes",
    "billing_status",
)

_FRESH_STOP_MONTH_SKIP_KEYS = frozenset({"month_date", "monthly_testing_site_id"})


def _history_row_has_run_scoped_data(hist: MonthlyRouteTestHistory) -> bool:
    for attr in _HISTORY_RUN_RESET_ATTRS:
        val = getattr(hist, attr, None)
        if val is None:
            continue
        if attr == "billing_status":
            billing = (str(val) if val is not None else "").strip().lower()
            if billing in {"", "unset", "legacy"}:
                continue
            return True
        if isinstance(val, str) and not val.strip():
            continue
        return True
    return False


def _clear_history_run_scoped_fields(hist: MonthlyRouteTestHistory) -> None:
    billing_locked = (_normalize_text(hist.billing_status) or "").lower() == "legacy"
    for attr in _HISTORY_RUN_RESET_ATTRS:
        if attr == "billing_status" and billing_locked:
            continue
        setattr(hist, attr, None)


def _apply_fresh_stop_month_fields(
    row: MonthlyTestingSiteMonth,
    fresh: dict[str, object],
    *,
    route_id: int,
    run_id: int | None,
) -> None:
    for key, val in fresh.items():
        if key in _FRESH_STOP_MONTH_SKIP_KEYS:
            continue
        setattr(row, key, val)
    row.test_monthly_route_id = route_id
    row.run_id = run_id


def _is_latest_run_for_location(location_id: int, month_first: date) -> bool:
    latest = (
        db.session.query(func.max(MonthlyRouteTestHistory.month_date))
        .filter(MonthlyRouteTestHistory.location_id == location_id)
        .execution_options(autoflush=False)
        .scalar()
    )
    return latest is None or month_first >= latest


def regenerate_prep_stops_from_latest_data(
    route_id: int,
    month_first: date,
    run: MonthlyRouteRun,
) -> int:
    """Office prep: overwrite stop-month snapshots from library master + prior run month.

    Preserves ``office_attention`` flags. Does not copy prior-month history gaps when a
    prior ``MonthlyTestingSiteMonth`` row exists (avoids resurrecting cleared notes).
    """
    locs = _route_locations(route_id)
    if not locs:
        return 0
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

    regenerated = 0
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
            office_attention = bool(row.office_attention) if row is not None else False
            prior_month_out_of_order_dismissed = (
                bool(row.prior_month_out_of_order_dismissed) if row is not None else False
            )
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
                include_history_gap_fill=prior is None,
            )
            fresh["office_attention"] = office_attention
            fresh["prior_month_out_of_order_dismissed"] = prior_month_out_of_order_dismissed
            if row is None:
                fields = dict(fresh)
                fields["monthly_testing_site_id"] = ts_id
                nid = _next_sqlite_bigint_id(MonthlyTestingSiteMonth)
                if nid is not None:
                    fields["id"] = nid
                try:
                    with db.session.begin_nested():
                        db.session.add(MonthlyTestingSiteMonth(**fields))
                    regenerated += 1
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
            _apply_fresh_stop_month_fields(row, fresh, route_id=route_id, run_id=run_id)
            regenerated += 1
            if is_primary:
                sync_primary_history_from_stop(row, loc, route_id, month_first)
    db.session.flush()
    return regenerated


def _reseed_stop_month_rows_from_master(
    route_id: int,
    month_first: date,
    run: MonthlyRouteRun | None,
) -> int:
    """Replace run-month stop rows with master template + prior-month fallback (no run progress)."""
    locs = _route_locations(route_id)
    if not locs:
        return 0
    loc_ids = [int(loc.id) for loc in locs]
    hist_by_loc = _history_for_locations(loc_ids, month_first)
    run_id = int(run.id) if run is not None else None

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

    reseeded = 0
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
                    reseeded += 1
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
            _apply_fresh_stop_month_fields(row, fresh, route_id=route_id, run_id=run_id)
            reseeded += 1
            if is_primary:
                sync_primary_history_from_stop(row, loc, route_id, month_first)
    db.session.flush()
    return reseeded


def _delete_clock_events_for_route_month(route_id: int, month_first: date) -> int:
    """Remove portal clock event rows for every stop on a route-month."""
    from app.db_models import MonthlyStopClockEvent

    locs = _route_locations(route_id)
    if not locs:
        return 0

    all_ts_ids: list[int] = []
    for loc in locs:
        site = ensure_monthly_site_for_location(loc)
        ts_rows = sync_testing_sites_from_legacy(loc)
        if not ts_rows:
            ts_rows = (
                MonthlyTestingSite.query.filter_by(monthly_site_id=int(site.id))
                .order_by(MonthlyTestingSite.sort_order.asc(), MonthlyTestingSite.id.asc())
                .all()
            )
        all_ts_ids.extend(int(t.id) for t in ts_rows)

    if not all_ts_ids:
        return 0

    mtsm_ids = [
        int(row.id)
        for row in MonthlyTestingSiteMonth.query.filter(
            MonthlyTestingSiteMonth.month_date == month_first,
            MonthlyTestingSiteMonth.monthly_testing_site_id.in_(all_ts_ids),
        ).all()
    ]
    if not mtsm_ids:
        return 0

    deleted = (
        MonthlyStopClockEvent.query.filter(
            MonthlyStopClockEvent.monthly_testing_site_month_id.in_(mtsm_ids),
        ).delete(synchronize_session=False)
    )
    return int(deleted or 0)


def reset_worksheet_run_for_route_month(
    route_id: int,
    month_first: date,
    run: MonthlyRouteRun | None,
) -> dict[str, int]:
    """Clear all run-scoped worksheet progress and property edits for one route-month.

    Deletes worksheet audit events, clears attributed history (including per-location billing
    decisions except locked legacy billing), re-seeds stop-month rows from library master, and
    mirrors primary stops to library when this is the latest run month.
    """
    deleted_audits = (
        MonthlyRouteWorksheetAuditEvent.query.filter_by(
            monthly_route_id=route_id,
            month_date=month_first,
        ).delete(synchronize_session=False)
    )

    cleared_history = 0
    for hist in _attributed_history_for_route_month(route_id, month_first):
        if _history_row_has_run_scoped_data(hist):
            cleared_history += 1
        _clear_history_run_scoped_fields(hist)

    deleted_clock_events = _delete_clock_events_for_route_month(route_id, month_first)

    reseeded_stops = _reseed_stop_month_rows_from_master(route_id, month_first, run)

    mirrored = 0
    for loc in _route_locations(route_id):
        if not _is_latest_run_for_location(int(loc.id), month_first):
            continue
        ts_list = _testing_sites_for_location(loc)
        primary = primary_testing_site(ts_list)
        if primary is None:
            continue
        mtsm = (
            MonthlyTestingSiteMonth.query.filter_by(
                monthly_testing_site_id=int(primary.id),
                month_date=month_first,
            )
            .one_or_none()
        )
        if mtsm is None:
            continue
        mirror_mtsm_snapshot_to_primary_master(primary, mtsm)
        push_primary_testing_site_display_to_legacy(loc, primary)
        mirrored += 1

    return {
        "deleted_audit_events": int(deleted_audits or 0),
        "cleared_history_rows": cleared_history,
        "deleted_clock_events": deleted_clock_events,
        "reseeded_stops": reseeded_stops,
        "mirrored_library_locations": mirrored,
    }


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
    "office_job_comment": "office_job_comment",
    "office_attention": "office_attention",
    "prior_month_out_of_order_dismissed": "prior_month_out_of_order_dismissed",
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
    "monitoring_company_id": "monitoring_company_id",
    "monitoring_account_number": "monitoring_account_number",
    "monitoring_notes": "monitoring_notes",
    "monitoring_company": "monitoring_company_name",
}


def sync_mtsm_monitoring_company_name(mtsm: MonthlyTestingSiteMonth) -> None:
    mcid = mtsm.monitoring_company_id
    if mcid is None:
        return
    mc = db.session.get(MonitoringCompany, int(mcid))
    mtsm.monitoring_company_name = (mc.name or "").strip() if mc is not None else None


def apply_worksheet_stop_field_change(
    mtsm: MonthlyTestingSiteMonth,
    field_name: str,
    raw_value: object,
) -> tuple[bool, str | None]:
    """Apply one stop PATCH field to ``mtsm``. Returns ``(changed, error_message)``."""
    if field_name not in STOP_PATCH_FIELD_MAP:
        return False, f"Unsupported worksheet field: {field_name}"
    attr_name = STOP_PATCH_FIELD_MAP[field_name]

    if field_name == "monitoring_company":
        import logging

        logging.getLogger(__name__).warning(
            "Deprecated monitoring_company text PATCH on worksheet stop; use monitoring_company_id"
        )
        return False, "monitoring_company text is deprecated; use monitoring_company_id"

    if field_name == "monitoring_company_id":
        if raw_value is None or raw_value == "":
            new_id = None
        else:
            try:
                new_id = int(raw_value)
            except (TypeError, ValueError):
                return False, "monitoring_company_id must be an integer or null"
            if db.session.get(MonitoringCompany, new_id) is None:
                return False, "monitoring company not found"
        if mtsm.monitoring_company_id == new_id:
            return False, None
        mtsm.monitoring_company_id = new_id
        mc = db.session.get(MonitoringCompany, new_id) if new_id is not None else None
        mtsm.monitoring_company_name = (mc.name or "").strip() if mc is not None else None
        return True, None

    if field_name == "panel" and raw_value is not None:
        new_val = _normalize_text(raw_value)
        old_panel = _normalize_text(mtsm.panel) or _normalize_text(mtsm.facp)
        if old_panel == new_val:
            return False, None
        mtsm.panel = new_val
        mtsm.facp = new_val
        return True, None

    if field_name == "office_attention":
        if raw_value in (None, "", False, 0, "0", "false", "False"):
            new_bool = False
        elif raw_value in (True, 1, "1", "true", "True"):
            new_bool = True
        else:
            new_bool = bool(raw_value)
        if bool(mtsm.office_attention) == new_bool:
            return False, None
        mtsm.office_attention = new_bool
        return True, None

    if field_name == "prior_month_out_of_order_dismissed":
        if raw_value in (None, "", False, 0, "0", "false", "False"):
            new_bool = False
        elif raw_value in (True, 1, "1", "true", "True"):
            new_bool = True
        else:
            new_bool = bool(raw_value)
        if bool(mtsm.prior_month_out_of_order_dismissed) == new_bool:
            return False, None
        mtsm.prior_month_out_of_order_dismissed = new_bool
        return True, None

    new_val = _normalize_text(raw_value)
    old_val = getattr(mtsm, attr_name)
    if old_val == new_val:
        return False, None
    setattr(mtsm, attr_name, new_val)
    return True, None


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

# Office run-details field-changes card: omit test workflow, run comments, and reset audit.
RUN_DETAILS_EXCLUDED_AUDIT_FIELDS = frozenset({
    "result_status",
    "skip_reason",
    "time_in",
    "time_out",
    "run_comments",
    "reset_run",
    "stop_reset",
})

# Prep-only fields and sources omitted from the field-changes card (technician deltas only).
RUN_DETAILS_OFFICE_ONLY_AUDIT_FIELDS = frozenset({
    "office_attention",
    "office_job_comment",
    "prior_month_out_of_order_dismissed",
})
RUN_DETAILS_OFFICE_PREP_AUDIT_SOURCES = frozenset({"office_manual", "office"})
