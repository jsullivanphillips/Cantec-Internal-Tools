"""
Copy ServiceTrade route pseudo-location ids from ``MonthlyRouteSnapshot`` onto ``MonthlyRoute``.

``MonthlyRouteSnapshot.location_id`` is documented as the same notion as
``MonthlyRoute.service_trade_route_location_id`` (specialists / clock-in route workspace).
The specialists sync script fills snapshots only; this script links entities.

Matching heuristic: parse ``R<number>`` from ``MonthlyRouteSnapshot.location_name`` (case
insensitive). Each Excel route number should appear in **exactly one** snapshot name for a
safe automatic match. If multiple snapshots claim the same R#, or a snapshot name has no
``R`` token, rows are reported for manual fix.

Does **not** call ServiceTrade. Read-only by default.

Usage (``DATABASE_URL`` set):

    python -m app.scripts.backfill_monthly_route_service_trade_from_snapshots
    python -m app.scripts.backfill_monthly_route_service_trade_from_snapshots --execute

"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict

from app import create_app
from app.db_models import MonthlyRoute, MonthlyRouteSnapshot, db

_R_IN_NAME = re.compile(r"\bR\s*(\d+)\b", re.IGNORECASE)


def _route_numbers_from_snapshots() -> dict[int, list[tuple[int, str]]]:
    """route_number -> [(service_trade_location_id, location_name), ...]"""
    by_rn: dict[int, list[tuple[int, str]]] = defaultdict(list)
    for snap in MonthlyRouteSnapshot.query.order_by(MonthlyRouteSnapshot.location_id.asc()).all():
        name = snap.location_name or ""
        m = _R_IN_NAME.search(name)
        if not m:
            continue
        rn = int(m.group(1))
        by_rn[rn].append((int(snap.location_id), name))
    return by_rn


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Set MonthlyRoute.service_trade_route_location_id from snapshot names (R# heuristic).",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Persist updates (default is dry-run).",
    )
    args = parser.parse_args(argv)

    app = create_app()
    with app.app_context():
        by_rn = _route_numbers_from_snapshots()
        routes = MonthlyRoute.query.order_by(MonthlyRoute.route_number.asc()).all()

        unmatched_snapshots: list[tuple[int, str]] = []
        for snap in MonthlyRouteSnapshot.query.all():
            if not _R_IN_NAME.search(snap.location_name or ""):
                unmatched_snapshots.append((int(snap.location_id), snap.location_name or ""))

        ambiguous_rn: dict[int, list[tuple[int, str]]] = {
            rn: pairs for rn, pairs in by_rn.items() if len(pairs) > 1
        }

        print("=== Backfill MonthlyRoute.service_trade_route_location_id from snapshots ===\n")
        print(f"MonthlyRoute rows: {len(routes)}")
        print(f"MonthlyRouteSnapshot rows: {MonthlyRouteSnapshot.query.count()}")
        print(f"Snapshots with parsable R# in name: {sum(len(v) for v in by_rn.values())}")
        print(f"Snapshots with NO R# in location_name: {len(unmatched_snapshots)}\n")

        if unmatched_snapshots:
            print("--- Snapshots whose names lack R<number> (manual mapping needed) ---")
            for lid, nm in unmatched_snapshots[:40]:
                print(f"  location_id={lid} name={nm!r}")
            if len(unmatched_snapshots) > 40:
                print(f"  ... ({len(unmatched_snapshots) - 40} more)")
            print()

        if ambiguous_rn:
            print("--- Ambiguous R# (multiple snapshots share same route number token) ---")
            for rn in sorted(ambiguous_rn.keys()):
                print(f"  R{rn}:")
                for lid, nm in ambiguous_rn[rn]:
                    print(f"    location_id={lid} name={nm!r}")
            print()

        would_set: list[tuple[int, int, int]] = []  # mr.id, rn, st_loc_id
        skip_already: list[tuple[int, int, int | None]] = []
        no_snapshot: list[MonthlyRoute] = []

        for mr in routes:
            rn = int(mr.route_number)
            pairs = by_rn.get(rn)
            if not pairs or len(pairs) != 1:
                if not pairs:
                    no_snapshot.append(mr)
                continue
            st_loc_id = pairs[0][0]
            cur = mr.service_trade_route_location_id
            if cur is not None and int(cur) == st_loc_id:
                skip_already.append((int(mr.id), rn, int(cur)))
                continue
            if cur is not None and int(cur) != st_loc_id:
                print(
                    f"[WARN] monthly_route id={mr.id} R{rn} already has ST id={cur}; "
                    f"snapshot heuristic suggests {st_loc_id}. Skipping (manual review)."
                )
                continue
            would_set.append((int(mr.id), rn, st_loc_id))

        print(f"Routes with no unique R# snapshot match: {len(no_snapshot)}")
        if no_snapshot:
            for mr in no_snapshot[:30]:
                print(f"  monthly_route id={mr.id} R{mr.route_number}")
            if len(no_snapshot) > 30:
                print(f"  ... ({len(no_snapshot) - 30} more)")
            print()

        print(f"Already correct FK: {len(skip_already)}")
        print(f"Would set FK: {len(would_set)}")
        for mr_id, rn, st_id in would_set[:50]:
            print(f"  monthly_route id={mr_id} R{rn} -> service_trade_route_location_id={st_id}")
        if len(would_set) > 50:
            print(f"  ... ({len(would_set) - 50} more)")

        if not args.execute:
            print("\nDry-run only. Re-run with --execute to apply.")
            return 0

        updated = 0
        for mr_id, _rn, st_id in would_set:
            row = db.session.get(MonthlyRoute, mr_id)
            if row is None:
                continue
            row.service_trade_route_location_id = st_id
            updated += 1
        db.session.commit()
        print(f"\nDone. Updated MonthlyRoute rows: {updated}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
