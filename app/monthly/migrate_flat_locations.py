"""In-place migration from billing-location + testing-sites to flat ``MonthlyLocation``."""

from __future__ import annotations

import csv
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload, selectinload

from app.db_models import (
    MonthlyLocation,
    MonthlyLocationComment,
    MonthlyLocationDeficiency,
    MonthlyLocationMonth,
    MonthlyMigrationConflict,
    MonthlyStopClockEvent,
    db,
)
from app.monthly.legacy_orm_migration import (
    MonthlyRouteLocation,
    MonthlyRouteLocationComment,
    MonthlyRouteTestHistory,
    MonthlySite,
    MonthlyTestingSite,
    MonthlyTestingSiteDeficiency,
    MonthlyTestingSiteMonth,
)
from app.monthly.location_identity import identity_key, normalize_address, normalize_label, normalize_pmc

logger = logging.getLogger(__name__)


@dataclass
class MigrationStats:
    locations_created: int = 0
    months_migrated: int = 0
    conflicts: int = 0
    warnings: list[str] = field(default_factory=list)


@dataclass
class _PlannedLocation:
    legacy_route_location_id: int
    legacy_testing_site_id: int
    address: str
    label: str
    pmc: str | None
    pmc_normalized: str
    sort_order: int
    route_stop_order: int | None
    testing_site: MonthlyTestingSite
    parent: MonthlyRouteLocation


def _normalize_text(value: object) -> str | None:
    if value is None:
        return None
    text_val = str(value).strip()
    return text_val or None


def _panel_from_testing_site(ts: MonthlyTestingSite) -> str | None:
    return _normalize_text(ts.panel) or _normalize_text(ts.facp_detail)


def _compute_split_addresses(
    parent: MonthlyRouteLocation,
    sites: list[MonthlyTestingSite],
) -> list[tuple[str, str]]:
    """Return (address, label) per site sorted by sort_order."""
    ordered = sorted(sites, key=lambda s: int(s.sort_order))
    billing_address = _normalize_text(parent.address) or _normalize_text(parent.display_address) or ""

    def _site_label(ts: MonthlyTestingSite) -> str:
        label = _normalize_text(ts.label) or billing_address
        building_name = _normalize_text(getattr(ts, "building_name", None))
        if building_name and normalize_address(label) == normalize_address(billing_address):
            return f"{billing_address} {building_name}"
        return label

    secondary_addresses: list[str] = []
    for ts in ordered:
        if int(ts.sort_order) > 0:
            sec = _site_label(ts)
            secondary_addresses.append(normalize_address(sec))

    out: list[tuple[str, str]] = []
    for ts in ordered:
        label = _site_label(ts)
        if int(ts.sort_order) == 0:
            addr_norm_billing = normalize_address(billing_address)
            if addr_norm_billing in secondary_addresses:
                address = label
            else:
                address = billing_address
        else:
            address = _site_label(ts)
        out.append((address, label))
    return out


def _plan_locations_for_parent(
    parent: MonthlyRouteLocation,
    sites: list[MonthlyTestingSite],
) -> list[_PlannedLocation]:
    if not sites:
        sites = []

    if not sites:
        # Legacy row without v2 testing sites — synthesize one virtual site from parent
        address = _normalize_text(parent.address) or _normalize_text(parent.display_address) or "Unknown"
        label = address
        pmc = _normalize_text(parent.property_management_company)
        return [
            _PlannedLocation(
                legacy_route_location_id=int(parent.id),
                legacy_testing_site_id=0,
                address=address,
                label=label,
                pmc=pmc,
                pmc_normalized=normalize_pmc(pmc),
                sort_order=0,
                route_stop_order=parent.route_stop_order,
                testing_site=_SyntheticSite(parent),
                parent=parent,
            )
        ]

    addr_labels = _compute_split_addresses(parent, sites)
    ordered = sorted(sites, key=lambda s: int(s.sort_order))
    parent_order = parent.route_stop_order
    n = len(ordered)
    out: list[_PlannedLocation] = []
    for idx, (ts, (address, label)) in enumerate(zip(ordered, addr_labels)):
        pmc = _normalize_text(ts.property_management_company) or _normalize_text(parent.property_management_company)
        if parent_order is None:
            stop_order = None
        elif int(ts.sort_order) == 0:
            stop_order = int(parent_order)
        else:
            stop_order = int(parent_order) + int(ts.sort_order)
        out.append(
            _PlannedLocation(
                legacy_route_location_id=int(parent.id),
                legacy_testing_site_id=int(ts.id),
                address=address,
                label=label,
                pmc=pmc,
                pmc_normalized=normalize_pmc(pmc),
                sort_order=int(ts.sort_order),
                route_stop_order=stop_order,
                testing_site=ts,
                parent=parent,
            )
        )
    if n > 1 and parent_order is not None:
        # bump handled separately on route
        pass
    return out


