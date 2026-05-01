"""
Import 2025 monthly testing cells only from the archived master CSV (history upserts).

Dry-run (default):

    python -m app.scripts.import_2025_monthly_testing

Apply:

    python -m app.scripts.import_2025_monthly_testing --commit

Optional skip-reason overrides use the main uploader flags via ``upload_monthly_sheet`` directly.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from app import create_app
from app.scripts.upload_monthly_sheet import _configure_logging, run_upload


def main() -> None:
    _configure_logging()
    parser = argparse.ArgumentParser(
        description=(
            "Upsert MonthlyRouteTestHistory for calendar year 2025 from the 2025 master CSV "
            "(does not upsert locations)."
        ),
    )
    parser.add_argument(
        "--csv-path",
        default="app/2025 MASTER MONTHLY SHEET - Copy.csv",
        help="Path to the 2025 master monthly CSV.",
    )
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Persist changes. Without this, runs dry-run (rollback).",
    )
    args = parser.parse_args()
    csv_path = Path(args.csv_path)
    if not csv_path.exists():
        raise SystemExit(f"CSV file not found: {csv_path}")

    app = create_app()
    with app.app_context():
        run_upload(
            csv_path=csv_path,
            dry_run=not args.commit,
            history_only=True,
            month_years=frozenset({2025}),
        )


if __name__ == "__main__":
    main()
