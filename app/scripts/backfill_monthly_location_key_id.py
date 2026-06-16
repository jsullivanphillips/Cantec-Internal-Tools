"""
Set ``monthly_location.key_id`` from ``barcode`` / ``keys`` using shared resolver.

Does **not** modify ``keys`` or ``key_status``.

Dry-run (default):

    python -m app.scripts.backfill_monthly_location_key_id

Apply:

    python -m app.scripts.backfill_monthly_location_key_id --execute
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import update

from app import create_app
from app.db_models import MonthlyLocation, db
from app.monthly.key_resolve import keycode_cf_to_key_id_map, resolve_key_id_for_monthly_fields


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill MonthlyLocation.key_id from KEYS/barcode.")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Persist updates (default is dry-run summary only).",
    )
    args = parser.parse_args(argv)

    app = create_app()
    with app.app_context():
        locations = MonthlyLocation.query.order_by(MonthlyLocation.id.asc()).all()
        idx = keycode_cf_to_key_id_map()

        would_set = 0
        would_clear = 0
        unchanged = 0
        pending: list[tuple[int, int | None]] = []

        for loc in locations:
            resolved = resolve_key_id_for_monthly_fields(
                loc.barcode,
                loc.keys,
                keycode_cf_index=idx,
            )
            current = loc.key_id
            if resolved == current:
                unchanged += 1
                continue
            pending.append((int(loc.id), resolved))
            if resolved is None:
                would_clear += 1
            else:
                would_set += 1

        print("=== Backfill monthly_location.key_id ===\n")
        print(f"Locations: {len(locations)}")
        print(f"Keycode index entries: {len(idx.exact)} exact, {len(idx.compact)} compact")
        print(f"Unchanged: {unchanged}")
        print(f"Would set / clear FK: {would_set} set, {would_clear} clear")

        if not args.execute:
            if pending and len(pending) <= 25:
                print("\nSample pending updates (location_id -> key_id):")
                for lid, kid in pending[:25]:
                    print(f"  {lid} -> {kid}")
            elif pending:
                print(f"\n({len(pending)} pending updates; omitting sample list)")
            print("\nRe-run with --execute to apply.")
            return 0

        updated = 0
        for lid, kid in pending:
            db.session.execute(
                update(MonthlyLocation)
                .where(MonthlyLocation.id == lid)
                .values(key_id=kid)
            )
            updated += 1
            if updated == 1 or updated == len(pending) or updated % 100 == 0:
                print(f"  Applied {updated}/{len(pending)} …", flush=True)

        db.session.commit()
        print(f"\nDone. Updated rows: {updated}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
