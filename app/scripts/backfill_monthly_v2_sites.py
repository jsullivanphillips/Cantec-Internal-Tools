"""DEPRECATED — pre-flat-model script. Legacy tables removed after Alembic z11 cutover.

Create ``MonthlySite`` + primary ``MonthlyTestingSite`` for every legacy ``MonthlyRouteLocation``.

    python -m app.scripts.backfill_monthly_v2_sites
    python -m app.scripts.backfill_monthly_v2_sites --execute
"""

from __future__ import annotations

import argparse

from app import create_app, db
from app.db_models import MonthlyRouteLocation
from app.monthly.monthly_sites_sync import sync_testing_sites_from_legacy


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill v2 monthly_site rows from legacy locations.")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Apply changes (default is dry-run count only).",
    )
    args = parser.parse_args(argv)

    app = create_app()
    with app.app_context():
        locs = MonthlyRouteLocation.query.order_by(MonthlyRouteLocation.id.asc()).all()
        need = [loc for loc in locs if loc.monthly_site is None or not loc.monthly_site.testing_sites]
        print(f"Legacy locations: {len(locs)}; need v2 scaffold: {len(need)}")
        if not args.execute:
            print("Dry run — pass --execute to write.")
            return 0
        for loc in need:
            sync_testing_sites_from_legacy(loc)
        db.session.commit()
        print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
