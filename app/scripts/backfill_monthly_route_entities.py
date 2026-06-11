"""
Backfill ``monthly_route`` and ``monthly_location.monthly_route_id`` from ``TEST DAY``.

Does **not** modify ``keys``, ``key_addresses``, or ``key_status``.

Preview only (default):

    python -m app.scripts.backfill_monthly_route_entities

Apply (transaction commit):

    python -m app.scripts.backfill_monthly_route_entities --execute

Clear ``monthly_route_id`` on rows not in any parsed route bucket (e.g. cancelled / bad TEST DAY
that previously had a stale FK):

    python -m app.scripts.backfill_monthly_route_entities --execute --clear-unassigned

Run ``python -m app.scripts.dry_run_monthly_route_backfill`` first until it passes.
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import update

from app import create_app
from app.db_models import MonthlyLocation, MonthlyRoute, db
from app.monthly.route_backfill import (
    assigned_location_ids,
    classify_monthly_locations,
    validate_existing_location_fks,
    validate_existing_monthly_route_rows,
)


def _gather_blocking(classification, existing_block: list[str], fk_block: list[str]) -> list[str]:
    blocking: list[str] = []
    if classification.parse_errors:
        blocking.append(f"{len(classification.parse_errors)} TEST DAY parse error(s)")
    blocking.extend(classification.pattern_conflict_msgs)
    blocking.extend(existing_block)
    blocking.extend(fk_block)
    return blocking


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill MonthlyRoute from TEST DAY.")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually INSERT/UPDATE rows and COMMIT. Without this, only validates and prints summary.",
    )
    parser.add_argument(
        "--clear-unassigned",
        action="store_true",
        help="Set monthly_route_id NULL on locations not in any route bucket (after assignment).",
    )
    args = parser.parse_args(argv)

    app = create_app()
    with app.app_context():
        locations = MonthlyLocation.query.order_by(MonthlyLocation.id.asc()).all()
        existing_routes = MonthlyRoute.query.order_by(MonthlyRoute.route_number.asc()).all()
        route_by_id = {r.id: r for r in existing_routes}
        existing_by_rn = {r.route_number: r for r in existing_routes}

        classification = classify_monthly_locations(locations)
        existing_block, existing_warn = validate_existing_monthly_route_rows(
            existing_routes, classification.buckets
        )
        fk_block, fk_warn = validate_existing_location_fks(
            locations, classification.buckets, route_by_id
        )

        blocking = _gather_blocking(classification, existing_block, fk_block)

        print("=== Backfill monthly_route (keys tables untouched) ===\n")
        print(f"Locations: {len(locations)} | Existing MonthlyRoute rows: {len(existing_routes)}")
        print(f"Route buckets: {len(classification.buckets)}")
        print(
            f"Locations to attach: {sum(len(b.location_ids) for b in classification.buckets.values())}"
        )
        print(f"New MonthlyRoute rows needed: {sum(1 for rn in classification.buckets if rn not in existing_by_rn)}")
        print()

        if existing_warn:
            print("[warnings — existing monthly_route rows]")
            for w in existing_warn[:20]:
                print(f"  {w}")
            if len(existing_warn) > 20:
                print(f"  ... ({len(existing_warn) - 20} more)")
            print()

        if fk_warn:
            print("[warnings — monthly_route_id vs TEST DAY]")
            for w in fk_warn[:15]:
                print(f"  {w}")
            if len(fk_warn) > 15:
                print(f"  ... ({len(fk_warn) - 15} more)")
            print()

        if blocking:
            print("[BLOCKING — fix before --execute]")
            for msg in blocking:
                print(f"  {msg}")
            if classification.parse_errors:
                for lid, raw, err in classification.parse_errors[:15]:
                    print(f"    location_id={lid} test_day={raw!r} -> {err}")
                if len(classification.parse_errors) > 15:
                    print(f"    ... ({len(classification.parse_errors) - 15} more parse errors)")
            return 1

        if not args.execute:
            print("Validation OK. Re-run with --execute to INSERT monthly_route rows and SET monthly_route_id.")
            if args.clear_unassigned:
                print("(Ignored without --execute.)")
            return 0

        inserted = 0
        try:
            print("Inserting new MonthlyRoute rows...", flush=True)
            for rn in sorted(classification.buckets.keys()):
                if rn in existing_by_rn:
                    continue
                b = classification.buckets[rn]
                row = MonthlyRoute(
                    route_number=rn,
                    weekday_iso=b.weekday_iso,
                    week_occurrence=b.week_occurrence,
                )
                db.session.add(row)
                inserted += 1

            db.session.flush()
            print(f"Flush OK ({inserted} new routes). Bulk-updating locations...", flush=True)

            route_by_rn = {r.route_number: r for r in MonthlyRoute.query.all()}
            updated = 0
            n_buckets = len(classification.buckets)
            for idx, rn in enumerate(sorted(classification.buckets.keys()), start=1):
                b = classification.buckets[rn]
                mr = route_by_rn[rn]
                ids = b.location_ids
                if not ids:
                    continue
                result = db.session.execute(
                    update(MonthlyLocation)
                    .where(MonthlyLocation.id.in_(ids))
                    .values(monthly_route_id=mr.id)
                )
                rc = result.rowcount or 0
                updated += rc
                print(
                    f"  R{rn}: set monthly_route_id on {rc} row(s) [{idx}/{n_buckets}]",
                    flush=True,
                )

            cleared = 0
            if args.clear_unassigned:
                assigned = assigned_location_ids(classification.buckets)
                if assigned:
                    print("Clearing monthly_route_id on unassigned locations...", flush=True)
                    res = db.session.execute(
                        update(MonthlyLocation)
                        .where(
                            MonthlyLocation.id.not_in(assigned),
                            MonthlyLocation.monthly_route_id.isnot(None),
                        )
                        .values(monthly_route_id=None)
                    )
                    cleared = res.rowcount or 0

            print("Committing transaction...", flush=True)
            db.session.commit()
            print(
                f"Done. inserted MonthlyRoute={inserted}, location rows touched={updated}, cleared FK={cleared}",
                flush=True,
            )
        except Exception:
            db.session.rollback()
            raise

    return 0


if __name__ == "__main__":
    sys.exit(main())
