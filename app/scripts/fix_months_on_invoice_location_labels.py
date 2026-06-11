"""Fix monthly locations whose label is a billing placeholder instead of the street address.

Master sheet imports sometimes stored ``Months on invoice`` (or ``… Months on invoice``)
in ``MonthlyLocation.label``. This script moves that billing note to
``billing_comments`` and sets ``label`` to the shortened site address.

Usage:
    python -m app.scripts.fix_months_on_invoice_location_labels
    python -m app.scripts.fix_months_on_invoice_location_labels --commit
    python -m app.scripts.fix_months_on_invoice_location_labels --commit --location-id 450
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from app import create_app, db
from app.db_models import MonthlyLocation
from app.monthly.location_display import short_street_address
from app.monthly.location_identity import normalize_label

MONTHS_ON_INVOICE_LABEL_RE = re.compile(
    r"^(?:(?P<prefix>.+?)\s+)?months on invoices?(?P<extra>.*)$",
    re.IGNORECASE,
)
MONTHS_ON_INVOICE_PHRASE = "Months on invoice"
DEFAULT_REPORT_DIR = Path("logs/months_on_invoice_label_fix")


@dataclass(frozen=True)
class LabelFixPlan:
    location_id: int
    old_label: str
    new_label: str
    old_billing_comments: str | None
    new_billing_comments: str
    address: str
    status: str
    detail: str | None = None


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Persist changes. Default is dry-run.",
    )
    parser.add_argument(
        "--report-dir",
        default=str(DEFAULT_REPORT_DIR),
        help="Directory for CSV/JSONL reports.",
    )
    parser.add_argument("--limit", type=int, default=None, help="Limit locations processed.")
    parser.add_argument("--location-id", type=int, default=None, help="Restrict to one location id.")
    return parser.parse_args(argv)


def parse_months_on_invoice_label(label: str) -> tuple[bool, str | None]:
    """Return whether ``label`` is the billing placeholder pattern and any trailing billing note."""
    match = MONTHS_ON_INVOICE_LABEL_RE.match((label or "").strip())
    if not match:
        return False, None
    extra = (match.group("extra") or "").strip()
    return True, extra or None


def billing_comments_for_months_on_invoice(
    existing: str | None,
    extra_from_label: str | None,
) -> str:
    base = MONTHS_ON_INVOICE_PHRASE
    existing_clean = (existing or "").strip()
    if existing_clean:
        if "months on invoice" in existing_clean.casefold():
            if extra_from_label and extra_from_label.casefold() not in existing_clean.casefold():
                return f"{existing_clean}\n{extra_from_label}"
            return existing_clean
        return f"{base}\n{existing_clean}"
    if extra_from_label:
        return f"{base}\n{extra_from_label}"
    return base


def _address_for_label(loc: MonthlyLocation) -> str:
    return (loc.display_address or loc.address or "").strip()


def _unique_conflict(loc: MonthlyLocation, new_label: str) -> MonthlyLocation | None:
    new_norm = normalize_label(new_label)
    if new_norm == normalize_label(loc.label):
        return None
    return (
        MonthlyLocation.query.filter(
            MonthlyLocation.id != int(loc.id),
            MonthlyLocation.address_normalized == loc.address_normalized,
            MonthlyLocation.property_management_company_normalized == loc.property_management_company_normalized,
            MonthlyLocation.label_normalized == new_norm,
        )
        .order_by(MonthlyLocation.id.asc())
        .first()
    )


def plan_location_fix(loc: MonthlyLocation) -> LabelFixPlan:
    matched, extra_from_label = parse_months_on_invoice_label(loc.label)
    if not matched:
        return LabelFixPlan(
            location_id=int(loc.id),
            old_label=loc.label,
            new_label=loc.label,
            old_billing_comments=loc.billing_comments,
            new_billing_comments=(loc.billing_comments or "").strip(),
            address=_address_for_label(loc),
            status="skipped_not_placeholder_label",
        )

    address = _address_for_label(loc)
    if not address:
        return LabelFixPlan(
            location_id=int(loc.id),
            old_label=loc.label,
            new_label=loc.label,
            old_billing_comments=loc.billing_comments,
            new_billing_comments=(loc.billing_comments or "").strip(),
            address=address,
            status="skipped_missing_address",
        )

    new_label = short_street_address(address)
    if not new_label:
        return LabelFixPlan(
            location_id=int(loc.id),
            old_label=loc.label,
            new_label=loc.label,
            old_billing_comments=loc.billing_comments,
            new_billing_comments=(loc.billing_comments or "").strip(),
            address=address,
            status="skipped_empty_short_label",
        )

    new_billing_comments = billing_comments_for_months_on_invoice(loc.billing_comments, extra_from_label)
    if normalize_label(loc.label) == normalize_label(new_label) and (
        (loc.billing_comments or "").strip() == new_billing_comments
    ):
        return LabelFixPlan(
            location_id=int(loc.id),
            old_label=loc.label,
            new_label=new_label,
            old_billing_comments=loc.billing_comments,
            new_billing_comments=new_billing_comments,
            address=address,
            status="skipped_already_correct",
        )

    conflict = _unique_conflict(loc, new_label)
    if conflict is not None:
        return LabelFixPlan(
            location_id=int(loc.id),
            old_label=loc.label,
            new_label=new_label,
            old_billing_comments=loc.billing_comments,
            new_billing_comments=new_billing_comments,
            address=address,
            status="skipped_unique_conflict",
            detail=f"conflicts_with_location_id={int(conflict.id)}",
        )

    return LabelFixPlan(
        location_id=int(loc.id),
        old_label=loc.label,
        new_label=new_label,
        old_billing_comments=loc.billing_comments,
        new_billing_comments=new_billing_comments,
        address=address,
        status="update_candidate",
    )


def _candidate_locations(location_id: int | None = None) -> list[MonthlyLocation]:
    q = MonthlyLocation.query.order_by(MonthlyLocation.id.asc())
    if location_id is not None:
        q = q.filter(MonthlyLocation.id == location_id)
    else:
        q = q.filter(
            db.or_(
                MonthlyLocation.label_normalized.in_(("months on invoice", "months on invoices")),
                MonthlyLocation.label.ilike("months on invoice%"),
                MonthlyLocation.label.ilike("% months on invoice%"),
                MonthlyLocation.label.ilike("months on invoices%"),
                MonthlyLocation.label.ilike("% months on invoices%"),
            )
        )
    return q.all()


def _apply_plan(loc: MonthlyLocation, plan: LabelFixPlan) -> None:
    loc.label = plan.new_label
    loc.label_normalized = normalize_label(plan.new_label)
    loc.billing_comments = plan.new_billing_comments


def _write_reports(report_dir: Path, rows: list[dict[str, object]]) -> tuple[Path, Path]:
    report_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = report_dir / f"months_on_invoice_label_fix_{ts}.csv"
    jsonl_path = report_dir / f"months_on_invoice_label_fix_{ts}.jsonl"
    fieldnames = [
        "location_id",
        "address",
        "old_label",
        "new_label",
        "old_billing_comments",
        "new_billing_comments",
        "status",
        "detail",
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


def run_fix(
    *,
    execute: bool = False,
    report_dir: Path | None = DEFAULT_REPORT_DIR,
    limit: int | None = None,
    location_id: int | None = None,
) -> list[dict[str, object]]:
    locations = _candidate_locations(location_id=location_id)
    if limit is not None:
        locations = locations[: max(limit, 0)]

    rows: list[dict[str, object]] = []
    for loc in locations:
        plan = plan_location_fix(loc)
        row = {
            "location_id": plan.location_id,
            "address": plan.address,
            "old_label": plan.old_label,
            "new_label": plan.new_label,
            "old_billing_comments": plan.old_billing_comments,
            "new_billing_comments": plan.new_billing_comments,
            "status": plan.status,
            "detail": plan.detail,
        }
        if plan.status == "update_candidate" and execute:
            try:
                _apply_plan(loc, plan)
                db.session.commit()
                row["status"] = "updated"
            except Exception as exc:
                db.session.rollback()
                row["status"] = "skipped_unexpected_error"
                row["detail"] = str(exc)
        rows.append(row)

    if report_dir is not None:
        csv_path, jsonl_path = _write_reports(Path(report_dir), rows)
        print(f"[months-on-invoice-label-fix] Wrote CSV report: {csv_path}", flush=True)
        print(f"[months-on-invoice-label-fix] Wrote JSONL report: {jsonl_path}", flush=True)

    counts: dict[str, int] = {}
    for row in rows:
        status = str(row["status"])
        counts[status] = counts.get(status, 0) + 1
    print(f"[months-on-invoice-label-fix] Summary: {counts}", flush=True)
    if not execute:
        db.session.rollback()
        print("[months-on-invoice-label-fix] Dry run complete. No changes committed.", flush=True)
    return rows


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    app = create_app()
    with app.app_context():
        run_fix(
            execute=args.commit,
            report_dir=Path(args.report_dir),
            limit=args.limit,
            location_id=args.location_id,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