class _SyntheticSite:
    """Stand-in when no MonthlyTestingSite exists."""

    def __init__(self, loc: MonthlyRouteLocation):
        self.id = 0
        self.sort_order = 0
        self.label = None
        self.price_per_month = loc.price_per_month
        self.ring_detail = loc.ring_detail
        self.facp_detail = loc.facp_detail
        self.panel = None
        self.panel_location = None
        self.door_code = None
        self.annual_month = loc.annual_month
        self.property_management_company = loc.property_management_company
        self.testing_procedures = loc.testing_procedures
        self.inspection_tech_notes = loc.inspection_tech_notes
        self.key_id = loc.key_id
        self.keys = loc.keys
        self.barcode = loc.barcode
        self.monitoring_company_id = loc.monitoring_company_id
        self.monitoring_account_number = None
        self.monitoring_password = None
        self.monitoring_notes = None


def _build_monthly_location(plan: _PlannedLocation) -> MonthlyLocation:
    parent = plan.parent
    ts = plan.testing_site
    panel = _panel_from_testing_site(ts) if hasattr(ts, "panel") else _normalize_text(parent.facp_detail)
    return MonthlyLocation(
        address=plan.address,
        address_normalized=normalize_address(plan.address),
        label=plan.label,
        label_normalized=normalize_label(plan.label),
        property_management_company=plan.pmc,
        property_management_company_normalized=plan.pmc_normalized,
        notes=parent.notes,
        billing_comments=parent.billing_comments,
        barcode=getattr(ts, "barcode", None) or parent.barcode,
        price_per_month=getattr(ts, "price_per_month", None) or parent.price_per_month,
        area=parent.area,
        start_up_date=parent.start_up_date,
        status_normalized=parent.status_normalized,
        status_raw=parent.status_raw,
        keys=getattr(ts, "keys", None) or parent.keys,
        test_day=parent.test_day,
        annual_month=getattr(ts, "annual_month", None) or parent.annual_month,
        display_address=parent.display_address,
        latitude=parent.latitude,
        longitude=parent.longitude,
        monthly_route_id=parent.monthly_route_id,
        route_stop_order=plan.route_stop_order,
        service_trade_site_location_id=parent.service_trade_site_location_id if plan.sort_order == 0 else None,
        key_id=getattr(ts, "key_id", None) or parent.key_id,
        monitoring_company_id=getattr(ts, "monitoring_company_id", None) or parent.monitoring_company_id,
        pending_monitoring_company_proposal_id=parent.pending_monitoring_company_proposal_id,
        annual_month_pending=parent.annual_month_pending,
        annual_month_pending_submitted_at=parent.annual_month_pending_submitted_at,
        annual_month_pending_submitted_by_name=parent.annual_month_pending_submitted_by_name,
        ring_detail=getattr(ts, "ring_detail", None) or parent.ring_detail,
        facp_detail=getattr(ts, "facp_detail", None) or parent.facp_detail,
        panel=panel,
        panel_location=getattr(ts, "panel_location", None),
        door_code=getattr(ts, "door_code", None),
        testing_procedures=getattr(ts, "testing_procedures", None) or parent.testing_procedures,
        inspection_tech_notes=getattr(ts, "inspection_tech_notes", None) or parent.inspection_tech_notes,
        monitoring_account_number=getattr(ts, "monitoring_account_number", None),
        monitoring_password=getattr(ts, "monitoring_password", None),
        monitoring_notes=getattr(ts, "monitoring_notes", None),
        legacy_monthly_route_location_id=plan.legacy_route_location_id,
        legacy_monthly_testing_site_id=plan.legacy_testing_site_id or None,
    )


