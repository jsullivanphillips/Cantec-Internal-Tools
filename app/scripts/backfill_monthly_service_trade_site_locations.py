"""
Link ``MonthlyLocation.service_trade_site_location_id`` to ServiceTrade building locations.

High-confidence auto-match: normalized street number + first street word, and exactly one
active ServiceTrade location with the same key. Only monthly library rows with
``status_normalized == active`` are considered.

Requires PROCESSING_USERNAME / PROCESSING_PASSWORD for ServiceTrade API access.

Usage (``DATABASE_URL`` set):

    python -m app.scripts.backfill_monthly_service_trade_site_locations
    python -m app.scripts.backfill_monthly_service_trade_site_locations --execute
    python -m app.scripts.backfill_monthly_service_trade_site_locations --execute --csv logs/unmatched.csv
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from app import create_app, db
from app.db_models import MonthlyLocation
from app.monthly.service_trade_site_match import (
    build_street_index,
    fetch_active_service_trade_locations,
    propose_monthly_site_matches,
)


def _print_proposed(proposed) -> None:
    if not proposed:
        print("--- Auto-matched (high confidence) ---")
        print("(none)\n")
        return
    print("--- Auto-matched (high confidence) ---")
    for row in proposed:
        print(
            f"  monthly_id={row.monthly_location_id} "
            f"label={row.monthly_label!r} "
            f"address={row.monthly_address!r} "
            f"-> st_id={row.service_trade_location_id} "
            f"st_name={row.service_trade_name!r} "
            f"st_street={row.service_trade_street!r} "
            f"key={row.street_key!r}"
        )
    print()


def _print_unmatched(unmatched) -> None:
    print("--- Unmatched monthly locations ---")
    if not unmatched:
        print("(none)\n")
        return
    for row in unmatched:
        print(
            f"  monthly_id={row.monthly_location_id} "
            f"label={row.label!r} "
            f"address={row.address!r} "
            f"pmc={row.property_management_company!r} "
            f"route_id={row.monthly_route_id} "
            f"status={row.status_normalized} "
            f"reason={row.reason} "
            f"street_key={row.street_key!r} "
            f"candidates={row.candidate_count}"
        )
    print()


def _print_conflicts(conflicts) -> None:
    print("--- Conflicts ---")
    if not conflicts:
        print("(none)\n")
        return
    for row in conflicts:
        print(
            f"  kind={row.kind} "
            f"monthly_id={row.monthly_location_id} "
            f"st_id={row.service_trade_location_id} "
            f"street_key={row.street_key!r} "
            f"message={row.message}"
        )
    print()


def _write_unmatched_csv(path: Path, unmatched) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "monthly_location_id",
                "label",
                "address",
                "property_management_company",
                "monthly_route_id",
                "status_normalized",
                "reason",
                "street_key",
                "candidate_count",
            ],
        )
        writer.writeheader()
        for row in unmatched:
            writer.writerow(
                {
                    "monthly_location_id": row.monthly_location_id,
                    "label": row.label,
                    "address": row.address,
                    "property_management_company": row.property_management_company or "",
                    "monthly_route_id": row.monthly_route_id or "",
                    "status_normalized": row.status_normalized,
                    "reason": row.reason,
                    "street_key": row.street_key or "",
                    "candidate_count": row.candidate_count,
                }
            )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Backfill MonthlyLocation.service_trade_site_location_id from ServiceTrade.",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Persist updates (default is dry-run).",
    )
    parser.add_argument(
        "--csv",
        metavar="PATH",
        help="Write unmatched rows to CSV (e.g. logs/unmatched.csv).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Apply at most N proposed matches (for staged rollout).",
    )
    args = parser.parse_args(argv)

    app = create_app()
    with app.app_context():
        print("=== Backfill MonthlyLocation.service_trade_site_location_id ===\n")
        print("Fetching active ServiceTrade locations…")
        st_locations = fetch_active_service_trade_locations()
        street_index = build_street_index(st_locations)
        print(f"ServiceTrade active locations fetched: {len(st_locations)}")
        print(f"Indexed street keys: {len(street_index)}\n")

        monthly_rows = MonthlyLocation.query.order_by(MonthlyLocation.id.asc()).all()
        match_result = propose_monthly_site_matches(
            monthly_rows,
            street_index,
        )

        proposed = match_result.proposed
        if args.limit is not None:
            proposed = proposed[: max(0, int(args.limit))]

        print(f"MonthlyLocation rows: {len(monthly_rows)}")
        print(f"Already linked: {match_result.skipped_already_linked}")
        print(f"Skipped inactive (not active): {match_result.skipped_inactive}")
        print(f"Proposed auto-links: {len(proposed)}")
        print(f"Unmatched: {len(match_result.unmatched)}")
        print(f"Conflicts: {len(match_result.conflicts)}\n")

        _print_proposed(proposed)
        _print_unmatched(match_result.unmatched)
        _print_conflicts(match_result.conflicts)

        if args.csv:
            csv_path = Path(args.csv)
            _write_unmatched_csv(csv_path, match_result.unmatched)
            print(f"Wrote unmatched CSV: {csv_path}\n")

        if not proposed:
            print("Nothing to apply.")
            return 0

        loc_by_id = {int(row.id): row for row in monthly_rows}
        for item in proposed:
            loc = loc_by_id.get(item.monthly_location_id)
            if loc is None:
                continue
            loc.service_trade_site_location_id = int(item.service_trade_location_id)

        if args.execute:
            db.session.commit()
            print(f"Committed {len(proposed)} service_trade_site_location_id update(s).")
        else:
            db.session.rollback()
            print(f"Dry run — would update {len(proposed)} row(s). Pass --execute to write.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
