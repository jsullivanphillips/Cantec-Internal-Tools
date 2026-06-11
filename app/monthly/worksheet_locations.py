"""Technician portal worksheet stops (``MonthlyLocationMonth`` grain).

Canonical replacement for ``worksheet_stops``: one ``MonthlyLocation`` per stop,
run-month snapshots on ``MonthlyLocationMonth``, deficiencies on
``MonthlyLocationDeficiency``. No legacy testing-site or history tables.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date
from typing import TYPE_CHECKING

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.db_models import (
    MonitoringCompany,
    MonthlyLocation,
    MonthlyLocationDeficiency,
    MonthlyLocationMonth,
    MonthlyRouteRun,
    MonthlyRouteWorksheetAuditEvent,
    MonthlyStopClockEvent,
    db,
)
from app.monthly.monitoring_companies import serialize_monitoring_company
from app.monthly.sheet_visit_times import SheetTimeImportRow, looks_like_sheet_clock
from app.monthly.site_field_template import (
    master_template_fields,
    merge_template_with_prior_fallback,
)
from app.monthly.location_building import monthly_location_building_name
from app.monthly.testing_site_fields import SNAPSHOT_STRING_FIELDS, SNAPSHOT_TEXT_FIELDS

if TYPE_CHECKING:
    pass


def _normalize_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


_MLM_OUTCOME_KEYS = (
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

_MLM_SNAPSHOT_DISPLAY_KEYS = (
    "annual_month",
    "property_management_company",
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
    "monitoring_password",
    "monitoring_notes",
)

_MLM_RUN_RESET_ATTRS = (
    "result_status",
    "skip_reason",
    "source_value_raw",
    "sheet_time_in_raw",
    "sheet_time_out_raw",
    "session_route_stop_order",
    "test_outcome",
    "skip_category",
    "skip_note",
    "confirmed_no_deficiencies",
    "billing_status",
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


def _snapshot_fields_from_mlm(mlm: MonthlyLocationMonth) -> dict[str, object]:
    return {key: getattr(mlm, key) for key in _MLM_SNAPSHOT_DISPLAY_KEYS}


def _fill_snapshot_gaps_from_master(
    values: dict[str, object],
    loc: MonthlyLocation,
) -> None:
    template = master_template_fields(loc)
    for key in (
        "annual_month",
        "property_management_company",
        "panel_location",
        "door_code",
        "ring",
        "key_number",
        "testing_procedures",
        "inspection_tech_notes",
        "monitoring_company_id",
        "monitoring_company_name",
        "monitoring_account_number",
        "monitoring_password",
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


def primary_testing_site(
    loc_or_list: MonthlyLocation | list[MonthlyLocation],
) -> MonthlyLocation | None:
    if isinstance(loc_or_list, MonthlyLocation):
        return loc_or_list
    if not loc_or_list:
        return None
    return loc_or_list[0]


def is_primary_stop(
    _loc_or_ts: MonthlyLocation,
    loc: MonthlyLocation | None = None,
) -> bool:
    return True


def sync_primary_history_from_stop(
    mlm: MonthlyLocationMonth,
    loc: MonthlyLocation,
    route_id: int,
    month_first: date,
) -> MonthlyLocationMonth:
    """Flat model: the location-month row is the canonical history row."""
    return mlm


def worksheet_stop_open_clock_in(mlm: MonthlyLocationMonth) -> bool:
    rs = (mlm.result_status or "").strip().lower()
    if rs in ("tested", "skipped"):
        return False
    tin = _normalize_text(mlm.sheet_time_in_raw)
    tout = _normalize_text(mlm.sheet_time_out_raw)
    if not tin or tout:
        return False
    return looks_like_sheet_clock(tin)


def _display_address(loc: MonthlyLocation | None, location_id: int) -> str:
    if loc is not None:
        addr = (loc.display_address or loc.address or "").strip()
        if addr:
            return addr
    return f"Location {location_id}"


def _monitoring_company_record(
    mcid: int | None,
    mlm: MonthlyLocationMonth | None,
    loc: MonthlyLocation | None,
) -> MonitoringCompany | None:
    if mcid is not None:
        if mlm is not None and mlm.monitoring_company is not None and int(mlm.monitoring_company.id) == int(mcid):
            return mlm.monitoring_company
        if loc is not None and loc.monitoring_company is not None and int(loc.monitoring_company.id) == int(mcid):
            return loc.monitoring_company
        return db.session.get(MonitoringCompany, int(mcid))
    return None


def _monitoring_labels(
    mlm: MonthlyLocationMonth | None,
    loc: MonthlyLocation,
) -> tuple[str | None, str | None, int | None, str | None, str | None, MonitoringCompany | None]:
    mcid: int | None = None
    acct: str | None = None
    mon_pwd: str | None = None
    mon_notes: str | None = None
    company_name: str | None = None

    if mlm is not None:
        mcid = int(mlm.monitoring_company_id) if mlm.monitoring_company_id is not None else None
        acct = _normalize_text(mlm.monitoring_account_number)
        mon_pwd = _normalize_text(mlm.monitoring_password)
        mon_notes = _normalize_text(mlm.monitoring_notes)
        company_name = _normalize_text(mlm.monitoring_company_name)
        master = master_template_fields(loc)
        if mcid is None and master.get("monitoring_company_id") is not None:
            mcid = int(master["monitoring_company_id"])
        if acct is None:
            acct = _normalize_text(master.get("monitoring_account_number"))
        if mon_pwd is None:
            mon_pwd = _normalize_text(master.get("monitoring_password"))
        if mon_notes is None:
            mon_notes = _normalize_text(master.get("monitoring_notes"))
        if company_name is None:
            company_name = _normalize_text(master.get("monitoring_company_name"))
    else:
        master = master_template_fields(loc)
        mcid = int(loc.monitoring_company_id) if loc.monitoring_company_id is not None else None
        acct = _normalize_text(master.get("monitoring_account_number"))
        mon_pwd = _normalize_text(master.get("monitoring_password"))
        mon_notes = _normalize_text(master.get("monitoring_notes"))
        company_name = _normalize_text(master.get("monitoring_company_name"))

    mc = _monitoring_company_record(mcid, mlm, loc)
    if mc is not None:
        company_name = _normalize_text(mc.name)
    elif not company_name and loc.monitoring_company is not None:
        company_name = _normalize_text(loc.monitoring_company.name)

    return company_name, mon_notes, mcid, acct, mon_pwd, mc


def _prior_mlm_for_location(location_id: int, month_first: date) -> MonthlyLocationMonth | None:
    return (
        MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.monthly_location_id == int(location_id),
            MonthlyLocationMonth.month_date < month_first,
        )
        .order_by(MonthlyLocationMonth.month_date.desc())
        .first()
    )


def _prior_mlm_by_location(
    location_ids: list[int],
    month_first: date,
) -> dict[int, MonthlyLocationMonth]:
    if not location_ids:
        return {}
    rows = (
        MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.monthly_location_id.in_(location_ids),
            MonthlyLocationMonth.month_date < month_first,
        )
        .order_by(
            MonthlyLocationMonth.monthly_location_id.asc(),
            MonthlyLocationMonth.month_date.desc(),
        )
        .all()
    )
    out: dict[int, MonthlyLocationMonth] = {}
    for row in rows:
        out.setdefault(int(row.monthly_location_id), row)
    return out


def seed_location_month_fields(
    loc: MonthlyLocation,
    prior: MonthlyLocationMonth | None,
    *,
    route_id: int,
    run_id: int | None,
    month_first: date,
    existing_row: MonthlyLocationMonth | None = None,
) -> dict[str, object]:
    """Build insert/update payload for ``MonthlyLocationMonth``."""
    if existing_row is not None:
        base = _snapshot_fields_from_mlm(existing_row)
        _fill_snapshot_gaps_from_master(base, loc)
        for key in _MLM_OUTCOME_KEYS:
            base[key] = getattr(existing_row, key)
    else:
        template = master_template_fields(loc)
        base = merge_template_with_prior_fallback(template, prior)
        base.update(_cleared_outcome_fields())
        base["run_comments"] = None
        base["office_job_comment"] = None
        base["office_attention"] = False
        base["prior_month_out_of_order_dismissed"] = False
        base["billing_status"] = None

    base["month_date"] = month_first
    base["test_monthly_route_id"] = route_id
    base["run_id"] = run_id
    if existing_row is not None:
        base["office_attention"] = bool(existing_row.office_attention)
        base["prior_month_out_of_order_dismissed"] = bool(
            existing_row.prior_month_out_of_order_dismissed
        )
        base["billing_status"] = existing_row.billing_status
    elif "office_attention" not in base:
        base["office_attention"] = False
    if "prior_month_out_of_order_dismissed" not in base:
        base["prior_month_out_of_order_dismissed"] = False
    base.pop("building_name", None)
    return base


def _route_locations(route_id: int) -> list[MonthlyLocation]:
    return (
        MonthlyLocation.query.options(joinedload(MonthlyLocation.monitoring_company))
        .filter(MonthlyLocation.monthly_route_id == route_id)
        .all()
    )


def _is_cancelled_library_location(loc: MonthlyLocation) -> bool:
    return (loc.status_normalized or "").strip().lower() == "cancelled"


def _active_library_route_locations(route_id: int) -> list[MonthlyLocation]:
    return [loc for loc in _route_locations(route_id) if not _is_cancelled_library_location(loc)]


def location_editable_on_route_month(
    loc: MonthlyLocation,
    route_id: int,
    month_first: date,
    mlm: MonthlyLocationMonth | None = None,
) -> bool:
    """True when a location may be patched on a route-month worksheet.

    Includes library stops still assigned to the route and historical stops
    attributed via ``MonthlyLocationMonth.test_monthly_route_id`` even when the
    library row has since moved to another route.
    """
    if int(loc.monthly_route_id or 0) == int(route_id):
        return True
    if mlm is None:
        mlm = (
            MonthlyLocationMonth.query.filter_by(
                monthly_location_id=int(loc.id),
                month_date=month_first,
            )
            .one_or_none()
        )
    return (
        mlm is not None
        and mlm.test_monthly_route_id is not None
        and int(mlm.test_monthly_route_id) == int(route_id)
    )


def _worksheet_month_is_prior_history_snapshot(month_first: date) -> bool:
    from app.routes.monthly_routes import _current_pacific_month_first

    return month_first < _current_pacific_month_first()


def _attributed_mlm_for_route_month(
    route_id: int,
    month_first: date,
) -> list[MonthlyLocationMonth]:
    return (
        MonthlyLocationMonth.query.filter_by(
            test_monthly_route_id=route_id,
            month_date=month_first,
        )
        .all()
    )


def _locations_for_prior_history_snapshot(
    route_id: int,
    month_first: date,
) -> list[MonthlyLocation]:
    mlm_rows = _attributed_mlm_for_route_month(route_id, month_first)
    if not mlm_rows:
        return []
    loc_ids = sorted({int(r.monthly_location_id) for r in mlm_rows})
    locs = (
        MonthlyLocation.query.options(joinedload(MonthlyLocation.monitoring_company))
        .filter(MonthlyLocation.id.in_(loc_ids))
        .all()
    )
    loc_by_id = {int(loc.id): loc for loc in locs}
    return [loc_by_id[lid] for lid in loc_ids if lid in loc_by_id]


def _resolve_worksheet_route_locations(
    route_id: int,
    month_first: date,
) -> list[MonthlyLocation]:
    if _worksheet_month_is_prior_history_snapshot(month_first):
        return _locations_for_prior_history_snapshot(route_id, month_first)
    return _active_library_route_locations(route_id)


def _location_ids_for_locations(locs: list[MonthlyLocation]) -> set[int]:
    return {int(loc.id) for loc in locs}


def route_month_has_worksheet_stops(route_id: int, month_first: date) -> bool:
    row = (
        db.session.query(MonthlyLocationMonth.id)
        .filter(
            MonthlyLocationMonth.month_date == month_first,
            MonthlyLocationMonth.test_monthly_route_id == route_id,
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
    """Idempotently materialize ``MonthlyLocationMonth`` for every location on the route."""
    locs = _resolve_worksheet_route_locations(route_id, month_first)
    if not locs:
        return
    run_id = int(run.id)
    loc_ids = [int(loc.id) for loc in locs]
    prior_by_loc = _prior_mlm_by_location(loc_ids, month_first)

    existing = {
        int(r.monthly_location_id): r
        for r in MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.month_date == month_first,
            MonthlyLocationMonth.monthly_location_id.in_(loc_ids),
        ).all()
    }

    for loc in locs:
        loc_id = int(loc.id)
        prior = prior_by_loc.get(loc_id)
        row = existing.get(loc_id)
        fields = seed_location_month_fields(
            loc,
            prior,
            route_id=route_id,
            run_id=run_id,
            month_first=month_first,
            existing_row=row,
        )
        if row is None:
            fields["monthly_location_id"] = loc_id
            kw = dict(fields)
            nid = _next_sqlite_bigint_id(MonthlyLocationMonth)
            if nid is not None:
                kw["id"] = nid
            try:
                with db.session.begin_nested():
                    db.session.add(MonthlyLocationMonth(**kw))
            except IntegrityError:
                row = MonthlyLocationMonth.query.filter_by(
                    monthly_location_id=loc_id,
                    month_date=month_first,
                ).one_or_none()
        if row is not None:
            if row.run_id is None and run_id is not None:
                row.run_id = run_id
            if row.test_monthly_route_id is None:
                row.test_monthly_route_id = route_id
            continue
    db.session.flush()


def apply_session_stop_order_from_history_for_route_month(
    route_id: int,
    month_first: date,
    *,
    overwrite: bool = False,
) -> int:
    """Copy ``session_route_stop_order`` from prior-month rows onto current worksheet locations."""
    locs = _route_locations(route_id)
    if not locs:
        return 0
    updated = 0
    for loc in locs:
        prior = _prior_mlm_for_location(int(loc.id), month_first)
        if prior is None or prior.session_route_stop_order is None:
            continue
        order = int(prior.session_route_stop_order)
        row = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=int(loc.id),
            month_date=month_first,
        ).one_or_none()
        if row is None:
            continue
        if not overwrite and row.session_route_stop_order is not None:
            continue
        if row.session_route_stop_order == order:
            continue
        row.session_route_stop_order = order
        updated += 1
    db.session.flush()
    return updated


def upsert_location_month_from_csv_import(
    *,
    loc: MonthlyLocation,
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
    monitoring_password: str | None,
    monitoring_company_id: int | None,
    sheet_time_in_raw: str | None,
    sheet_time_out_raw: str | None,
    preserve_existing_outcome: bool = True,
) -> MonthlyLocationMonth:
    """Write or update one ``MonthlyLocationMonth`` row from a route inspection CSV row."""
    loc_id = int(loc.id)
    row = MonthlyLocationMonth.query.filter_by(
        monthly_location_id=loc_id,
        month_date=month_first,
    ).one_or_none()

    upsert_result_status = sheet_times.result_status
    upsert_skip_reason = sheet_times.skip_reason
    upsert_source_value_raw = sheet_times.source_value_raw
    if preserve_existing_outcome and row is not None and row.result_status is not None:
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
        "monitoring_password": monitoring_password,
        "monitoring_company_id": monitoring_company_id,
        "property_management_company": loc.property_management_company,
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
        prior = _prior_mlm_for_location(loc_id, month_first)
        base = seed_location_month_fields(
            loc,
            prior,
            route_id=route_id,
            run_id=run_id,
            month_first=month_first,
            existing_row=None,
        )
        base.update(snapshot_values)
        base["monthly_location_id"] = loc_id
        kw = dict(base)
        nid = _next_sqlite_bigint_id(MonthlyLocationMonth)
        if nid is not None:
            kw["id"] = nid
        row = MonthlyLocationMonth(**kw)
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


def dismiss_prior_month_out_of_order_for_locations(
    route_id: int,
    month_first: date,
    location_ids: Iterable[int],
) -> int:
    ids = {int(lid) for lid in location_ids}
    if not ids:
        return 0
    rows = (
        MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.month_date == month_first,
            MonthlyLocationMonth.test_monthly_route_id == int(route_id),
            MonthlyLocationMonth.monthly_location_id.in_(ids),
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


def sync_session_route_stop_order_from_library_route(
    route_id: int,
    *,
    locs: list[MonthlyLocation] | None = None,
    overwrite: bool = True,
) -> int:
    if locs is None:
        locs = _route_locations(route_id)
    if not locs:
        return 0
    updated = 0
    for loc in locs:
        if loc.route_stop_order is None:
            continue
        order = int(loc.route_stop_order)
        rows = (
            MonthlyLocationMonth.query.filter(
                MonthlyLocationMonth.monthly_location_id == int(loc.id),
                MonthlyLocationMonth.test_monthly_route_id == int(route_id),
            )
            .all()
        )
        for row in rows:
            if not overwrite and row.session_route_stop_order is not None:
                continue
            if row.session_route_stop_order != order:
                row.session_route_stop_order = order
                updated += 1
    if updated:
        db.session.flush()
    return updated


def _mlm_has_field_progress(mlm: MonthlyLocationMonth) -> bool:
    rs = (mlm.result_status or "").strip().lower()
    if rs in ("tested", "skipped"):
        return True
    if _normalize_text(mlm.test_outcome):
        return True
    if _normalize_text(mlm.sheet_time_in_raw) or _normalize_text(mlm.sheet_time_out_raw):
        return True
    if _normalize_text(mlm.run_comments) is not None:
        return True
    return (
        MonthlyStopClockEvent.query.filter_by(monthly_location_month_id=int(mlm.id)).count() > 0
    )


def refresh_worksheet_stops_for_route_month(
    route_id: int,
    month_first: date,
    run: MonthlyRouteRun,
) -> tuple[int, int]:
    """Re-seed location-month snapshot paperwork from master + prior run data."""
    locs = _route_locations(route_id)
    if not locs:
        return 0, 0
    loc_ids = [int(loc.id) for loc in locs]
    run_id = int(run.id)
    prior_by_loc = _prior_mlm_by_location(loc_ids, month_first)
    existing = {
        int(r.monthly_location_id): r
        for r in MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.month_date == month_first,
            MonthlyLocationMonth.monthly_location_id.in_(loc_ids),
        ).all()
    }

    created = 0
    refreshed = 0
    for loc in locs:
        loc_id = int(loc.id)
        prior = prior_by_loc.get(loc_id)
        row = existing.get(loc_id)
        preserve_office_prep = row is not None and (
            bool(row.office_attention)
            or bool(_normalize_text(row.run_comments))
            or bool(_normalize_text(row.office_job_comment))
        )
        fresh = seed_location_month_fields(
            loc,
            prior,
            route_id=route_id,
            run_id=run_id,
            month_first=month_first,
            existing_row=row if preserve_office_prep else None,
        )
        if row is not None and not preserve_office_prep:
            for key in _MLM_OUTCOME_KEYS:
                fresh[key] = getattr(row, key)
            fresh["run_comments"] = row.run_comments
            fresh["office_job_comment"] = row.office_job_comment
            fresh["office_attention"] = bool(row.office_attention)
            fresh["prior_month_out_of_order_dismissed"] = bool(
                row.prior_month_out_of_order_dismissed
            )
            fresh["billing_status"] = row.billing_status
        if row is None:
            fields = dict(fresh)
            fields["monthly_location_id"] = loc_id
            nid = _next_sqlite_bigint_id(MonthlyLocationMonth)
            if nid is not None:
                fields["id"] = nid
            try:
                with db.session.begin_nested():
                    db.session.add(MonthlyLocationMonth(**fields))
                created += 1
                continue
            except IntegrityError:
                row = MonthlyLocationMonth.query.filter_by(
                    monthly_location_id=loc_id,
                    month_date=month_first,
                ).one_or_none()
        if row is None:
            continue
        for key in _MLM_SNAPSHOT_DISPLAY_KEYS:
            setattr(row, key, fresh.get(key))
        if not _mlm_has_field_progress(row):
            row.session_route_stop_order = fresh.get("session_route_stop_order")
        row.run_id = run_id
        row.test_monthly_route_id = route_id
        refreshed += 1
    db.session.flush()
    return created, refreshed


def _location_sort_key(
    mlm: MonthlyLocationMonth | None,
    loc: MonthlyLocation,
) -> tuple[int, int, int]:
    sess = mlm.session_route_stop_order if mlm is not None else None
    if sess is not None:
        return (0, int(sess), int(loc.id))
    if loc.route_stop_order is not None:
        return (1, int(loc.route_stop_order), int(loc.id))
    return (2, int(loc.id), int(loc.id))


def _serialize_clock_event(ev: MonthlyStopClockEvent) -> dict[str, object]:
    return {
        "id": int(ev.id),
        "sort_order": int(ev.sort_order),
        "time_in": ev.time_in_raw,
        "time_out": _normalize_text(ev.time_out_raw),
        "created_by_tech_id": _normalize_text(ev.created_by_tech_id),
        "created_by_tech_name": _normalize_text(ev.created_by_tech_name),
    }


def _list_clock_events(mlm: MonthlyLocationMonth) -> list[dict[str, object]]:
    events = (
        MonthlyStopClockEvent.query.filter_by(monthly_location_month_id=int(mlm.id))
        .order_by(MonthlyStopClockEvent.sort_order.asc(), MonthlyStopClockEvent.id.asc())
        .all()
    )
    return [_serialize_clock_event(e) for e in events]


def _serialize_deficiency(row: MonthlyLocationDeficiency) -> dict[str, object]:
    return {
        "id": int(row.id),
        "monthly_location_id": int(row.monthly_location_id),
        "title": row.title,
        "severity": row.severity,
        "status": row.status,
        "description": row.description,
        "verification_notes": row.verification_notes,
        "reported_by_tech_id": row.reported_by_tech_id,
        "reported_by_tech_name": row.reported_by_tech_name,
        "created_run_id": int(row.created_run_id) if row.created_run_id is not None else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _list_deficiencies_for_location(location_id: int) -> list[dict[str, object]]:
    rows = (
        MonthlyLocationDeficiency.query.filter_by(monthly_location_id=int(location_id))
        .order_by(MonthlyLocationDeficiency.created_at.asc(), MonthlyLocationDeficiency.id.asc())
        .all()
    )
    return [_serialize_deficiency(r) for r in rows]


def _is_legacy_outcome(mlm: MonthlyLocationMonth | None) -> bool:
    if mlm is None:
        return False
    if _normalize_text(mlm.test_outcome):
        return False
    return (mlm.result_status or "").strip().lower() in ("tested", "skipped")


def _location_has_run_changes(
    mlm: MonthlyLocationMonth,
    location_id: int,
    run_id: int | None,
) -> bool:
    if _normalize_text(mlm.test_outcome) or _normalize_text(mlm.result_status):
        return True
    if _normalize_text(mlm.run_comments):
        return True
    if (
        MonthlyStopClockEvent.query.filter_by(monthly_location_month_id=int(mlm.id)).count()
        > 0
    ):
        return True
    if run_id is not None:
        if (
            MonthlyLocationDeficiency.query.filter_by(
                monthly_location_id=int(location_id),
                created_run_id=int(run_id),
            ).count()
            > 0
        ):
            return True
    return False


def _portal_workflow_extras_for_location(
    mlm: MonthlyLocationMonth | None,
    loc: MonthlyLocation,
    *,
    route_id: int,
    month_first: date,
    run: MonthlyRouteRun | None,
) -> dict[str, object]:
    from app.monthly.portal_workflow import portal_run_is_read_only

    billing_status = _normalize_text(mlm.billing_status) if mlm is not None else None
    if mlm is None:
        return {
            "clock_events": [],
            "deficiencies": _list_deficiencies_for_location(int(loc.id)),
            "has_run_changes": False,
            "billing_status": billing_status,
            "is_legacy_outcome": False,
            "portal_read_only": portal_run_is_read_only(run),
            "is_legacy_run": portal_run_is_read_only(run),
        }
    return {
        "clock_events": _list_clock_events(mlm),
        "deficiencies": _list_deficiencies_for_location(int(loc.id)),
        "has_run_changes": _location_has_run_changes(
            mlm,
            int(loc.id),
            int(run.id) if run is not None else None,
        ),
        "billing_status": billing_status,
        "is_legacy_outcome": _is_legacy_outcome(mlm),
        "portal_read_only": portal_run_is_read_only(run),
        "is_legacy_run": portal_run_is_read_only(run),
    }


def _enrich_location_display_fields(
    stop: dict[str, object],
    loc: MonthlyLocation,
) -> dict[str, object]:
    label = _normalize_text(loc.label)
    billing = _display_address(loc, int(loc.id))
    primary = label or billing
    stop["primary_label"] = primary
    stop["billing_address_subline"] = (
        None if primary.casefold() == billing.casefold() else billing
    )
    return stop


def run_comments_for_route_month(route_id: int, month_first: date) -> list[dict[str, object]]:
    rows = (
        MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.month_date == month_first,
            MonthlyLocationMonth.test_monthly_route_id == route_id,
            MonthlyLocationMonth.run_comments.isnot(None),
        )
        .options(joinedload(MonthlyLocationMonth.location))
        .all()
    )
    out: list[dict[str, object]] = []
    for mlm in rows:
        text = _normalize_text(mlm.run_comments)
        if not text:
            continue
        loc = mlm.location
        if loc is None or int(loc.monthly_route_id or 0) != int(route_id):
            continue
        out.append(
            {
                "testing_site_id": int(loc.id),
                "location_id": int(loc.id),
                "display_address": (loc.display_address or loc.address or "").strip(),
                "building": monthly_location_building_name(loc),
                "label": _normalize_text(loc.label),
                "run_comments": text,
            }
        )
    out.sort(
        key=lambda row: (
            str(row["display_address"]).casefold(),
            int(row["location_id"]),
        )
    )
    return out


def serialize_worksheet_location(
    loc: MonthlyLocation,
    mlm: MonthlyLocationMonth | None,
    *,
    route_id: int,
    month_first: date,
    stop_number: int,
    run: MonthlyRouteRun | None = None,
    include_portal_extras: bool = True,
) -> dict[str, object]:
    company, mon_notes, mcid, mon_acct, mon_pwd, mc = _monitoring_labels(mlm, loc)
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
    billing_status = None

    if mlm is not None:
        panel = _normalize_text(mlm.panel) or _normalize_text(mlm.facp)
        ring = mlm.ring
        key_number = mlm.key_number
        annual_month = mlm.annual_month
        procedures = mlm.testing_procedures
        tech_notes = mlm.inspection_tech_notes
        run_comments = mlm.run_comments
        office_job_comment = mlm.office_job_comment
        office_attention = bool(mlm.office_attention)
        prior_month_out_of_order_dismissed = bool(mlm.prior_month_out_of_order_dismissed)
        result_status = mlm.result_status
        skip_reason = mlm.skip_reason
        test_outcome = mlm.test_outcome
        skip_category = mlm.skip_category
        skip_note = mlm.skip_note
        confirmed_no_deficiencies = bool(mlm.confirmed_no_deficiencies)
        time_in = mlm.sheet_time_in_raw
        time_out = mlm.sheet_time_out_raw
        sess_order = mlm.session_route_stop_order
        version = mlm.updated_at.isoformat() if mlm.updated_at else None
        row_id = int(mlm.id)
        billing_status = _normalize_text(mlm.billing_status)
        pmc = _normalize_text(mlm.property_management_company)
        panel_loc = mlm.panel_location
        door = mlm.door_code
        master = master_template_fields(loc)
        ring = _coalesce_with_master(ring, master.get("ring"))
        key_number = _coalesce_with_master(key_number, master.get("key_number"))
        annual_month = _coalesce_with_master(annual_month, master.get("annual_month"))
        procedures = _coalesce_with_master(procedures, master.get("testing_procedures"))
        tech_notes = _coalesce_with_master(tech_notes, master.get("inspection_tech_notes"))
        panel = panel or _normalize_text(master.get("panel"))
        pmc = pmc or _normalize_text(master.get("property_management_company"))
        panel_loc = _coalesce_with_master(panel_loc, master.get("panel_location"))
        door = _coalesce_with_master(door, master.get("door_code"))
    else:
        preview = master_template_fields(loc)
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
    building = monthly_location_building_name(loc)

    stop: dict[str, object] = {
        "testing_site_id": int(loc.id),
        "location_id": int(loc.id),
        "location_month_row_id": row_id,
        "month_date": month_first.isoformat(),
        "display_address": _display_address(loc, int(loc.id)),
        "latitude": float(loc.latitude) if loc.latitude is not None else None,
        "longitude": float(loc.longitude) if loc.longitude is not None else None,
        "building_name": building,
        "property_management_company": pmc or _normalize_text(loc.property_management_company),
        "label": _normalize_text(loc.label),
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
        "monitoring_password": mon_pwd,
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
        stop.update(
            _portal_workflow_extras_for_location(
                mlm,
                loc,
                route_id=route_id,
                month_first=month_first,
                run=run,
            )
        )
    else:
        from app.monthly.portal_workflow import portal_run_is_read_only

        stop.update(
            {
                "clock_events": [],
                "deficiencies": [],
                "has_run_changes": False,
                "billing_status": billing_status,
                "is_legacy_outcome": _is_legacy_outcome(mlm),
                "portal_read_only": portal_run_is_read_only(run),
                "is_legacy_run": portal_run_is_read_only(run),
            }
        )
    return _enrich_location_display_fields(stop, loc)


def portal_worksheet_preview_stops(
    route_id: int,
    month_first: date,
) -> list[dict[str, object]]:
    locs = _active_library_route_locations(route_id)
    locs_sorted = sorted(
        locs,
        key=lambda loc: (0, int(loc.route_stop_order)) if loc.route_stop_order is not None else (1, 10**9),
    )
    stops: list[dict[str, object]] = []
    for idx, loc in enumerate(locs_sorted, start=1):
        stops.append(
            serialize_worksheet_location(
                loc,
                None,
                route_id=route_id,
                month_first=month_first,
                stop_number=idx,
            )
        )
    return stops


def worksheet_locations_from_attributed_month_rows(
    route_id: int,
    month_first: date,
    *,
    include_portal_extras: bool = True,
) -> list[dict[str, object]]:
    mlm_rows = _attributed_mlm_for_route_month(route_id, month_first)
    if not mlm_rows:
        return []
    loc_ids = sorted({int(r.monthly_location_id) for r in mlm_rows})
    locs = (
        MonthlyLocation.query.options(joinedload(MonthlyLocation.monitoring_company))
        .filter(MonthlyLocation.id.in_(loc_ids))
        .all()
    )
    loc_by_id = {int(loc.id): loc for loc in locs}
    mlm_by_loc = {int(r.monthly_location_id): r for r in mlm_rows}

    pairs: list[tuple[MonthlyLocationMonth, MonthlyLocation]] = []
    for loc_id in loc_ids:
        loc = loc_by_id.get(loc_id)
        mlm = mlm_by_loc.get(loc_id)
        if loc is None or mlm is None:
            continue
        pairs.append((mlm, loc))
    pairs.sort(key=lambda item: _location_sort_key(item[0], item[1]))

    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()

    out: list[dict[str, object]] = []
    for idx, (mlm, loc) in enumerate(pairs, start=1):
        out.append(
            serialize_worksheet_location(
                loc,
                mlm,
                route_id=route_id,
                month_first=month_first,
                stop_number=idx,
                run=run,
                include_portal_extras=include_portal_extras,
            )
        )
    return out


def _worksheet_location_pairs_for_route_month(
    route_id: int,
    month_first: date,
    *,
    locs: list[MonthlyLocation] | None = None,
) -> list[tuple[MonthlyLocationMonth | None, MonthlyLocation]]:
    prior_history = _worksheet_month_is_prior_history_snapshot(month_first)
    if locs is None:
        locs = _resolve_worksheet_route_locations(route_id, month_first)
    if not locs:
        return []

    loc_ids = [int(loc.id) for loc in locs]
    mlm_rows = (
        MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.month_date == month_first,
            MonthlyLocationMonth.monthly_location_id.in_(loc_ids),
            MonthlyLocationMonth.test_monthly_route_id == route_id,
        )
        .all()
    )
    mlm_by_loc = {int(m.monthly_location_id): m for m in mlm_rows}

    pairs: list[tuple[MonthlyLocationMonth | None, MonthlyLocation]] = []
    for loc in locs:
        if not prior_history and int(loc.monthly_route_id or 0) != int(route_id):
            continue
        pairs.append((mlm_by_loc.get(int(loc.id)), loc))

    pairs.sort(key=lambda item: _location_sort_key(item[0], item[1]))

    if prior_history:
        hist_loc_ids = {
            int(r.monthly_location_id) for r in _attributed_mlm_for_route_month(route_id, month_first)
        }
        pairs = [(mlm, loc) for mlm, loc in pairs if int(loc.id) in hist_loc_ids]
    return pairs


def worksheet_stop_number_for_location(
    route_id: int,
    month_first: date,
    location_id: int,
    *,
    pairs: list[tuple[MonthlyLocationMonth | None, MonthlyLocation]] | None = None,
) -> int:
    if pairs is None:
        pairs = _worksheet_location_pairs_for_route_month(route_id, month_first)
    for idx, (_mlm, loc) in enumerate(pairs, start=1):
        if int(loc.id) == int(location_id):
            return idx
    return 0


def worksheet_stop_number_for_site(
    route_id: int,
    month_first: date,
    testing_site_id: int,
    *,
    pairs: list[tuple[MonthlyLocationMonth | None, MonthlyLocation]] | None = None,
) -> int:
    """1-based route stop number; ``testing_site_id`` is the flat ``location_id``."""
    return worksheet_stop_number_for_location(
        route_id,
        month_first,
        int(testing_site_id),
        pairs=pairs,
    )


def resolve_worksheet_stop_number(
    route_id: int,
    month_first: date,
    testing_site_id: int,
    *,
    hint: int | None = None,
) -> int:
    if isinstance(hint, int) and int(hint) > 0:
        return int(hint)
    return worksheet_stop_number_for_site(route_id, month_first, testing_site_id)


_OFFICE_PREP_ONLY_PATCH_FIELDS = frozenset({
    "office_job_comment",
    "office_attention",
    "prior_month_out_of_order_dismissed",
})


def serialize_worksheet_stop_office_prep_patch(
    loc: MonthlyLocation,
    mlm: MonthlyLocationMonth,
    *,
    month_first: date,
    stop_number: int,
) -> dict[str, object]:
    company, mon_notes, mcid, mon_acct, mon_pwd, mc = _monitoring_labels(mlm, loc)
    panel = _normalize_text(mlm.panel) or _normalize_text(mlm.facp)
    stop: dict[str, object] = {
        "testing_site_id": int(loc.id),
        "location_id": int(loc.id),
        "month_date": month_first.isoformat(),
        "display_address": _display_address(loc, int(loc.id)),
        "latitude": float(loc.latitude) if loc.latitude is not None else None,
        "longitude": float(loc.longitude) if loc.longitude is not None else None,
        "building_name": monthly_location_building_name(loc),
        "property_management_company": _normalize_text(mlm.property_management_company)
        or _normalize_text(loc.property_management_company),
        "label": _normalize_text(loc.label),
        "panel": panel,
        "panel_location": mlm.panel_location,
        "door_code": mlm.door_code,
        "ring": mlm.ring,
        "key_number": mlm.key_number,
        "annual_month": mlm.annual_month,
        "monitoring_company": company,
        "monitoring_company_id": mcid,
        "monitoring_company_record": serialize_monitoring_company(mc),
        "monitoring_account_number": mon_acct,
        "monitoring_password": mon_pwd,
        "monitoring_notes": mon_notes,
        "testing_procedures": mlm.testing_procedures,
        "inspection_tech_notes": mlm.inspection_tech_notes,
        "run_comments": mlm.run_comments,
        "office_job_comment": mlm.office_job_comment,
        "office_attention": bool(mlm.office_attention),
        "prior_month_out_of_order_dismissed": bool(mlm.prior_month_out_of_order_dismissed),
        "stop_number": int(stop_number),
    }
    return _enrich_location_display_fields(stop, loc)


def worksheet_locations_for_route_month(
    route_id: int,
    month_first: date,
    *,
    include_portal_extras: bool = True,
) -> list[dict[str, object]]:
    locs = _resolve_worksheet_route_locations(route_id, month_first)
    if not locs:
        return worksheet_locations_from_attributed_month_rows(
            route_id,
            month_first,
            include_portal_extras=include_portal_extras,
        )

    pairs = _worksheet_location_pairs_for_route_month(route_id, month_first, locs=locs)

    run = MonthlyRouteRun.query.filter_by(
        monthly_route_id=route_id,
        month_date=month_first,
    ).one_or_none()

    out: list[dict[str, object]] = []
    for idx, (mlm, loc) in enumerate(pairs, start=1):
        out.append(
            serialize_worksheet_location(
                loc,
                mlm,
                route_id=route_id,
                month_first=month_first,
                stop_number=idx,
                run=run,
                include_portal_extras=include_portal_extras,
            )
        )
    return out


def _route_month_has_run_comments(route_id: int, month_first: date) -> bool:
    return (
        db.session.query(MonthlyLocationMonth.id)
        .filter(
            MonthlyLocationMonth.month_date == month_first,
            MonthlyLocationMonth.test_monthly_route_id == route_id,
            MonthlyLocationMonth.run_comments.isnot(None),
            func.trim(MonthlyLocationMonth.run_comments) != "",
        )
        .limit(1)
        .first()
        is not None
    )


def _is_annual_for_month(month_first: date, annual_month: object) -> bool:
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
    outcome = (str(stop.get("test_outcome") or "")).strip().lower()
    if outcome in _PORTAL_OUTCOME_COUNT_KEYS:
        return outcome
    rs = (str(stop.get("result_status") or "")).strip().lower()
    if rs == "tested":
        return "all_good"
    if rs == "skipped":
        return "skipped"
    return None


def office_review_billing_location_ids(route_id: int, month_first: date) -> set[int]:
    """Location ids visible on the office run-review worksheet.

    Matches the run-details UI (excludes cancelled library stops on live months).
    Billing gates should only consider these rows, not orphaned attributed month rows.
    """
    stops = worksheet_locations_for_route_month(
        route_id,
        month_first,
        include_portal_extras=False,
    )
    return {int(s["location_id"]) for s in stops}


def run_details_counts_for_route_month(route_id: int, month_first: date) -> dict[str, int]:
    rows = (
        MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.month_date == month_first,
            MonthlyLocationMonth.test_monthly_route_id == route_id,
        )
        .all()
    )
    stops: list[dict[str, object]] = [
        {
            "test_outcome": row.test_outcome,
            "result_status": row.result_status,
        }
        for row in rows
    ]
    return _run_details_counts_from_stops(stops)


def _run_details_counts_from_stops(stops: list[dict[str, object]]) -> dict[str, int]:
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
    stops = worksheet_locations_for_route_month(route_id, month_first)
    return _run_details_counts_from_stops(stops)


def _route_month_has_skipped_stops(route_id: int, month_first: date) -> bool:
    if (
        db.session.query(MonthlyLocationMonth.id)
        .filter(
            MonthlyLocationMonth.month_date == month_first,
            MonthlyLocationMonth.test_monthly_route_id == route_id,
            MonthlyLocationMonth.result_status == "skipped",
        )
        .limit(1)
        .first()
        is not None
    ):
        return True
    for row in _attributed_mlm_for_route_month(route_id, month_first):
        if (row.result_status or "").strip().lower() == "skipped":
            return True
    return False


def notable_worksheet_stops_for_run_details(
    route_id: int,
    month_first: date,
    property_change_location_ids: set[int],
) -> list[dict[str, object]]:
    all_stops = worksheet_locations_for_route_month(route_id, month_first)
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
    max_ts = (
        db.session.query(func.max(MonthlyLocationMonth.updated_at))
        .filter(
            MonthlyLocationMonth.month_date == month_first,
            MonthlyLocationMonth.test_monthly_route_id == route_id,
        )
        .scalar()
    )
    count = (
        db.session.query(func.count(MonthlyLocationMonth.id))
        .filter(
            MonthlyLocationMonth.month_date == month_first,
            MonthlyLocationMonth.test_monthly_route_id == route_id,
        )
        .scalar()
    )
    ts_part = max_ts.isoformat() if max_ts is not None else "none"
    return f"mlm:{ts_part}:{int(count or 0)}"


def load_stop_for_patch(
    route_id: int,
    testing_site_id: int,
    month_first: date,
) -> tuple[MonthlyLocationMonth | None, MonthlyLocation | None, MonthlyLocation | None]:
    """``testing_site_id`` is the flat ``MonthlyLocation.id`` (API compat alias)."""
    location_id = int(testing_site_id)
    loc = (
        MonthlyLocation.query.options(joinedload(MonthlyLocation.monitoring_company))
        .filter_by(id=location_id)
        .one_or_none()
    )
    if loc is None:
        return None, None, None
    mlm = (
        MonthlyLocationMonth.query.options(joinedload(MonthlyLocationMonth.monitoring_company))
        .filter_by(
            monthly_location_id=location_id,
            month_date=month_first,
        )
        .one_or_none()
    )
    if not location_editable_on_route_month(loc, route_id, month_first, mlm):
        return None, loc, loc
    return mlm, loc, loc


def patch_will_start_open_clock_in(
    mlm: MonthlyLocationMonth,
    changes_eff: dict[str, object],
) -> bool:
    if "time_in" not in changes_eff:
        return False
    tin = _normalize_text(changes_eff.get("time_in"))
    if not tin or not looks_like_sheet_clock(tin):
        return False
    if worksheet_stop_open_clock_in(mlm):
        return False
    tout = (
        _normalize_text(changes_eff.get("time_out"))
        if "time_out" in changes_eff
        else _normalize_text(mlm.sheet_time_out_raw)
    )
    if tout:
        return False
    rs = (
        _normalize_text(changes_eff.get("result_status"))
        if "result_status" in changes_eff
        else _normalize_text(mlm.result_status)
    )
    if (rs or "").lower() == "skipped":
        return False
    return True


def find_open_clock_in_stop_on_route(
    route_id: int,
    month_first: date,
    *,
    exclude_testing_site_id: int | None = None,
    exclude_location_id: int | None = None,
) -> MonthlyLocationMonth | None:
    excluded = exclude_testing_site_id if exclude_testing_site_id is not None else exclude_location_id
    rows = (
        MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.month_date == month_first,
            MonthlyLocationMonth.test_monthly_route_id == route_id,
        )
        .all()
    )
    for row in rows:
        if excluded is not None and int(row.monthly_location_id) == int(excluded):
            continue
        if worksheet_stop_open_clock_in(row):
            return row
    return None


_FRESH_LOCATION_MONTH_SKIP_KEYS = frozenset({"month_date", "monthly_location_id"})


def _mlm_row_has_run_scoped_data(mlm: MonthlyLocationMonth) -> bool:
    for attr in _MLM_RUN_RESET_ATTRS:
        val = getattr(mlm, attr, None)
        if val is None:
            continue
        if attr == "billing_status":
            billing = (str(val) if val is not None else "").strip().lower()
            if billing in {"", "unset", "legacy"}:
                continue
            return True
        if attr == "confirmed_no_deficiencies" and val is False:
            continue
        if isinstance(val, str) and not val.strip():
            continue
        return True
    return False


def _clear_mlm_run_scoped_fields(mlm: MonthlyLocationMonth) -> None:
    billing_locked = (_normalize_text(mlm.billing_status) or "").lower() == "legacy"
    for attr in _MLM_RUN_RESET_ATTRS:
        if attr == "billing_status" and billing_locked:
            continue
        if attr == "confirmed_no_deficiencies":
            setattr(mlm, attr, False)
            continue
        setattr(mlm, attr, None)


def _apply_fresh_location_month_fields(
    row: MonthlyLocationMonth,
    fresh: dict[str, object],
    *,
    route_id: int,
    run_id: int | None,
) -> None:
    billing_locked = (_normalize_text(row.billing_status) or "").lower() == "legacy"
    for key, val in fresh.items():
        if key in _FRESH_LOCATION_MONTH_SKIP_KEYS:
            continue
        if key == "billing_status" and billing_locked:
            continue
        setattr(row, key, val)
    row.test_monthly_route_id = route_id
    row.run_id = run_id


def _reseed_location_month_rows_from_master(
    route_id: int,
    month_first: date,
    run: MonthlyRouteRun | None,
    *,
    locs: list[MonthlyLocation] | None = None,
) -> int:
    if locs is None:
        locs = _route_locations(route_id)
    if not locs:
        return 0
    loc_ids = [int(loc.id) for loc in locs]
    run_id = int(run.id) if run is not None else None
    prior_by_loc = _prior_mlm_by_location(loc_ids, month_first)
    existing = {
        int(r.monthly_location_id): r
        for r in MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.month_date == month_first,
            MonthlyLocationMonth.monthly_location_id.in_(loc_ids),
        ).all()
    }

    reseeded = 0
    for loc in locs:
        loc_id = int(loc.id)
        prior = prior_by_loc.get(loc_id)
        row = existing.get(loc_id)
        fresh = seed_location_month_fields(
            loc,
            prior,
            route_id=route_id,
            run_id=run_id,
            month_first=month_first,
            existing_row=None,
        )
        if row is None:
            fields = dict(fresh)
            fields["monthly_location_id"] = loc_id
            nid = _next_sqlite_bigint_id(MonthlyLocationMonth)
            if nid is not None:
                fields["id"] = nid
            try:
                with db.session.begin_nested():
                    db.session.add(MonthlyLocationMonth(**fields))
                reseeded += 1
                continue
            except IntegrityError:
                row = MonthlyLocationMonth.query.filter_by(
                    monthly_location_id=loc_id,
                    month_date=month_first,
                ).one_or_none()
        if row is None:
            continue
        _apply_fresh_location_month_fields(row, fresh, route_id=route_id, run_id=run_id)
        reseeded += 1
    db.session.flush()
    return reseeded


def _delete_clock_events_for_route_month(route_id: int, month_first: date) -> int:
    locs = _route_locations(route_id)
    if not locs:
        return 0
    loc_ids = [int(loc.id) for loc in locs]
    mlm_ids = [
        int(row.id)
        for row in MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.month_date == month_first,
            MonthlyLocationMonth.monthly_location_id.in_(loc_ids),
        ).all()
    ]
    if not mlm_ids:
        return 0
    deleted = (
        MonthlyStopClockEvent.query.filter(
            MonthlyStopClockEvent.monthly_location_month_id.in_(mlm_ids),
        ).delete(synchronize_session=False)
    )
    return int(deleted or 0)


def _delete_clock_events_for_route_month_attributed(
    route_id: int,
    month_first: date,
) -> int:
    mlm_ids = [
        int(row.id)
        for row in MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.month_date == month_first,
            MonthlyLocationMonth.test_monthly_route_id == route_id,
        ).all()
    ]
    if not mlm_ids:
        return 0
    deleted = (
        MonthlyStopClockEvent.query.filter(
            MonthlyStopClockEvent.monthly_location_month_id.in_(mlm_ids),
        ).delete(synchronize_session=False)
    )
    return int(deleted or 0)


def prune_route_month_stops_not_on_active_library(
    route_id: int,
    month_first: date,
    active_locs: list[MonthlyLocation],
) -> int:
    valid_loc_ids = _location_ids_for_locations(active_locs)
    stale_rows = (
        MonthlyLocationMonth.query.filter(
            MonthlyLocationMonth.month_date == month_first,
            MonthlyLocationMonth.test_monthly_route_id == route_id,
        )
        .all()
    )
    stale_rows = [
        row for row in stale_rows if int(row.monthly_location_id) not in valid_loc_ids
    ]
    if not stale_rows:
        return 0
    stale_mlm_ids = [int(row.id) for row in stale_rows]
    MonthlyStopClockEvent.query.filter(
        MonthlyStopClockEvent.monthly_location_month_id.in_(stale_mlm_ids),
    ).delete(synchronize_session=False)
    deleted = (
        MonthlyLocationMonth.query.filter(MonthlyLocationMonth.id.in_(stale_mlm_ids))
        .delete(synchronize_session=False)
    )
    db.session.flush()
    return int(deleted or 0)


def _clear_run_scoped_worksheet_progress(
    route_id: int,
    month_first: date,
) -> dict[str, int]:
    deleted_audits = (
        MonthlyRouteWorksheetAuditEvent.query.filter_by(
            monthly_route_id=route_id,
            month_date=month_first,
        ).delete(synchronize_session=False)
    )

    cleared_rows = 0
    for mlm in _attributed_mlm_for_route_month(route_id, month_first):
        if _mlm_row_has_run_scoped_data(mlm):
            cleared_rows += 1
        _clear_mlm_run_scoped_fields(mlm)

    deleted_clock_events = _delete_clock_events_for_route_month_attributed(route_id, month_first)

    return {
        "deleted_audit_events": int(deleted_audits or 0),
        "cleared_history_rows": cleared_rows,
        "deleted_clock_events": deleted_clock_events,
    }


def regenerate_prep_paperwork_from_library(
    route_id: int,
    month_first: date,
    run: MonthlyRouteRun,
) -> dict[str, int]:
    active_locs = _active_library_route_locations(route_id)
    stops_pruned = prune_route_month_stops_not_on_active_library(route_id, month_first, active_locs)
    clear_stats = _clear_run_scoped_worksheet_progress(route_id, month_first)
    reseeded_stops = _reseed_location_month_rows_from_master(
        route_id,
        month_first,
        run,
        locs=active_locs,
    )
    session_orders_updated = sync_session_route_stop_order_from_library_route(
        route_id,
        locs=active_locs,
        overwrite=True,
    )
    return {
        "stops_pruned": stops_pruned,
        "reseeded_stops": reseeded_stops,
        "mirrored_library_locations": 0,
        "session_orders_updated": session_orders_updated,
        **clear_stats,
    }


def reset_worksheet_run_for_route_month(
    route_id: int,
    month_first: date,
    run: MonthlyRouteRun | None,
) -> dict[str, int]:
    clear_stats = _clear_run_scoped_worksheet_progress(route_id, month_first)
    reseeded_stops = _reseed_location_month_rows_from_master(route_id, month_first, run)
    return {
        **clear_stats,
        "reseeded_stops": reseeded_stops,
        "mirrored_library_locations": 0,
    }


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
    "building_name": "building_name",
    "property_management_company": "property_management_company",
    "monitoring_company_id": "monitoring_company_id",
    "monitoring_account_number": "monitoring_account_number",
    "monitoring_password": "monitoring_password",
    "monitoring_notes": "monitoring_notes",
    "monitoring_company": "monitoring_company_name",
}


def stop_patch_audit_old_value(mlm: MonthlyLocationMonth, field_name: str) -> object:
    """Pre-patch snapshot for audit rows (``building_name`` lives on ``MonthlyLocation``)."""
    if field_name == "building_name":
        loc = mlm.location
        return monthly_location_building_name(loc) if loc is not None else None
    attr_name = STOP_PATCH_FIELD_MAP.get(field_name)
    if not attr_name:
        return None
    return getattr(mlm, attr_name, None)


def sync_mlm_monitoring_company_name(mlm: MonthlyLocationMonth) -> None:
    mcid = mlm.monitoring_company_id
    if mcid is None:
        return
    mc = db.session.get(MonitoringCompany, int(mcid))
    mlm.monitoring_company_name = (mc.name or "").strip() if mc is not None else None


def apply_worksheet_stop_field_change(
    mlm: MonthlyLocationMonth,
    field_name: str,
    raw_value: object,
) -> tuple[bool, str | None]:
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
        if mlm.monitoring_company_id == new_id:
            return False, None
        mlm.monitoring_company_id = new_id
        mc = db.session.get(MonitoringCompany, new_id) if new_id is not None else None
        mlm.monitoring_company_name = (mc.name or "").strip() if mc is not None else None
        return True, None

    if field_name == "panel" and raw_value is not None:
        new_val = _normalize_text(raw_value)
        old_panel = _normalize_text(mlm.panel) or _normalize_text(mlm.facp)
        if old_panel == new_val:
            return False, None
        mlm.panel = new_val
        mlm.facp = new_val
        return True, None

    if field_name == "building_name":
        loc = mlm.location
        if loc is None:
            return False, "location not found for worksheet stop"
        new_val = _normalize_text(raw_value)
        old_val = _normalize_text(loc.building_name)
        if old_val == new_val:
            return False, None
        loc.building_name = new_val
        return True, None

    if field_name == "office_attention":
        if raw_value in (None, "", False, 0, "0", "false", "False"):
            new_bool = False
        elif raw_value in (True, 1, "1", "true", "True"):
            new_bool = True
        else:
            new_bool = bool(raw_value)
        if bool(mlm.office_attention) == new_bool:
            return False, None
        mlm.office_attention = new_bool
        return True, None

    if field_name == "prior_month_out_of_order_dismissed":
        if raw_value in (None, "", False, 0, "0", "false", "False"):
            new_bool = False
        elif raw_value in (True, 1, "1", "true", "True"):
            new_bool = True
        else:
            new_bool = bool(raw_value)
        if bool(mlm.prior_month_out_of_order_dismissed) == new_bool:
            return False, None
        mlm.prior_month_out_of_order_dismissed = new_bool
        return True, None

    new_val = _normalize_text(raw_value)
    old_val = getattr(mlm, attr_name)
    if old_val == new_val:
        return False, None
    setattr(mlm, attr_name, new_val)
    return True, None


def mirror_master_to_mlm_snapshot(loc: MonthlyLocation, mlm: MonthlyLocationMonth) -> bool:
    """Copy library master snapshot fields onto a location-month row."""
    template = master_template_fields(loc)
    changed = False

    def _set(attr: str, value: object) -> None:
        nonlocal changed
        if getattr(mlm, attr) != value:
            setattr(mlm, attr, value)
            changed = True

    _set("annual_month", template.get("annual_month"))
    _set("property_management_company", template.get("property_management_company"))
    _set("panel_location", template.get("panel_location"))
    _set("door_code", template.get("door_code"))
    _set("ring", template.get("ring"))
    _set("key_number", template.get("key_number"))
    panel = template.get("panel") or template.get("facp")
    _set("panel", panel)
    _set("facp", panel)
    _set("testing_procedures", template.get("testing_procedures"))
    _set("inspection_tech_notes", template.get("inspection_tech_notes"))
    _set("monitoring_notes", template.get("monitoring_notes"))
    _set("monitoring_account_number", template.get("monitoring_account_number"))
    _set("monitoring_password", template.get("monitoring_password"))
    _set("monitoring_company_id", template.get("monitoring_company_id"))
    _set("monitoring_company_name", template.get("monitoring_company_name"))
    return changed


def sync_open_prep_mlm_rows_from_master(loc: MonthlyLocation) -> int:
    """After a library master edit, refresh open prep ``MonthlyLocationMonth`` rows."""
    if loc.monthly_route_id is None:
        return 0

    from app.monthly.run_workflow import run_in_office_prep_phase

    route_id = int(loc.monthly_route_id)
    mlm_rows = (
        MonthlyLocationMonth.query.filter_by(monthly_location_id=int(loc.id))
        .filter(
            (MonthlyLocationMonth.test_monthly_route_id == route_id)
            | (MonthlyLocationMonth.test_monthly_route_id.is_(None))
        )
        .all()
    )
    synced = 0
    for mlm in mlm_rows:
        run = MonthlyRouteRun.query.filter_by(
            monthly_route_id=route_id,
            month_date=mlm.month_date,
        ).one_or_none()
        if run is not None and not run_in_office_prep_phase(run):
            continue
        mirror_master_to_mlm_snapshot(loc, mlm)
        synced += 1
    return synced


RUN_DETAILS_EXCLUDED_AUDIT_FIELDS = frozenset({
    "result_status",
    "skip_reason",
    "time_in",
    "time_out",
    "run_comments",
    "reset_run",
    "stop_reset",
})

RUN_DETAILS_OFFICE_ONLY_AUDIT_FIELDS = frozenset({
    "office_attention",
    "office_job_comment",
    "prior_month_out_of_order_dismissed",
})

RUN_DETAILS_OFFICE_PREP_AUDIT_SOURCES = frozenset({"office_manual", "office"})

# No history dual-write in the flat location model.
STOP_PATCH_HISTORY_AUDIT_ATTR: dict[str, str] = {}


def dismiss_prior_month_out_of_order_for_testing_sites(
    route_id: int,
    month_first: date,
    testing_site_ids: Iterable[int],
) -> int:
    """``testing_site_ids`` are flat ``MonthlyLocation`` ids (API compat alias)."""
    return dismiss_prior_month_out_of_order_for_locations(
        route_id,
        month_first,
        testing_site_ids,
    )


# Backward-compatible aliases for callers migrating from ``worksheet_stops``.
worksheet_stops_for_route_month = worksheet_locations_for_route_month
serialize_worksheet_stop = serialize_worksheet_location
seed_stop_month_fields = seed_location_month_fields
worksheet_stops_from_attributed_history = worksheet_locations_from_attributed_month_rows
upsert_stop_month_from_csv_import = upsert_location_month_from_csv_import
sync_mtsm_monitoring_company_name = sync_mlm_monitoring_company_name
_attributed_history_for_route_month = _attributed_mlm_for_route_month
_worksheet_stop_pairs_for_route_month = _worksheet_location_pairs_for_route_month