def _next_sqlite_bigint_id(model) -> int | None:
    if "sqlite" not in (str(db.engine.url) or "").lower():
        return None
    bind = db.session.get_bind()
    insp = __import__("sqlalchemy").inspect(bind)
    tables = (
        MonthlyLocation,
        MonthlyLocationMonth,
        MonthlyMigrationConflict,
    )
    current_max = 0
    for table_model in tables:
        if not insp.has_table(table_model.__tablename__):
            continue
        current_max = max(
            current_max,
            int(db.session.query(func.coalesce(func.max(table_model.id), 0)).scalar() or 0),
        )
    return current_max + 1


def _find_monthly_location_by_identity(address: str, pmc_normalized: str, label_normalized: str) -> MonthlyLocation | None:
    return MonthlyLocation.query.filter_by(
        address_normalized=normalize_address(address),
        property_management_company_normalized=pmc_normalized,
        label_normalized=label_normalized,
    ).one_or_none()


def _record_conflict(
    plan: _PlannedLocation,
    reason: str,
    detail: str | None,
    stats: MigrationStats,
    jsonl: list[dict[str, Any]],
) -> None:
    stats.conflicts += 1
    row_kw: dict[str, object] = {
        "legacy_monthly_route_location_id": plan.legacy_route_location_id,
        "legacy_monthly_testing_site_id": plan.legacy_testing_site_id or None,
        "intended_address": plan.address,
        "intended_label": plan.label,
        "intended_pmc": plan.pmc,
        "reason": reason,
        "detail": detail,
    }
    nid = _next_sqlite_bigint_id(MonthlyMigrationConflict)
    if nid is not None:
        row_kw["id"] = nid
    row = MonthlyMigrationConflict(**row_kw)
    db.session.add(row)
    jsonl.append(
        {
            "action": "conflict",
            "legacy_route_location_id": plan.legacy_route_location_id,
            "legacy_testing_site_id": plan.legacy_testing_site_id,
            "reason": reason,
            "detail": detail,
        }
    )


def _bump_route_orders(route_id: int, from_order: int, delta: int) -> None:
    if delta <= 0:
        return
    rows = (
        MonthlyRouteLocation.query.filter(
            MonthlyRouteLocation.monthly_route_id == route_id,
            MonthlyRouteLocation.route_stop_order.isnot(None),
            MonthlyRouteLocation.route_stop_order >= from_order + 1,
        )
        .order_by(MonthlyRouteLocation.route_stop_order.desc())
        .all()
    )
    for loc in rows:
        loc.route_stop_order = int(loc.route_stop_order) + delta


