"""List monthly locations whose KEYS text should move to access_instructions.

    python -m app.scripts.list_access_instruction_key_migrations
    python -m app.scripts.list_access_instruction_key_migrations --csv logs/access_instruction_moves.csv
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from sqlalchemy.orm import joinedload

from app import create_app
from app.db_models import MonthlyLocation
from app.monthly.monthly_keys_keycode import monthly_keys_field_indicates_no_key


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Sites with access-style text still in KEYS (not yet in access_instructions).",
    )
    parser.add_argument("--csv", type=str, default="", help="Optional CSV output path")
    args = parser.parse_args(argv)

    app = create_app()
    with app.app_context():
        locs = (
            MonthlyLocation.query.options(joinedload(MonthlyLocation.monthly_route))
            .order_by(MonthlyLocation.id.asc())
            .all()
        )
        needs_move: list[MonthlyLocation] = []
        for loc in locs:
            keys_raw = (loc.keys or "").strip()
            if not keys_raw:
                continue
            if not monthly_keys_field_indicates_no_key(loc.keys):
                continue
            if (loc.access_instructions or "").strip():
                continue
            needs_move.append(loc)

        print(f"Sites to move KEYS -> access_instructions: {len(needs_move)}\n")
        header = f"{'ID':>6}  {'Route':>6}  {'Status':<12}  KEYS text"
        print(header)
        print("-" * 100)
        rows: list[dict[str, str]] = []
        for loc in needs_move:
            route = (
                f"R{loc.monthly_route.route_number}"
                if loc.monthly_route is not None
                else "-"
            )
            keys_one_line = " ".join((loc.keys or "").split())
            status = loc.status_normalized or ""
            print(f"{loc.id:>6}  {route:>6}  {status:<12}  {keys_one_line}")
            rows.append(
                {
                    "location_id": str(loc.id),
                    "route": route,
                    "status_normalized": status,
                    "label": (loc.label or "").strip(),
                    "address": (loc.display_address or loc.address or "").strip(),
                    "property_management_company": (loc.property_management_company or "").strip(),
                    "keys_text": keys_one_line,
                    "key_id": str(loc.key_id) if loc.key_id is not None else "",
                }
            )

        if args.csv:
            out = Path(args.csv)
            out.parent.mkdir(parents=True, exist_ok=True)
            fieldnames = list(rows[0].keys()) if rows else [
                "location_id",
                "route",
                "status_normalized",
                "label",
                "address",
                "property_management_company",
                "keys_text",
                "key_id",
            ]
            with out.open("w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=fieldnames)
                w.writeheader()
                w.writerows(rows)
            print(f"\nWrote {out}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
