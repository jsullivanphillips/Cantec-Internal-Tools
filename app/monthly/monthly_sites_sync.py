"""Create or update v2 ``MonthlySite`` / ``MonthlyTestingSite`` rows from legacy ``MonthlyRouteLocation``."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError
from sqlalchemy.orm import joinedload, selectinload

from app.db_models import (
    MonitoringCompany,
    MonthlyRouteLocation,
    MonthlyRouteRun,
    MonthlySite,
    MonthlyTestingSite,
    MonthlyTestingSiteMonth,
    db,
)


def _panel_text_from_legacy(loc: MonthlyRouteLocation) -> str | None:
    raw = (loc.facp_detail or "").strip()
    return raw or None


def testing_site_master_fields_from_legacy(loc: MonthlyRouteLocation) -> dict:
    """Copy library-level display fields from a legacy location onto a new primary testing site."""
    panel = _panel_text_from_legacy(loc)
    return {
        "annual_month": loc.annual_month,
        "property_management_company": loc.property_management_company,
        "building_name": loc.building,
        "panel": panel,
        "panel_location": None,
        "door_code": None,
        "monitoring_company_id": loc.monitoring_company_id,
        "price_per_month": loc.price_per_month,
        "ring_detail": loc.ring_detail,
        "facp_detail": loc.facp_detail,
        "testing_procedures": loc.testing_procedures,
        "inspection_tech_notes": loc.inspection_tech_notes,
        "keys": loc.keys,
        "barcode": loc.barcode,
        "key_id": loc.key_id,
    }


def apply_testing_site_master_fields_from_legacy(ts: MonthlyTestingSite, loc: MonthlyRouteLocation) -> None:
    """Push legacy location display fields onto an existing testing site (sheet import / backfill)."""
    for key, value in testing_site_master_fields_from_legacy(loc).items():
        setattr(ts, key, value)


def _next_sqlite_bigint_id(model) -> int | None:
    """SQLite tests often omit autoincrement for BIGINT PKs; assign explicit ids."""
    if "sqlite" not in (str(db.engine.url) or "").lower():
        return None
    return int(db.session.query(func.coalesce(func.max(model.id), 0)).scalar() or 0) + 1


def ensure_monthly_site_for_location(loc: MonthlyRouteLocation) -> MonthlySite:
    """Return ``MonthlySite`` bridged to ``loc``, creating it if missing.

    Uses DB lookup before insert and savepoint + IntegrityError handling so concurrent
    requests (or stale ORM state) cannot violate ``uq_monthly_site_legacy_monthly_route_location_id``.
    """
    if loc.monthly_site is not None:
        return loc.monthly_site
    lid = int(loc.id)
    existing = MonthlySite.query.filter_by(legacy_monthly_route_location_id=lid).one_or_none()
    if existing is not None:
        return existing

    ms_kw: dict = {"legacy_monthly_route_location_id": lid}
    sid = _next_sqlite_bigint_id(MonthlySite)
    if sid is not None:
        ms_kw["id"] = sid

    try:
        with db.session.begin_nested():
            ms = MonthlySite(**ms_kw)
            db.session.add(ms)
            db.session.flush()
        return ms
    except IntegrityError:
        existing = MonthlySite.query.filter_by(legacy_monthly_route_location_id=lid).one_or_none()
        if existing is not None:
            return existing
        raise


def sync_testing_sites_from_legacy(loc: MonthlyRouteLocation) -> list[MonthlyTestingSite]:
    """
    Ensure ``MonthlySite`` and a primary ``MonthlyTestingSite`` exist.

    On first creation, copy fields from ``loc``. Existing testing rows are left unchanged.
    """
    site = ensure_monthly_site_for_location(loc)
    existing = (
        MonthlyTestingSite.query.filter_by(monthly_site_id=int(site.id))
        .order_by(MonthlyTestingSite.sort_order.asc())
        .all()
    )
    if existing:
        return existing

    ts_kw = dict(
        monthly_site_id=int(site.id),
        sort_order=0,
        label=None,
        **testing_site_master_fields_from_legacy(loc),
    )
    tid = _next_sqlite_bigint_id(MonthlyTestingSite)
    if tid is not None:
        ts_kw["id"] = tid
    try:
        with db.session.begin_nested():
            ts = MonthlyTestingSite(**ts_kw)
            db.session.add(ts)
            db.session.flush()
        return [ts]
    except IntegrityError:
        retry = (
            MonthlyTestingSite.query.filter_by(monthly_site_id=int(site.id))
            .order_by(MonthlyTestingSite.sort_order.asc())
            .all()
        )
        if retry:
            return retry
        raise


def refresh_primary_testing_site_from_legacy(loc: MonthlyRouteLocation) -> None:
    """Push legacy library fields onto the primary testing row (sheet import)."""
    rows = sync_testing_sites_from_legacy(loc)
    if not rows:
        return
    apply_testing_site_master_fields_from_legacy(rows[0], loc)


def get_legacy_location_for_site(site: MonthlySite) -> MonthlyRouteLocation | None:
    if site.legacy_monthly_route_location_id is None:
        return None
    return db.session.get(MonthlyRouteLocation, int(site.legacy_monthly_route_location_id))


def rollup_price_per_month(site: MonthlySite) -> Decimal | None:
    ts_list = (
        MonthlyTestingSite.query.filter_by(monthly_site_id=int(site.id)).order_by(MonthlyTestingSite.sort_order).all()
    )
    total = Decimal("0")
    any_ = False
    for ts in ts_list:
        if ts.price_per_month is not None:
            total += ts.price_per_month
            any_ = True
    return total if any_ else None


def load_site_bundle(site_id: int) -> MonthlySite | None:
    return (
        MonthlySite.query.options(
            joinedload(MonthlySite.legacy_location).joinedload(MonthlyRouteLocation.monthly_route),
            joinedload(MonthlySite.legacy_location).joinedload(MonthlyRouteLocation.linked_key),
            joinedload(MonthlySite.legacy_location).joinedload(MonthlyRouteLocation.monitoring_company),
            selectinload(MonthlySite.testing_sites).selectinload(MonthlyTestingSite.linked_key),
        )
        .filter_by(id=site_id)
        .one_or_none()
    )


def load_site_by_legacy_location_id(location_id: int) -> MonthlySite | None:
    return (
        MonthlySite.query.options(
            joinedload(MonthlySite.legacy_location).joinedload(MonthlyRouteLocation.monthly_route),
            joinedload(MonthlySite.legacy_location).joinedload(MonthlyRouteLocation.linked_key),
            joinedload(MonthlySite.legacy_location).joinedload(MonthlyRouteLocation.monitoring_company),
            selectinload(MonthlySite.testing_sites).selectinload(MonthlyTestingSite.linked_key),
        )
        .filter_by(legacy_monthly_route_location_id=location_id)
        .one_or_none()
    )


def mirror_mtsm_snapshot_to_primary_master(
    ts: MonthlyTestingSite,
    mtsm: MonthlyTestingSiteMonth,
) -> None:
    """Copy a run-month snapshot onto this ``MonthlyTestingSite`` (newest edition)."""
    ts.annual_month = mtsm.annual_month
    ts.property_management_company = mtsm.property_management_company
    ts.building_name = mtsm.building_name
    ts.panel_location = mtsm.panel_location
    ts.door_code = mtsm.door_code
    ts.ring_detail = mtsm.ring
    ts.keys = mtsm.key_number
    panel = (mtsm.panel or mtsm.facp or "").strip() or None
    ts.panel = panel
    ts.facp_detail = panel
    ts.testing_procedures = mtsm.testing_procedures
    ts.inspection_tech_notes = mtsm.inspection_tech_notes
    ts.monitoring_notes = mtsm.monitoring_notes
    ts.monitoring_account_number = mtsm.monitoring_account_number
    ts.monitoring_company_id = mtsm.monitoring_company_id


def push_primary_testing_site_display_to_legacy(loc: MonthlyRouteLocation, ts: MonthlyTestingSite) -> None:
    """Copy primary-stop display fields onto legacy ``loc`` (library sheet / detail parity)."""
    if int(ts.sort_order) != 0:
        return
    loc.annual_month = ts.annual_month
    loc.property_management_company = ts.property_management_company
    loc.property_management_company_normalized = (ts.property_management_company or "").casefold()
    loc.building = ts.building_name
    loc.building_normalized = (ts.building_name or "").casefold()
    loc.price_per_month = ts.price_per_month
    loc.ring_detail = ts.ring_detail
    panel = (ts.panel or ts.facp_detail or "").strip() or None
    loc.facp_detail = panel
    loc.testing_procedures = ts.testing_procedures
    loc.inspection_tech_notes = ts.inspection_tech_notes
    loc.monitoring_company_id = ts.monitoring_company_id


def apply_panel_fields_to_primary_testing_site(
    loc: MonthlyRouteLocation,
    *,
    panel: str | None,
    panel_location: str | None,
) -> None:
    """Set legacy ``facp_detail`` and primary v2 stop ``panel`` / ``panel_location``."""
    loc.facp_detail = panel
    try:
        rows = sync_testing_sites_from_legacy(loc)
    except (OperationalError, ProgrammingError):
        # Route-import tests use a reduced SQLite schema without v2 tables.
        return
    if not rows:
        return
    primary = min(rows, key=lambda t: int(t.sort_order))
    primary.panel = panel
    primary.facp_detail = panel
    primary.panel_location = panel_location


def apply_monitoring_fields_to_primary_testing_site(
    loc: MonthlyRouteLocation,
    *,
    monitoring_company_id: int | None,
    monitoring_account_number: str | None,
    monitoring_notes: str | None,
) -> None:
    """Set primary v2 stop monitoring FK, account number, and notes."""
    try:
        rows = sync_testing_sites_from_legacy(loc)
    except (OperationalError, ProgrammingError):
        return
    if not rows:
        return
    primary = min(rows, key=lambda t: int(t.sort_order))
    primary.monitoring_company_id = monitoring_company_id
    primary.monitoring_account_number = monitoring_account_number
    primary.monitoring_notes = monitoring_notes


def push_testing_site_keys_to_legacy(loc: MonthlyRouteLocation) -> None:
    """Copy key fields from the primary ``MonthlyTestingSite`` onto ``loc`` (dual-write)."""
    site = loc.monthly_site
    if site is None:
        return
    primary = (
        MonthlyTestingSite.query.filter_by(monthly_site_id=int(site.id))
        .order_by(MonthlyTestingSite.sort_order.asc())
        .first()
    )
    if primary is None:
        return
    loc.key_id = primary.key_id
    loc.keys = primary.keys
    loc.barcode = primary.barcode


def push_legacy_keys_to_primary_testing_site(loc: MonthlyRouteLocation) -> None:
    """Copy key fields from legacy location onto primary testing row (dual-write)."""
    site = loc.monthly_site
    if site is None:
        return
    primary = (
        MonthlyTestingSite.query.filter_by(monthly_site_id=int(site.id))
        .order_by(MonthlyTestingSite.sort_order.asc())
        .first()
    )
    if primary is None:
        return
    primary.key_id = loc.key_id
    primary.keys = loc.keys
    primary.barcode = loc.barcode


def mirror_master_to_mtsm_snapshot(
    ts: MonthlyTestingSite,
    loc: MonthlyRouteLocation,
    mtsm: MonthlyTestingSiteMonth,
) -> bool:
    """Copy library master snapshot fields onto a stop-month row.

    Reverse of ``mirror_mtsm_snapshot_to_primary_master`` — keeps open prep paperwork aligned
    with site details edits without requiring Regenerate from latest data.
    """
    from app.monthly.site_field_template import master_template_fields

    template = master_template_fields(ts, loc)
    changed = False

    def _set(attr: str, value: object) -> None:
        nonlocal changed
        if getattr(mtsm, attr) != value:
            setattr(mtsm, attr, value)
            changed = True

    _set("annual_month", template.get("annual_month"))
    _set("property_management_company", template.get("property_management_company"))
    _set("building_name", template.get("building_name"))
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
    _set("monitoring_company_id", template.get("monitoring_company_id"))
    _set("monitoring_company_name", template.get("monitoring_company_name"))
    return changed


def sync_open_prep_mtsm_rows_from_master(
    ts: MonthlyTestingSite,
    loc: MonthlyRouteLocation | None,
) -> int:
    """After a library master edit, refresh open prep ``MonthlyTestingSiteMonth`` rows."""
    if loc is None or loc.monthly_route_id is None:
        return 0

    from app.monthly.run_workflow import run_in_office_prep_phase

    route_id = int(loc.monthly_route_id)
    mtsm_rows = (
        MonthlyTestingSiteMonth.query.filter_by(monthly_testing_site_id=int(ts.id))
        .filter(MonthlyTestingSiteMonth.test_monthly_route_id == route_id)
        .all()
    )
    synced = 0
    for mtsm in mtsm_rows:
        run = MonthlyRouteRun.query.filter_by(
            monthly_route_id=route_id,
            month_date=mtsm.month_date,
        ).one_or_none()
        if run is not None and not run_in_office_prep_phase(run):
            continue
        mirror_master_to_mtsm_snapshot(ts, loc, mtsm)
        synced += 1
    return synced
