"""Backfill per-testing-site display columns from legacy ``MonthlyRouteLocation`` rows.

Run after migration ``z4a5b6c7d8e9``. Safe to re-run (only fills nulls where noted).

Usage:
    python -m app.scripts.backfill_testing_site_display_fields
    python -m app.scripts.backfill_testing_site_display_fields --dry-run
"""

from __future__ import annotations

import argparse

from app import create_app
from app.db_models import MonthlyRouteLocation, MonthlySite, MonthlyTestingSite, db
from app.monthly.monthly_sites_sync import apply_testing_site_master_fields_from_legacy


def backfill(*, dry_run: bool) -> int:
    updated = 0
    sites = (
        MonthlyTestingSite.query.join(MonthlySite, MonthlyTestingSite.monthly_site_id == MonthlySite.id)
        .join(
            MonthlyRouteLocation,
            MonthlySite.legacy_monthly_route_location_id == MonthlyRouteLocation.id,
        )
        .all()
    )
    for ts in sites:
        loc = ts.monthly_site.legacy_location if ts.monthly_site else None
        if loc is None:
            loc = db.session.get(MonthlyRouteLocation, int(ts.monthly_site.legacy_monthly_route_location_id))
        if loc is None:
            continue
        before_panel = ts.panel
        apply_testing_site_master_fields_from_legacy(ts, loc)
        if (
            before_panel != ts.panel
            or ts.annual_month
            or ts.property_management_company
            or ts.building_name
        ):
            updated += 1
    if dry_run:
        db.session.rollback()
    else:
        db.session.commit()
    return updated


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Roll back after counting updates")
    args = parser.parse_args()
    app = create_app()
    with app.app_context():
        n = backfill(dry_run=args.dry_run)
        print(f"{'Would update' if args.dry_run else 'Updated'} {n} testing site row(s).")


if __name__ == "__main__":
    main()
