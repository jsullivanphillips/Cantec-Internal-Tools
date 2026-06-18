"""
Refresh ``monthly_location_visit_timing_month`` lookup rows from sheet/portal clocks.

Env:
  MONTHLY_LOCATION_VISIT_TIMING_LOOKBACK — Pacific months to refresh (default 12).

CLI:
  python -m app.scripts.refresh_location_visit_timing_lookup
  python -m app.scripts.refresh_location_visit_timing_lookup --force
  python -m app.scripts.refresh_location_visit_timing_lookup --lookback 3
"""
from __future__ import annotations

import argparse
import os
from datetime import datetime
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

from app import create_app, db
from app.monthly.location_visit_timing import refresh_visit_timing_for_month_dates

load_dotenv()

PACIFIC = ZoneInfo("America/Vancouver")


def pacific_month_range(lookback: int) -> list:
    if lookback < 1:
        lookback = 1
    current = datetime.now(PACIFIC).date().replace(day=1)
    months = [current]
    cur = current
    for _ in range(lookback - 1):
        if cur.month == 1:
            cur = cur.replace(year=cur.year - 1, month=12)
        else:
            cur = cur.replace(month=cur.month - 1)
        months.append(cur)
    return list(reversed(months))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Refresh location visit timing lookup rows for dashboard metrics.",
    )
    parser.add_argument(
        "--lookback",
        type=int,
        default=int(os.getenv("MONTHLY_LOCATION_VISIT_TIMING_LOOKBACK", "12")),
        help="Pacific calendar months to refresh (default 12).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Recompute all rows even if refreshed within the last 30 minutes.",
    )
    args = parser.parse_args()

    month_dates = pacific_month_range(args.lookback)
    app = create_app()
    with app.app_context():
        refreshed = refresh_visit_timing_for_month_dates(month_dates, force=args.force)
        db.session.remove()
    print(
        f"Refreshed {refreshed} location-month visit timing row(s) "
        f"across {len(month_dates)} month(s)."
    )


if __name__ == "__main__":
    main()
