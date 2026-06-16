"""
Delete rows from ``monthly_key_bridge`` (e.g. before deleting a bogus ``keys`` row).

Dry-run (default):

    python -m app.scripts.delete_monthly_key_bridge_rows --key-id 10

Apply:

    python -m app.scripts.delete_monthly_key_bridge_rows --key-id 10 --execute
"""

from __future__ import annotations

import argparse
import sys

from app import create_app, db
from app.db_models import MonthlyKeyBridge


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Delete monthly_key_bridge rows for a key.")
    parser.add_argument("--key-id", type=int, required=True, help="keys.id to clear from bridge archive")
    parser.add_argument("--execute", action="store_true", help="Persist deletes (default is dry-run).")
    args = parser.parse_args(argv)

    app = create_app()
    with app.app_context():
        rows = (
            MonthlyKeyBridge.query.filter(MonthlyKeyBridge.key_id == args.key_id)
            .order_by(MonthlyKeyBridge.id.asc())
            .all()
        )
        print(f"Bridge rows for key_id={args.key_id}: {len(rows)}\n")
        for row in rows:
            print(
                f"  id={row.id} source={row.source!r} "
                f"legacy_loc={row.legacy_monthly_route_location_id} "
                f"keys_text={row.keys_text!r} display={row.display_address!r}"
            )

        if not rows:
            print("\nNothing to delete.")
            return 0

        if not args.execute:
            print("\nDry run — re-run with --execute to delete.")
            return 0

        for row in rows:
            db.session.delete(row)
        db.session.commit()
        print(f"\nDeleted {len(rows)} bridge row(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
