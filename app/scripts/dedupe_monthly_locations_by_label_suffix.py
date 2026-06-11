from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import func, inspect
from sqlalchemy.exc import OperationalError

from app import create_app, db
from app.db_models import (
    MonthlyLocation,
    MonthlyLocationComment,
    MonthlyLocationDeficiency,
    MonthlyLocationMonth,
    MonthlyLocationQuarterBilled,
    MonthlyLocationTicket,
    MonthlyRouteWorksheetAuditEvent,
    MonthlyStopClockEvent,
)
from app.monthly.location_identity import normalize_identity_text
from app.monthly.mapbox_routes import invalidate_monthly_route_path


DEFAULT_REPORT_DIR = Path("logs/monthly_location_dedupe")

LOCATION_COMPARE_FIELDS = (
    "address",
    "address_normalized",
    "property_management_company",
    "property_management_company_normalized",
    "notes",
    "billing_comments",
    "barcode",
    "price_per_month",
    "area",
    "start_up_date",
    "status_normalized",
    "status_raw",
    "keys",
    "test_day",
    "annual_month",
    "display_address",
    "latitude",
    "longitude",
    "monthly_route_id",
    "route_stop_order",
    "service_trade_site_location_id",
    "key_id",
    "monitoring_company_id",
    "pending_monitoring_company_proposal_id",
    "annual_month_pending",
    "annual_month_pending_submitted_at",
    "annual_month_pending_submitted_by_name",
    "ring_detail",
    "facp_detail",
    "panel",
    "panel_location",
    "door_code",
    "testing_procedures",
    "inspection_tech_notes",
    "monitoring_account_number",
    "monitoring_password",
    "monitoring_notes",
    "legacy_monthly_route_location_id",
    "legacy_monthly_testing_site_id",
)

MONTH_ROW_COMPARE_EXCLUDE = {
    "id",
    "monthly_location_id",
    "run_id",
    "test_monthly_route_id",
    "monitoring_company_id",
    "created_at",
    "updated_at",
}

QUARTER_BILLED_COMPARE_EXCLUDE = {
    "id",
    "location_id",
}


@dataclass
class PairPlan:
    keep_id: int
    keep_label: str
    duplicate_id: int
    duplicate_label: str
    address: str
    property_management_company: str | None
    status: str
    detail: str | None
    child_counts: dict[str, int]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Dedupe MonthlyLocation rows where the only allowed difference is "
            "a label suffix like '2471 Sidney Ave' vs '2471 Sidney Ave Oceana'."
        )
    )
    parser.add_argument("--commit", action="store_true", help="Persist changes. Default is dry-run.")
    parser.add_argument(
        "--report-dir",
        default=str(DEFAULT_REPORT_DIR),
        help="Directory for CSV/JSONL reports.",
    )
    parser.add_argument("--limit", type=int, default=None, help="Limit the number of candidate pairs processed.")
    parser.add_argument("--location-id", type=int, default=None, help="Restrict to pairs touching this location id.")
    parser.add_argument("--address", default=None, help="Restrict to one normalized/bare address.")
    return parser.parse_args(argv)


def _normalize_scalar(value: Any) -> Any:
    if isinstance(value, str):
        return normalize_identity_text(value)
    if isinstance(value, Decimal):
        return str(value.normalize()) if value == value.to_integral() else str(value.normalize())
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.isoformat()
        return value.astimezone(timezone.utc).isoformat()
    return value


def _location_diff_fields(keep: MonthlyLocation, duplicate: MonthlyLocation) -> list[str]:
    diffs: list[str] = []
    for field in LOCATION_COMPARE_FIELDS:
        if _normalize_scalar(getattr(keep, field)) != _normalize_scalar(getattr(duplicate, field)):
            diffs.append(field)
    return diffs


def _row_payload(model: Any, exclude: set[str]) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for col in model.__table__.columns:
        if col.name in exclude:
            continue
        payload[col.name] = _normalize_scalar(getattr(model, col.name))
    return payload


def _label_suffix_match(shorter: MonthlyLocation, longer: MonthlyLocation) -> bool:
    short_norm = normalize_identity_text(shorter.label)
    long_norm = normalize_identity_text(longer.label)
    if not short_norm or not long_norm or len(long_norm) <= len(short_norm):
        return False
    if not long_norm.startswith(short_norm):
        return False
    return bool(long_norm[len(short_norm) :].strip())


