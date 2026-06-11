"""
Dry-run for backfilling ``monthly_route`` and ``monthly_location.monthly_route_id``.

Reads the live DB but **does not commit** any changes. Use before running a real backfill.

    python -m app.scripts.dry_run_monthly_route_backfill
    python -m app.scripts.dry_run_monthly_route_backfill --verbose
    python -m app.scripts.dry_run_monthly_route_backfill --sample 40

Exit code ``1`` if there are blocking issues (parse failures, route pattern conflicts,
or FK / existing-row mismatches). ``0`` otherwise (warnings only still exit 0).
"""

from __future__ import annotations

import argparse
import sys

from app import create_app
from app.db_models import MonthlyLocation, MonthlyRoute
from app.monthly.route_backfill import (
    classify_monthly_locations,
    validate_existing_location_fks,
    validate_existing_monthly_route_rows,
)


def run_dry_run(*, verbose: bool, sample: int) -> int:
    locations = MonthlyLocation.query.order_by(MonthlyLocation.id.asc()).all()
    existing_routes = MonthlyRoute.query.order_by(MonthlyRoute.route_number.asc()).all()
    route_by_id = {r.id: r for r in existing_routes}

    classification = classify_monthly_locations(locations)
    buckets = classification.buckets

    would_insert_routes = sorted(rn for rn in buckets if rn not in {r.route_number for r in existing_routes})
    would_touch_locations = sum(len(b.location_ids) for b in buckets.values())

    existing_block, existing_warn = validate_existing_monthly_route_rows(existing_routes, buckets)
    fk_block, fk_warn = validate_existing_location_fks(locations, buckets, route_by_id)

    print("=== Dry run: monthly_route backfill (no DB writes) ===\n")
    print(f"MonthlyLocation rows: {len(locations)}")
    print(f"Existing MonthlyRoute rows: {len(existing_routes)}")
    print()

    print("[CLASSIFICATION]")
    print(f"  Blank TEST DAY: {len(classification.blank_test_day_ids)}")
    print(f"  Cancelled monthly (dash): {len(classification.cancelled_test_day_ids)}")
    print(f"  Parsed into route buckets: {would_touch_locations} locations across {len(buckets)} route numbers")
    print()

    print("[PLANNED monthly_route ROWS]")
    print(f"  Would INSERT (new R#): {len(would_insert_routes)}")
    print(f"  Would reuse existing DB row (same R#): {len(buckets) - len(would_insert_routes)}")
    list_cap = sample if sample > 0 else (999999 if verbose else 30)
    wd_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    shown = 0
    for rn in sorted(buckets.keys()):
        if shown >= list_cap:
            print(f"    ... ({len(buckets) - shown} more routes; use --verbose or --sample N)")
            break
        b = buckets[rn]
        exists = rn in {r.route_number for r in existing_routes}
        status = "reuse DB row" if exists else "INSERT"
        wd_label = wd_names[b.weekday_iso] if 0 <= b.weekday_iso <= 6 else str(b.weekday_iso)
        print(
            f"    R{rn}: {wd_label} #{b.week_occurrence} | "
            f"{len(b.location_ids)} sites | {status} | samples {b.sample_raw}"
        )
        shown += 1
    print()

    print("[PLANNED monthly_location.monthly_route_id]")
    print(f"  Locations to attach to a route entity: {would_touch_locations}")
    print()

    blocking: list[str] = []

    print("[PARSE ERRORS (non-empty TEST DAY that did not parse)]")
    pe = classification.parse_errors
    if pe:
        blocking.append(f"{len(pe)} parse error(s)")
        lim = sample if sample > 0 else 40
        for lid, raw, msg in pe[:lim]:
            print(f"    location_id={lid} test_day={raw!r} -> {msg}")
        if len(pe) > lim:
            print(f"    ... ({len(pe) - lim} more)")
    else:
        print("    (none)")
    print()

    print("[ROUTE PATTERN CONFLICTS (same R#, different weekday/occurrence)]")
    pcm = classification.pattern_conflict_msgs
    if pcm:
        blocking.extend(pcm)
        for msg in pcm[: max(50, sample if sample else 50)]:
            print(f"    {msg}")
    else:
        print("    (none)")
    print()

    print("[VS EXISTING monthly_route ROWS]")
    for msg in existing_block:
        print(f"    BLOCKING: {msg}")
        blocking.append(msg)
    if not existing_block:
        print("    (no weekday/occurrence mismatch for overlapping R#)")
    for msg in existing_warn:
        print(f"    WARNING: {msg}")
    print()

    print("[VS EXISTING monthly_route_id ON LOCATIONS]")
    for msg in fk_block:
        print(f"    BLOCKING: {msg}")
        blocking.append(msg)
    if not fk_block:
        print("    (no FK mismatch vs parsed TEST DAY)")
    for msg in fk_warn[:40]:
        print(f"    WARNING: {msg}")
    if len(fk_warn) > 40:
        print(f"    ... ({len(fk_warn) - 40} more warnings)")
    print()

    print("---")
    if blocking:
        print(f"Dry run FAILED: {len(blocking)} blocking issue(s). Fix before applying backfill.")
        return 1
    print("Dry run OK: no blocking issues for this plan.")
    print("Next: python -m app.scripts.backfill_monthly_route_entities --execute")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Dry-run monthly_route backfill (no writes).")
    parser.add_argument("--verbose", action="store_true", help="List all derived route rows.")
    parser.add_argument(
        "--sample",
        type=int,
        default=0,
        metavar="N",
        help="Max routes to print in the route table preview (default 30 unless --verbose).",
    )
    args = parser.parse_args(argv)

    app = create_app()
    with app.app_context():
        return run_dry_run(verbose=args.verbose, sample=args.sample)


if __name__ == "__main__":
    sys.exit(main())
