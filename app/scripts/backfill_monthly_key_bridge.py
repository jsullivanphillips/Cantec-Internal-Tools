"""Populate ``monthly_key_bridge`` from flat ``MonthlyLocation`` rows (before a monthly wipe).

    python -m app.scripts.backfill_monthly_key_bridge --dry-run
    python -m app.scripts.backfill_monthly_key_bridge --execute
    python -m app.scripts.backfill_monthly_key_bridge --execute --csv

"""

from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
from pathlib import Path

from flask import has_app_context

from app import create_app, db
from app.db_models import MonthlyKeyBridge, MonthlyLocation


def _run_body(*, execute: bool, write_csv: bool) -> int:
    location_rows = (
        MonthlyLocation.query.filter(MonthlyLocation.key_id.isnot(None))
        .order_by(MonthlyLocation.id.asc())
        .all()
    )

    bridge_objs: list[MonthlyKeyBridge] = []
    now = datetime.now(timezone.utc)

    for loc in location_rows:
        bridge_objs.append(
            MonthlyKeyBridge(
                key_id=int(loc.key_id),
                service_trade_site_location_id=loc.service_trade_site_location_id,
                address_normalized=loc.address_normalized,
                property_management_company_normalized=loc.property_management_company_normalized,
                building_normalized=loc.label_normalized,
                display_address=loc.display_address or loc.address,
                legacy_monthly_route_location_id=loc.legacy_monthly_route_location_id,
                legacy_testing_site_id=loc.legacy_monthly_testing_site_id,
                keys_text=loc.keys,
                barcode_text=loc.barcode,
                source="monthly_location",
                exported_at=now,
            )
        )

    print(f"[monthly_key_bridge] Prepared {len(bridge_objs)} rows from monthly_location.")

    if write_csv:
        logs_dir = Path("logs")
        logs_dir.mkdir(parents=True, exist_ok=True)
        csv_path = logs_dir / f"monthly_key_bridge_export_{now.strftime('%Y%m%d_%H%M%S')}.csv"
        fieldnames = [
            "key_id",
            "service_trade_site_location_id",
            "address_normalized",
            "property_management_company_normalized",
            "building_normalized",
            "display_address",
            "legacy_monthly_route_location_id",
            "legacy_testing_site_id",
            "keys_text",
            "barcode_text",
            "source",
            "exported_at",
        ]
        with csv_path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            for b in bridge_objs:
                w.writerow(
                    {
                        "key_id": b.key_id,
                        "service_trade_site_location_id": b.service_trade_site_location_id,
                        "address_normalized": b.address_normalized,
                        "property_management_company_normalized": b.property_management_company_normalized,
                        "building_normalized": b.building_normalized,
                        "display_address": b.display_address,
                        "legacy_monthly_route_location_id": b.legacy_monthly_route_location_id,
                        "legacy_testing_site_id": b.legacy_testing_site_id,
                        "keys_text": b.keys_text,
                        "barcode_text": b.barcode_text,
                        "source": b.source,
                        "exported_at": b.exported_at.isoformat() if b.exported_at else "",
                    }
                )
        print(f"[monthly_key_bridge] Wrote {csv_path}")

    if not execute:
        print("[monthly_key_bridge] Dry run — pass --execute to insert into monthly_key_bridge.")
        return 0

    for obj in bridge_objs:
        db.session.add(obj)
    db.session.commit()
    print(f"[monthly_key_bridge] Inserted {len(bridge_objs)} rows.")
    return 0


def _run(*, execute: bool, write_csv: bool) -> int:
    """Uses existing Flask app context when present (tests); otherwise creates app."""
    if has_app_context():
        return _run_body(execute=execute, write_csv=write_csv)
    app = create_app()
    with app.app_context():
        return _run_body(execute=execute, write_csv=write_csv)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill monthly_key_bridge from monthly key FKs.")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Insert rows (default is dry-run counts only).",
    )
    parser.add_argument(
        "--csv",
        action="store_true",
        help="Also write logs/monthly_key_bridge_export_<timestamp>.csv",
    )
    args = parser.parse_args(argv)
    return _run(execute=args.execute, write_csv=args.csv)


if __name__ == "__main__":
    raise SystemExit(main())
