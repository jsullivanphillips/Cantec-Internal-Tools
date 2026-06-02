"""Backfill monitoring_account_number and monitoring_company_id from legacy monitoring_notes."""

from __future__ import annotations

import argparse

from app import create_app
from app.db_models import MonthlyTestingSite, MonthlyTestingSiteMonth, db
from app.monthly.monitoring_companies import find_active_monitoring_company_by_name
from app.monthly.monitoring_notes_parse import parse_monitoring_notes, rebuild_monitoring_notes


def _backfill_row(notes: str | None, account: str | None, company_id: int | None) -> tuple[str | None, str | None, int | None, bool]:
    parsed = parse_monitoring_notes(notes)
    changed = False
    next_account = account
    next_company_id = company_id
    next_notes = notes

    if not (next_account or "").strip() and parsed.acct:
        next_account = parsed.acct.strip()
        changed = True

    if next_company_id is None and parsed.company:
        match = find_active_monitoring_company_by_name(parsed.company)
        if match is not None:
            next_company_id = int(match.id)
            changed = True

    if notes and (parsed.acct or parsed.company):
        rebuilt = rebuild_monitoring_notes(parsed)
        if rebuilt != (notes or "").strip():
            next_notes = rebuilt
            changed = True

    return next_notes, next_account, next_company_id, changed


def run(*, execute: bool) -> dict[str, int]:
    stats = {
        "testing_sites_scanned": 0,
        "testing_sites_updated": 0,
        "stop_months_scanned": 0,
        "stop_months_updated": 0,
    }
    for ts in MonthlyTestingSite.query.order_by(MonthlyTestingSite.id.asc()).all():
        stats["testing_sites_scanned"] += 1
        notes, account, company_id, changed = _backfill_row(
            ts.monitoring_notes,
            ts.monitoring_account_number,
            ts.monitoring_company_id,
        )
        if not changed:
            continue
        stats["testing_sites_updated"] += 1
        if execute:
            ts.monitoring_notes = notes
            ts.monitoring_account_number = account
            ts.monitoring_company_id = company_id

    for row in MonthlyTestingSiteMonth.query.order_by(MonthlyTestingSiteMonth.id.asc()).all():
        stats["stop_months_scanned"] += 1
        notes, account, company_id, changed = _backfill_row(
            row.monitoring_notes,
            row.monitoring_account_number,
            row.monitoring_company_id,
        )
        if not changed:
            continue
        stats["stop_months_updated"] += 1
        if execute:
            row.monitoring_notes = notes
            row.monitoring_account_number = account
            row.monitoring_company_id = company_id
            if company_id is not None:
                from app.db_models import MonitoringCompany

                mc = db.session.get(MonitoringCompany, company_id)
                row.monitoring_company_name = (mc.name or "").strip() if mc else row.monitoring_company_name

    if execute:
        db.session.commit()
    else:
        db.session.rollback()
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="Persist changes (default is dry run)")
    args = parser.parse_args()
    app = create_app()
    with app.app_context():
        stats = run(execute=args.execute)
        mode = "EXECUTE" if args.execute else "DRY RUN"
        print(f"[{mode}] {stats}")


if __name__ == "__main__":
    main()
