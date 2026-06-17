"""Pacific month window for run-timing sync."""

from __future__ import annotations

from datetime import date, datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from app.scripts.update_monthly_route_run_timing import pacific_month_range

PACIFIC = ZoneInfo("America/Vancouver")


def test_pacific_month_range_lookback_and_lookahead():
    frozen = datetime(2026, 6, 15, 12, 0, tzinfo=PACIFIC)
    with patch("app.scripts.update_monthly_route_run_timing.datetime") as mock_dt:
        mock_dt.now.return_value = frozen
        months = pacific_month_range(3, 2)

    assert months == [
        date(2026, 4, 1),
        date(2026, 5, 1),
        date(2026, 6, 1),
        date(2026, 7, 1),
        date(2026, 8, 1),
    ]


def test_pacific_month_range_lookahead_zero_matches_lookback_only():
    frozen = datetime(2026, 1, 10, 9, 0, tzinfo=PACIFIC)
    with patch("app.scripts.update_monthly_route_run_timing.datetime") as mock_dt:
        mock_dt.now.return_value = frozen
        months = pacific_month_range(2, 0)

    assert months == [date(2025, 12, 1), date(2026, 1, 1)]
