"""Tests for ServiceTrade annual schedule checks (run prep)."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app.monthly.service_trade_annual_schedule import (
    appointment_qualifies,
    derive_prep_warning,
    job_qualifies,
    month_window_pacific,
)

PACIFIC = ZoneInfo("America/Vancouver")


def test_month_window_pacific_june_2026():
    start_ts, end_ts = month_window_pacific(date(2026, 6, 1))
    start = datetime.fromtimestamp(start_ts, tz=PACIFIC)
    end = datetime.fromtimestamp(end_ts, tz=PACIFIC)
    assert start == datetime(2026, 6, 1, 0, 0, 0, tzinfo=PACIFIC)
    assert end == datetime(2026, 7, 1, 0, 0, 0, tzinfo=PACIFIC)


def test_appointment_qualifies_scheduled_in_month():
    start_ts, end_ts = month_window_pacific(date(2026, 6, 1))
    mid_june = int(datetime(2026, 6, 15, 10, 0, tzinfo=PACIFIC).timestamp())
    assert appointment_qualifies(
        {"status": "scheduled", "windowStart": mid_june},
        start_ts=start_ts,
        end_ts=end_ts,
    )


def test_appointment_qualifies_completed_in_month():
    start_ts, end_ts = month_window_pacific(date(2026, 6, 1))
    mid_june = int(datetime(2026, 6, 2, 10, 0, tzinfo=PACIFIC).timestamp())
    assert appointment_qualifies(
        {"status": "completed", "windowStart": mid_june},
        start_ts=start_ts,
        end_ts=end_ts,
    )


def test_appointment_rejects_outside_month():
    start_ts, end_ts = month_window_pacific(date(2026, 6, 1))
    july = int(datetime(2026, 7, 2, 10, 0, tzinfo=PACIFIC).timestamp())
    assert not appointment_qualifies(
        {"status": "scheduled", "windowStart": july},
        start_ts=start_ts,
        end_ts=end_ts,
    )


def test_appointment_rejects_cancelled():
    start_ts, end_ts = month_window_pacific(date(2026, 6, 1))
    mid_june = int(datetime(2026, 6, 15, 10, 0, tzinfo=PACIFIC).timestamp())
    assert not appointment_qualifies(
        {"status": "cancelled", "windowStart": mid_june},
        start_ts=start_ts,
        end_ts=end_ts,
    )


def test_job_qualifies_allowed_types():
    assert job_qualifies({"type": "inspection", "status": "scheduled"})
    assert job_qualifies({"type": "replacement", "status": "new"})
    assert job_qualifies({"type": "upgrade", "status": "scheduled"})
    assert job_qualifies({"type": "installation", "status": "completed"})


def test_job_rejects_cancelled_and_other_types():
    assert not job_qualifies({"type": "inspection", "status": "cancelled"})
    assert not job_qualifies({"type": "service", "status": "scheduled"})


@pytest.mark.parametrize(
    ("annual_matches", "has_link", "has_scheduled", "expected"),
    [
        (True, False, False, "no_servicetrade_link"),
        (True, True, False, "no_annual_scheduled"),
        (True, True, True, None),
        (False, True, True, "annual_scheduled_wrong_month"),
        (False, False, False, None),
    ],
)
def test_derive_prep_warning(annual_matches, has_link, has_scheduled, expected):
    assert (
        derive_prep_warning(
            annual_month_matches_run=annual_matches,
            has_service_trade_link=has_link,
            has_scheduled_annual_in_month=has_scheduled,
        )
        == expected
    )
