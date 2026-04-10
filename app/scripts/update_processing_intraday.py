"""
Hourly intraday refresh for Jobs To Be Marked Complete.

- Prunes intraday rows older than 7 Vancouver days.
- Captures a new intraday point only during the 8:30 AM to 4:30 PM Vancouver window.
- Uses the same 15-minute + value-changed throttle as the Processing Attack page.
"""

import os

from dotenv import load_dotenv

from app import create_app
from app.routes.processing_attack import (
    capture_processing_status_intraday_if_due,
    cleanup_stale_processing_status_intraday_rows,
)

load_dotenv()
app = create_app()


def run() -> None:
    with app.app_context():
        with app.test_request_context():
            from flask import session

            session["username"] = os.environ.get("PROCESSING_USERNAME")
            session["password"] = os.environ.get("PROCESSING_PASSWORD")

            deleted = cleanup_stale_processing_status_intraday_rows()
            print(f"ProcessingStatusIntraday cleanup removed {deleted} stale row(s).")

            result = capture_processing_status_intraday_if_due()
            print(f"ProcessingStatusIntraday capture result: {result}")


if __name__ == "__main__":
    run()
