"""Migrate legacy monthly billing/testing-site schema to flat ``monthly_location``.

    python -m app.scripts.migrate_monthly_flat_locations --dry-run
    python -m app.scripts.migrate_monthly_flat_locations --execute
    python -m app.scripts.migrate_monthly_flat_locations --execute --allow-conflicts
    python -m app.scripts.migrate_monthly_flat_locations --execute --report-dir logs/migration

"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from app import create_app, db
from app.monthly.migrate_flat_locations import migrate_flat_locations

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Migrate to flat monthly_location schema.")
    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument("--execute", action="store_true", dest="execute", help="Apply changes.")
    mode_group.add_argument("--dry-run", action="store_false", dest="execute", help="Do not apply changes (default).")
    parser.add_argument("--allow-conflicts", action="store_true", help="Exit 0 even if conflicts logged.")
    parser.add_argument(
        "--report-dir",
        type=Path,
        default=Path("logs/monthly_flat_migration"),
        help="Directory for JSONL audit and conflict CSV.",
    )
    args = parser.parse_args(argv)

    app = create_app()
    with app.app_context():
        logger.info(
            "Starting monthly flat-location migration; execute=%s allow_conflicts=%s report_dir=%s",
            args.execute,
            args.allow_conflicts,
            args.report_dir,
        )
        stats = migrate_flat_locations(
            execute=args.execute,
            report_dir=args.report_dir,
            allow_conflicts=args.allow_conflicts,
        )
        logger.info(
            "Completed migration: locations_created=%s months_migrated=%s conflicts=%s warnings=%s",
            stats.locations_created,
            stats.months_migrated,
            stats.conflicts,
            len(stats.warnings),
        )
        print(
            f"locations_created={stats.locations_created} "
            f"months_migrated={stats.months_migrated} "
            f"conflicts={stats.conflicts}"
        )
        if stats.warnings:
            print("warnings:", *stats.warnings[:20], sep="\n  ")
        if args.execute:
            db.session.commit()
        else:
            db.session.rollback()

        if stats.conflicts and not args.allow_conflicts:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