def _child_counts(location_id: int) -> dict[str, int]:
    month_rows = MonthlyLocationMonth.query.filter_by(monthly_location_id=location_id).all()
    month_ids = [int(row.id) for row in month_rows]
    return {
        "month_rows": len(month_rows),
        "clock_events": int(
            db.session.query(func.count(MonthlyStopClockEvent.id))
            .filter(MonthlyStopClockEvent.monthly_location_month_id.in_(month_ids or [-1]))
            .scalar()
            or 0
        ),
        "audit_rows": int(
            db.session.query(func.count(MonthlyRouteWorksheetAuditEvent.id))
            .filter(MonthlyRouteWorksheetAuditEvent.location_id == location_id)
            .scalar()
            or 0
        ),
        "comments": int(db.session.query(func.count(MonthlyLocationComment.id)).filter_by(location_id=location_id).scalar() or 0),
        "deficiencies": int(
            db.session.query(func.count(MonthlyLocationDeficiency.id)).filter_by(monthly_location_id=location_id).scalar() or 0
        ),
        "tickets": int(db.session.query(func.count(MonthlyLocationTicket.id)).filter_by(monthly_location_id=location_id).scalar() or 0),
        "quarter_billed": int(
            db.session.query(func.count(MonthlyLocationQuarterBilled.id)).filter_by(location_id=location_id).scalar() or 0
        ),
    }


def _candidate_pairs(location_id: int | None = None, address: str | None = None) -> list[tuple[MonthlyLocation, MonthlyLocation]]:
    q = MonthlyLocation.query.order_by(
        MonthlyLocation.address_normalized.asc(),
        MonthlyLocation.property_management_company_normalized.asc(),
        MonthlyLocation.label_normalized.asc(),
        MonthlyLocation.id.asc(),
    )
    if address:
        normalized = normalize_identity_text(address)
        q = q.filter(
            (MonthlyLocation.address_normalized == normalized) | (func.lower(MonthlyLocation.address) == normalized)
        )
    rows = q.all()
    grouped: dict[tuple[str, str], list[MonthlyLocation]] = {}
    for row in rows:
        key = (row.address_normalized or "", row.property_management_company_normalized or "")
        grouped.setdefault(key, []).append(row)

    pairs: list[tuple[MonthlyLocation, MonthlyLocation]] = []
    for locs in grouped.values():
        if len(locs) < 2:
            continue
        ordered = sorted(locs, key=lambda row: (len(normalize_identity_text(row.label)), normalize_identity_text(row.label), int(row.id)))
        survivor = ordered[0]
        for dup in ordered[1:]:
            if location_id is not None and int(survivor.id) != location_id and int(dup.id) != location_id:
                continue
            if _label_suffix_match(survivor, dup):
                pairs.append((survivor, dup))
    return pairs


def _plan_pair(keep: MonthlyLocation, duplicate: MonthlyLocation) -> PairPlan:
    diff_fields = _location_diff_fields(keep, duplicate)
    status = "merge_candidate"
    detail: str | None = None
    if diff_fields:
        status = "skipped_non_label_difference"
        detail = ",".join(diff_fields)
    return PairPlan(
        keep_id=int(keep.id),
        keep_label=keep.label,
        duplicate_id=int(duplicate.id),
        duplicate_label=duplicate.label,
        address=keep.address,
        property_management_company=keep.property_management_company,
        status=status,
        detail=detail,
        child_counts=_child_counts(int(duplicate.id)),
    )


def _month_rows_for_location(location_id: int) -> dict[Any, MonthlyLocationMonth]:
    return {
        row.month_date: row
        for row in MonthlyLocationMonth.query.filter_by(monthly_location_id=location_id)
        .order_by(MonthlyLocationMonth.month_date.asc(), MonthlyLocationMonth.id.asc())
        .all()
    }


def _quarter_rows_for_location(location_id: int) -> dict[tuple[int, int], MonthlyLocationQuarterBilled]:
    return {
        (int(row.year), int(row.quarter)): row
        for row in MonthlyLocationQuarterBilled.query.filter_by(location_id=location_id).all()
    }


