"""Backfill quote_deficiency_link rows using quote-first and deficiency-first strategies.

Uses sync_quote_deficiency_links, which:
1. Scans locally synced deficiencies (legacy deficiency-first path)
2. Scans accepted quotes in the quarter missing links (quote-first path):
   quote payload → quote detail → location deficiencies
"""
from datetime import datetime

from dotenv import load_dotenv
from zoneinfo import ZoneInfo

from app import create_app
from app.routes.performance_summary import sync_quote_deficiency_links

load_dotenv("app/.env")
PACIFIC = ZoneInfo("America/Vancouver")


def main() -> None:
    app = create_app()
    with app.app_context():
        # Q2 2026 default; pass YYYY-MM-DD args later if needed
        start = datetime(2026, 4, 1, tzinfo=PACIFIC)
        end = datetime(2026, 6, 30, 23, 59, 59, tzinfo=PACIFIC)
        result = sync_quote_deficiency_links(start, end)
        print(result)


if __name__ == "__main__":
    main()
