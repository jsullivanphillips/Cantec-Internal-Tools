"""Create or update v2 ``MonthlySite`` / ``MonthlyTestingSite`` rows from legacy ``MonthlyRouteLocation``."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload, selectinload

from app.db_models import MonthlyRouteLocation, MonthlySite, MonthlyTestingSite, db


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
        price_per_month=loc.price_per_month,
        ring_detail=loc.ring_detail,
        facp_detail=loc.facp_detail,
        testing_procedures=loc.testing_procedures,
        inspection_tech_notes=loc.inspection_tech_notes,
        keys=loc.keys,
        barcode=loc.barcode,
        key_id=loc.key_id,
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
    primary = rows[0]
    primary.price_per_month = loc.price_per_month
    primary.ring_detail = loc.ring_detail
    primary.facp_detail = loc.facp_detail
    primary.testing_procedures = loc.testing_procedures
    primary.inspection_tech_notes = loc.inspection_tech_notes
    primary.keys = loc.keys
    primary.barcode = loc.barcode
    primary.key_id = loc.key_id


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