def _execute_pair_merge(keep: MonthlyLocation, duplicate: MonthlyLocation) -> tuple[str, str | None]:
    keep_months = _month_rows_for_location(int(keep.id))
    dup_months = _month_rows_for_location(int(duplicate.id))
    month_id_remap: dict[int, int] = {}

    for month_date, dup_row in dup_months.items():
        keep_row = keep_months.get(month_date)
        if keep_row is None:
            dup_row.monthly_location_id = int(keep.id)
            keep_months[month_date] = dup_row
            month_id_remap[int(dup_row.id)] = int(dup_row.id)
            continue
        keep_payload = _row_payload(keep_row, MONTH_ROW_COMPARE_EXCLUDE)
        dup_payload = _row_payload(dup_row, MONTH_ROW_COMPARE_EXCLUDE)
        if keep_payload != dup_payload:
            return "skipped_month_collision", f"month={month_date.isoformat()}"
        db.session.query(MonthlyStopClockEvent).filter_by(monthly_location_month_id=int(dup_row.id)).update(
            {"monthly_location_month_id": int(keep_row.id)},
            synchronize_session=False,
        )
        db.session.query(MonthlyRouteWorksheetAuditEvent).filter_by(location_month_row_id=int(dup_row.id)).update(
            {"location_month_row_id": int(keep_row.id), "location_id": int(keep.id)},
            synchronize_session=False,
        )
        db.session.delete(dup_row)
        month_id_remap[int(dup_row.id)] = int(keep_row.id)

    keep_quarters = _quarter_rows_for_location(int(keep.id))
    dup_quarters = _quarter_rows_for_location(int(duplicate.id))
    for key, dup_q in dup_quarters.items():
        keep_q = keep_quarters.get(key)
        if keep_q is None:
            dup_q.location_id = int(keep.id)
            keep_quarters[key] = dup_q
            continue
        keep_payload = _row_payload(keep_q, QUARTER_BILLED_COMPARE_EXCLUDE)
        dup_payload = _row_payload(dup_q, QUARTER_BILLED_COMPARE_EXCLUDE)
        if keep_payload != dup_payload:
            return "skipped_quarter_billed_collision", f"quarter={key[0]}-Q{key[1]}"
        db.session.delete(dup_q)

    db.session.query(MonthlyRouteWorksheetAuditEvent).filter_by(location_id=int(duplicate.id)).update(
        {"location_id": int(keep.id)},
        synchronize_session=False,
    )
    db.session.query(MonthlyLocationComment).filter_by(location_id=int(duplicate.id)).update(
        {"location_id": int(keep.id)},
        synchronize_session=False,
    )
    db.session.query(MonthlyLocationDeficiency).filter_by(monthly_location_id=int(duplicate.id)).update(
        {"monthly_location_id": int(keep.id)},
        synchronize_session=False,
    )
    db.session.query(MonthlyLocationTicket).filter_by(monthly_location_id=int(duplicate.id)).update(
        {"monthly_location_id": int(keep.id)},
        synchronize_session=False,
    )

    affected_routes = {rid for rid in (keep.monthly_route_id, duplicate.monthly_route_id) if rid is not None}
    db.session.delete(duplicate)
    db.session.flush()
    for route_id in affected_routes:
        _invalidate_route_path_if_available(int(route_id))
    return "merged", None


def _invalidate_route_path_if_available(route_id: int) -> None:
    try:
        if not inspect(db.engine).has_table("monthly_route_calculated_path"):
            return
        invalidate_monthly_route_path(route_id)
    except OperationalError:
        return


def _write_reports(report_dir: Path, rows: list[dict[str, Any]]) -> tuple[Path, Path]:
    report_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = report_dir / f"monthly_location_dedupe_{ts}.csv"
    jsonl_path = report_dir / f"monthly_location_dedupe_{ts}.jsonl"
    fieldnames = [
        "keep_id",
        "keep_label",
        "duplicate_id",
        "duplicate_label",
        "address",
        "property_management_company",
        "status",
        "detail",
        "month_rows",
        "clock_events",
        "audit_rows",
        "comments",
        "deficiencies",
        "tickets",
        "quarter_billed",
    ]
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    with jsonl_path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, default=str) + "\n")
    return csv_path, jsonl_path


def run_dedupe(
    *,
    execute: bool = False,
    report_dir: Path | None = DEFAULT_REPORT_DIR,
    limit: int | None = None,
    location_id: int | None = None,
    address: str | None = None,
) -> list[dict[str, Any]]:
    pairs = _candidate_pairs(location_id=location_id, address=address)
    if limit is not None:
        pairs = pairs[: max(limit, 0)]

    rows: list[dict[str, Any]] = []
    for keep, duplicate in pairs:
        plan = _plan_pair(keep, duplicate)
        row = {
            "keep_id": plan.keep_id,
            "keep_label": plan.keep_label,
            "duplicate_id": plan.duplicate_id,
            "duplicate_label": plan.duplicate_label,
            "address": plan.address,
            "property_management_company": plan.property_management_company,
            "status": plan.status,
            "detail": plan.detail,
            **plan.child_counts,
        }
        if plan.status != "merge_candidate":
            rows.append(row)
            continue
        if execute:
            try:
                status, detail = _execute_pair_merge(keep, duplicate)
                db.session.commit()
                row["status"] = status
                row["detail"] = detail
            except Exception as exc:
                db.session.rollback()
                row["status"] = "skipped_unexpected_error"
                row["detail"] = str(exc)
        rows.append(row)

    if report_dir is not None:
        csv_path, jsonl_path = _write_reports(Path(report_dir), rows)
        print(f"[monthly-location-dedupe] Wrote CSV report: {csv_path}", flush=True)
        print(f"[monthly-location-dedupe] Wrote JSONL report: {jsonl_path}", flush=True)

    counts: dict[str, int] = {}
    for row in rows:
        status = str(row["status"])
        counts[status] = counts.get(status, 0) + 1
    print(f"[monthly-location-dedupe] Summary: {counts}", flush=True)
    if not execute:
        db.session.rollback()
        print("[monthly-location-dedupe] Dry run complete. No changes committed.", flush=True)
    return rows


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    app = create_app()
    with app.app_context():
        run_dedupe(
            execute=args.commit,
            report_dir=Path(args.report_dir),
            limit=args.limit,
            location_id=args.location_id,
            address=args.address,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