def migrate_flat_locations(
    *,
    execute: bool = False,
    report_dir: Path | None = None,
    allow_conflicts: bool = False,
) -> MigrationStats:
    """Migrate legacy billing/testing-site rows into ``monthly_location`` (+ months)."""
    logger.info("Beginning flat monthly-location migration; execute=%s allow_conflicts=%s", execute, allow_conflicts)
    stats = MigrationStats()
    jsonl: list[dict[str, Any]] = []
    conflict_rows: list[dict[str, str]] = []
    ts_to_new_id: dict[int, int] = {}
    legacy_loc_to_new_ids: dict[int, list[int]] = {}

    parents = (
        MonthlyRouteLocation.query.options(
            joinedload(MonthlyRouteLocation.monthly_site).selectinload(MonthlySite.testing_sites),
        )
        .order_by(MonthlyRouteLocation.id.asc())
        .all()
    )

    seen_identity: set[tuple[str, str, str]] = set()
    planned_all: list[_PlannedLocation] = []

    for parent in parents:
        sites = []
        if parent.monthly_site is not None:
            sites = list(parent.monthly_site.testing_sites or [])
        plans = _plan_locations_for_parent(parent, sites)
        if len(plans) > 1 and parent.route_stop_order is not None and parent.monthly_route_id is not None:
            _bump_route_orders(
                int(parent.monthly_route_id),
                int(parent.route_stop_order),
                len(plans) - 1,
            )
        planned_all.extend(plans)

    if execute:
        db.session.flush()

    logger.info("Planned %s location rows from %s legacy parent rows", len(planned_all), len(parents))
    logger.info("Starting location creation loop")

    for plan in planned_all:
        key = identity_key(plan.address, plan.pmc, plan.label)
        existing = _find_monthly_location_by_identity(
            plan.address,
            plan.pmc_normalized,
            normalize_label(plan.label),
        )

        if existing is not None:
            if key in seen_identity:
                _record_conflict(plan, "duplicate_identity", f"key={key}", stats, jsonl)
                conflict_rows.append(
                    {
                        "legacy_route_location_id": str(plan.legacy_route_location_id),
                        "legacy_testing_site_id": str(plan.legacy_testing_site_id),
                        "address": plan.address,
                        "label": plan.label,
                        "pmc": plan.pmc or "",
                        "reason": "duplicate_identity",
                    }
                )
                db.session.flush()
                continue

            reused_id = int(existing.id)
            stats.warnings.append(
                f"reused_existing_location:{reused_id}:{plan.legacy_route_location_id}:{plan.legacy_testing_site_id}"
            )
            if plan.legacy_testing_site_id:
                ts_to_new_id[plan.legacy_testing_site_id] = reused_id
            legacy_loc_to_new_ids.setdefault(plan.legacy_route_location_id, []).append(reused_id)
            jsonl.append(
                {
                    "action": "reused_existing_location",
                    "legacy_route_location_id": plan.legacy_route_location_id,
                    "legacy_testing_site_id": plan.legacy_testing_site_id,
                    "existing_location_id": reused_id,
                }
            )
            if key not in seen_identity:
                seen_identity.add(key)
            continue

        if key in seen_identity:
            # Multiple legacy plans produce the same identity, but no existing
            # DB row exists yet. Record the duplicate identity for review.
            _record_conflict(plan, "duplicate_identity", f"key={key}", stats, jsonl)
            conflict_rows.append(
                {
                    "legacy_route_location_id": str(plan.legacy_route_location_id),
                    "legacy_testing_site_id": str(plan.legacy_testing_site_id),
                    "address": plan.address,
                    "label": plan.label,
                    "pmc": plan.pmc or "",
                    "reason": "duplicate_identity",
                }
            )
            db.session.flush()
            continue

        seen_identity.add(key)

        if not execute:
            stats.locations_created += 1
            if plan.legacy_testing_site_id:
                ts_to_new_id[plan.legacy_testing_site_id] = -1
            legacy_loc_to_new_ids.setdefault(plan.legacy_route_location_id, []).append(-1)
            continue

        loc = _build_monthly_location(plan)
        nid = _next_sqlite_bigint_id(MonthlyLocation)
        if nid is not None:
            loc.id = nid
        try:
            with db.session.begin_nested():
                db.session.add(loc)
                db.session.flush()
        except IntegrityError as exc:
            db.session.rollback()
            existing = _find_monthly_location_by_identity(
                plan.address,
                plan.pmc_normalized,
                normalize_label(plan.label),
            )
            if existing is not None:
                reused_id = int(existing.id)
                stats.warnings.append(
                    f"reused_existing_location:{reused_id}:{plan.legacy_route_location_id}:{plan.legacy_testing_site_id}"
                )
                if plan.legacy_testing_site_id:
                    ts_to_new_id[plan.legacy_testing_site_id] = reused_id
                legacy_loc_to_new_ids.setdefault(plan.legacy_route_location_id, []).append(reused_id)
                jsonl.append(
                    {
                        "action": "reused_existing_location",
                        "legacy_route_location_id": plan.legacy_route_location_id,
                        "legacy_testing_site_id": plan.legacy_testing_site_id,
                        "existing_location_id": reused_id,
                    }
                )
                continue

            _record_conflict(plan, "insert_failed", str(exc.orig), stats, jsonl)
            conflict_rows.append(
                {
                    "legacy_route_location_id": str(plan.legacy_route_location_id),
                    "legacy_testing_site_id": str(plan.legacy_testing_site_id),
                    "address": plan.address,
                    "label": plan.label,
                    "pmc": plan.pmc or "",
                    "reason": "insert_failed",
                }
            )
            continue

        stats.locations_created += 1
        new_id = int(loc.id)
        if plan.legacy_testing_site_id:
            ts_to_new_id[plan.legacy_testing_site_id] = new_id
        legacy_loc_to_new_ids.setdefault(plan.legacy_route_location_id, []).append(new_id)
        jsonl.append(
            {
                "action": "create_location",
                "legacy_route_location_id": plan.legacy_route_location_id,
                "legacy_testing_site_id": plan.legacy_testing_site_id,
                "new_location_id": new_id,
            }
        )

    logger.info("Finished location creation; created=%s conflicts=%s", stats.locations_created, stats.conflicts)

    # If a report directory was requested, write audit + conflict reports even for dry-run
    if report_dir is not None:
        report_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        jsonl_path = report_dir / f"migration_audit_{ts}.jsonl"
        with jsonl_path.open("w", encoding="utf-8") as fh:
            for row in jsonl:
                fh.write(json.dumps(row) + "\n")
        if conflict_rows:
            csv_path = report_dir / f"migration_conflicts_{ts}.csv"
            with csv_path.open("w", encoding="utf-8", newline="") as fh:
                writer = csv.DictWriter(fh, fieldnames=list(conflict_rows[0].keys()))
                writer.writeheader()
                writer.writerows(conflict_rows)

    if not execute:
        logger.info("Dry run: would create %s locations", stats.locations_created)
        return stats

    bind = db.session.get_bind()
    insp = __import__("sqlalchemy").inspect(bind)

    # MTSM -> MLM
    hist_by_legacy_loc: dict[int, dict] = {}
    if insp.has_table("monthly_route_test_history"):
        for hist in MonthlyRouteTestHistory.query.all():
            hist_by_legacy_loc.setdefault(int(hist.location_id), {})[hist.month_date] = hist

    mtsm_rows: list = []
    if insp.has_table("monthly_testing_site_month"):
        mtsm_rows = MonthlyTestingSiteMonth.query.order_by(MonthlyTestingSiteMonth.id.asc()).all()
    logger.info("Migrating %s monthly_testing_site_month rows", len(mtsm_rows))
    mtsm_id_to_mlm_id: dict[int, int] = {}
    migrated_location_months: set[tuple[int, object]] = set()

    for mtsm in mtsm_rows:
        ts_id = int(mtsm.monthly_testing_site_id)
        new_loc_id = ts_to_new_id.get(ts_id)
        if new_loc_id is None:
            stats.warnings.append(f"orphan_mtsm:{mtsm.id}:testing_site:{ts_id}")
            continue
        parent_hist = None
        site = MonthlyTestingSite.query.get(ts_id)
        if site and site.monthly_site:
            legacy_parent_id = site.monthly_site.legacy_monthly_route_location_id
            if legacy_parent_id:
                parent_hist = (hist_by_legacy_loc.get(int(legacy_parent_id)) or {}).get(mtsm.month_date)

        billing_status = parent_hist.billing_status if parent_hist is not None else None

        mlm_kw: dict[str, Any] = {
            "monthly_location_id": new_loc_id,
            "month_date": mtsm.month_date,
            "run_id": mtsm.run_id,
            "test_monthly_route_id": mtsm.test_monthly_route_id,
            "session_route_stop_order": mtsm.session_route_stop_order,
            "result_status": mtsm.result_status,
            "skip_reason": mtsm.skip_reason,
            "source_value_raw": mtsm.source_value_raw,
            "facp": mtsm.facp,
            "panel": mtsm.panel,
            "panel_location": mtsm.panel_location,
            "door_code": mtsm.door_code,
            "property_management_company": mtsm.property_management_company,
            "ring": mtsm.ring,
            "key_number": mtsm.key_number,
            "annual_month": mtsm.annual_month,
            "testing_procedures": mtsm.testing_procedures,
            "inspection_tech_notes": mtsm.inspection_tech_notes,
            "run_comments": mtsm.run_comments,
            "office_job_comment": mtsm.office_job_comment,
            "office_attention": mtsm.office_attention,
            "prior_month_out_of_order_dismissed": mtsm.prior_month_out_of_order_dismissed,
            "sheet_time_in_raw": mtsm.sheet_time_in_raw,
            "sheet_time_out_raw": mtsm.sheet_time_out_raw,
            "test_outcome": mtsm.test_outcome,
            "skip_category": mtsm.skip_category,
            "skip_note": mtsm.skip_note,
            "confirmed_no_deficiencies": mtsm.confirmed_no_deficiencies,
            "monitoring_company_name": mtsm.monitoring_company_name,
            "monitoring_company_id": mtsm.monitoring_company_id,
            "monitoring_account_number": mtsm.monitoring_account_number,
            "monitoring_password": mtsm.monitoring_password,
            "monitoring_notes": mtsm.monitoring_notes,
            "billing_status": billing_status,
        }
        nid = _next_sqlite_bigint_id(MonthlyLocationMonth)
        if nid is not None:
            mlm_kw["id"] = nid
        # If a monthly_location_month for this (location, month) already
        # exists (from a prior partial run), reuse it instead of inserting
        # to avoid unique-constraint collisions. This makes the migration
        # idempotent and restartable.
        exists_mlm = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=new_loc_id,
            month_date=mtsm.month_date,
        ).one_or_none()
        if exists_mlm is not None:
            mtsm_id_to_mlm_id[int(mtsm.id)] = int(exists_mlm.id)
            migrated_location_months.add((new_loc_id, mtsm.month_date))
            # don't double-count migrated months
            continue

        mlm = MonthlyLocationMonth(**mlm_kw)
        try:
            with db.session.begin_nested():
                db.session.add(mlm)
                db.session.flush()
        except IntegrityError:
            db.session.rollback()
            existing_after = MonthlyLocationMonth.query.filter_by(
                monthly_location_id=new_loc_id,
                month_date=mtsm.month_date,
            ).one_or_none()
            if existing_after is not None:
                mtsm_id_to_mlm_id[int(mtsm.id)] = int(existing_after.id)
                migrated_location_months.add((new_loc_id, mtsm.month_date))
                stats.warnings.append(
                    f"reused_existing_location_month:{existing_after.id}:{new_loc_id}:{mtsm.month_date}"
                )
                continue
            raise
        mtsm_id_to_mlm_id[int(mtsm.id)] = int(mlm.id)
        migrated_location_months.add((new_loc_id, mtsm.month_date))
        stats.months_migrated += 1

    logger.info("Migrated %s monthly location months so far", stats.months_migrated)

    # History-only months (no MTSM) for synthetic single-site parents
    for legacy_loc_id, new_ids in legacy_loc_to_new_ids.items():
        if len(new_ids) != 1:
            continue
        new_loc_id = new_ids[0]
        for month_date, hist in (hist_by_legacy_loc.get(legacy_loc_id) or {}).items():
            if (new_loc_id, month_date) in migrated_location_months:
                continue
            exists = MonthlyLocationMonth.query.filter_by(
                monthly_location_id=new_loc_id,
                month_date=month_date,
            ).one_or_none()
            if exists is not None:
                continue
            mlm_kw = {
                "monthly_location_id": new_loc_id,
                "month_date": month_date,
                "run_id": hist.run_id,
                "test_monthly_route_id": hist.test_monthly_route_id,
                "session_route_stop_order": hist.session_route_stop_order,
                "result_status": hist.result_status,
                "skip_reason": hist.skip_reason,
                "source_value_raw": hist.source_value_raw,
                "facp": hist.facp,
                "ring": hist.ring,
                "key_number": hist.key_number,
                "annual_month": hist.annual_month,
                "testing_procedures": hist.testing_procedures,
                "inspection_tech_notes": hist.inspection_tech_notes,
                "sheet_time_in_raw": hist.sheet_time_in_raw,
                "sheet_time_out_raw": hist.sheet_time_out_raw,
                "monitoring_notes": hist.monitoring_notes,
                "billing_status": hist.billing_status,
            }
            nid = _next_sqlite_bigint_id(MonthlyLocationMonth)
            if nid is not None:
                mlm_kw["id"] = nid
            db.session.add(MonthlyLocationMonth(**mlm_kw))
            stats.months_migrated += 1

    # Clock events — column rename handled in alembic; here copy if old column still exists
    logger.info("Relinking %s clock events to new monthly_location_month rows", len(mtsm_id_to_mlm_id))
    _migrate_clock_events(mtsm_id_to_mlm_id, stats)
    logger.info("Finished relinking clock events")

    # Deficiencies
    if insp.has_table("monthly_testing_site_deficiency"):
        for def_row in MonthlyTestingSiteDeficiency.query.all():
            new_loc_id = ts_to_new_id.get(int(def_row.monthly_testing_site_id))
            if new_loc_id is None:
                continue
            db.session.add(
                MonthlyLocationDeficiency(
                    monthly_location_id=new_loc_id,
                    created_run_id=def_row.created_run_id,
                    title=def_row.title,
                    severity=def_row.severity,
                    status=def_row.status,
                    description=def_row.description,
                    verification_notes=def_row.verification_notes,
                    reported_by_tech_id=def_row.reported_by_tech_id,
                    reported_by_tech_name=def_row.reported_by_tech_name,
                    last_edited_by_tech_id=def_row.last_edited_by_tech_id,
                    last_edited_by_tech_name=def_row.last_edited_by_tech_name,
                    created_at=def_row.created_at,
                    updated_at=def_row.updated_at,
                )
            )

    # Quarter billed — remap legacy location_id via raw SQL when table exists
    logger.info("Updating quarterly billed location references")
    if insp.has_table("monthly_location_quarter_billed"):
        for legacy_loc_id, new_ids in legacy_loc_to_new_ids.items():
            if not new_ids:
                continue
            db.session.execute(
                text(
                    "UPDATE monthly_location_quarter_billed SET location_id = :new_id "
                    "WHERE location_id = :legacy_id"
                ),
                {"new_id": new_ids[0], "legacy_id": legacy_loc_id},
            )

    # Tickets — remap monthly_route_location_id when legacy column exists
    logger.info("Updating ticket location references")
    if insp.has_table("monthly_location_ticket"):
        cols = {c["name"] for c in insp.get_columns("monthly_location_ticket")}
        if "monthly_route_location_id" in cols:
            for legacy_loc_id, new_ids in legacy_loc_to_new_ids.items():
                if not new_ids:
                    continue
                db.session.execute(
                    text(
                        "UPDATE monthly_location_ticket SET monthly_route_location_id = :new_id "
                        "WHERE monthly_route_location_id = :legacy_id"
                    ),
                    {"new_id": new_ids[0], "legacy_id": legacy_loc_id},
                )
        elif "monthly_location_id" in cols:
            for legacy_loc_id, new_ids in legacy_loc_to_new_ids.items():
                if not new_ids:
                    continue
                db.session.execute(
                    text(
                        "UPDATE monthly_location_ticket SET monthly_location_id = :new_id "
                        "WHERE monthly_location_id = :legacy_id"
                    ),
                    {"new_id": new_ids[0], "legacy_id": legacy_loc_id},
                )

    # Comments
    logger.info("Migrating comments")
    if insp.has_table("monthly_route_location_comment"):
        for comment in MonthlyRouteLocationComment.query.all():
            new_ids = legacy_loc_to_new_ids.get(int(comment.location_id))
            if not new_ids:
                continue
            db.session.add(
                MonthlyLocationComment(
                    location_id=new_ids[0],
                    body=comment.body,
                    author_username=comment.author_username,
                    created_at=comment.created_at,
                    updated_at=comment.updated_at,
                )
            )

    # Worksheet audit events — remap legacy route-location references to flat monthly_location rows.
    if insp.has_table("monthly_route_worksheet_audit_event"):
        cols = {c["name"] for c in insp.get_columns("monthly_route_worksheet_audit_event")}
        if "location_month_row_id" not in cols:
            db.session.execute(
                text(
                    "ALTER TABLE monthly_route_worksheet_audit_event ADD COLUMN location_month_row_id BIGINT"
                )
            )
            cols.add("location_month_row_id")

        if "history_row_id" in cols:
            db.session.execute(
                text(
                    "UPDATE monthly_route_worksheet_audit_event AS e "
                    "SET location_month_row_id = mlm.id "
                    "FROM monthly_route_test_history AS h "
                    "JOIN monthly_location AS ml "
                    "  ON ml.legacy_monthly_route_location_id = h.location_id "
                    "JOIN monthly_location_month AS mlm "
                    "  ON mlm.monthly_location_id = ml.id "
                    "  AND mlm.month_date = h.month_date "
                    "  AND (h.key_number IS NULL OR mlm.key_number = h.key_number) "
                    "WHERE e.history_row_id = h.id "
                    "  AND e.location_month_row_id IS NULL"
                )
            )

        db.session.execute(
            text(
                "UPDATE monthly_route_worksheet_audit_event AS e "
                "SET location_id = mlm.monthly_location_id "
                "FROM monthly_location_month AS mlm "
                "WHERE e.location_month_row_id = mlm.id "
                "  AND e.location_id NOT IN (SELECT id FROM monthly_location)"
            )
        )

        q = db.session.execute(
            text(
                "SELECT COUNT(*) FROM monthly_route_worksheet_audit_event "
                "WHERE location_id NOT IN (SELECT id FROM monthly_location)"
            )
        )
        orphan_count = int(q.scalar() or 0)
        if orphan_count:
            stats.warnings.append(f"orphan_worksheet_audit_location_ids={orphan_count}")

        if "history_row_id" in cols and "location_month_row_id" in cols:
            q2 = db.session.execute(
                text(
                    "SELECT COUNT(*) FROM monthly_route_worksheet_audit_event "
                    "WHERE history_row_id IS NOT NULL AND location_month_row_id IS NULL"
                )
            )
            orphan_month_row_count = int(q2.scalar() or 0)
            if orphan_month_row_count:
                stats.warnings.append(
                    f"orphan_worksheet_audit_location_month_row_ids={orphan_month_row_count}"
                )

    # Audit events — skip during migration (legacy history_row_id); office audit re-seeds on new runs

    if report_dir is not None:
        report_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        jsonl_path = report_dir / f"migration_audit_{ts}.jsonl"
        with jsonl_path.open("w", encoding="utf-8") as fh:
            for row in jsonl:
                fh.write(json.dumps(row) + "\n")
        if conflict_rows:
            csv_path = report_dir / f"migration_conflicts_{ts}.csv"
            with csv_path.open("w", encoding="utf-8", newline="") as fh:
                writer = csv.DictWriter(fh, fieldnames=list(conflict_rows[0].keys()))
                writer.writeheader()
                writer.writerows(conflict_rows)

    logger.info(
        "Migration complete: locations_created=%s months_migrated=%s conflicts=%s warnings=%s",
        stats.locations_created,
        stats.months_migrated,
        stats.conflicts,
        len(stats.warnings),
    )
    if stats.conflicts and not allow_conflicts:
        logger.error("Migration finished with %s conflicts", stats.conflicts)

    return stats


def _migrate_clock_events(mtsm_id_to_mlm_id: dict[int, int], stats: MigrationStats) -> None:
    """Re-link clock events to new location month rows."""
    bind = db.session.get_bind()
    insp = db.inspect(bind)
    if not insp.has_table("monthly_stop_clock_event"):
        return
    cols = {c["name"] for c in insp.get_columns("monthly_stop_clock_event")}
    if "monthly_location_month_id" in cols:
        for old_id, new_mlm_id in mtsm_id_to_mlm_id.items():
            db.session.execute(
                text(
                    "UPDATE monthly_stop_clock_event SET monthly_location_month_id = :new_id "
                    "WHERE monthly_testing_site_month_id = :old_id"
                ),
                {"new_id": new_mlm_id, "old_id": old_id},
            )
    elif "monthly_testing_site_month_id" in cols:
        for ev in MonthlyStopClockEvent.query.all():
            old_mtsm = int(ev.monthly_testing_site_month_id)
            new_mlm = mtsm_id_to_mlm_id.get(old_mtsm)
            if new_mlm is not None and hasattr(ev, "monthly_location_month_id"):
                ev.monthly_location_month_id = new_mlm
