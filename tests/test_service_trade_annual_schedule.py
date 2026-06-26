"""Tests for ServiceTrade annual schedule checks (run prep)."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app.monthly.route_test_day import effective_route_test_day
from app.monthly.service_trade_annual_schedule import (
    _annual_month_first_from_job_appointments,
    _job_has_unreleased_annual_for_month,
    _pick_saved_annual_month,
    _skip_month_for_spanning_job,
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


def test_appointment_qualifies_released_only_when_required():
    start_ts, end_ts = month_window_pacific(date(2026, 6, 1))
    mid_june = int(datetime(2026, 6, 15, 10, 0, tzinfo=PACIFIC).timestamp())
    unreleased = {"status": "scheduled", "windowStart": mid_june, "released": False}
    released = {"status": "scheduled", "windowStart": mid_june, "released": True}
    assert appointment_qualifies(unreleased, start_ts=start_ts, end_ts=end_ts)
    assert not appointment_qualifies(
        unreleased,
        start_ts=start_ts,
        end_ts=end_ts,
        require_released=True,
    )
    assert appointment_qualifies(
        released,
        start_ts=start_ts,
        end_ts=end_ts,
        require_released=True,
    )


def test_appointment_rejects_missing_released_when_required():
    start_ts, end_ts = month_window_pacific(date(2026, 6, 1))
    mid_june = int(datetime(2026, 6, 15, 10, 0, tzinfo=PACIFIC).timestamp())
    assert not appointment_qualifies(
        {"status": "scheduled", "windowStart": mid_june},
        start_ts=start_ts,
        end_ts=end_ts,
        require_released=True,
    )


def test_job_has_unreleased_annual_for_month_when_only_unreleased_in_month():
    start_ts, end_ts = month_window_pacific(date(2026, 6, 1))
    mid_june = int(datetime(2026, 6, 15, 10, 0, tzinfo=PACIFIC).timestamp())
    appointments = [
        {"status": "scheduled", "windowStart": mid_june, "released": False},
    ]
    assert _job_has_unreleased_annual_for_month(
        appointments,
        start_ts=start_ts,
        end_ts=end_ts,
    )


def test_job_has_unreleased_annual_for_month_false_when_released_exists():
    start_ts, end_ts = month_window_pacific(date(2026, 6, 1))
    mid_june = int(datetime(2026, 6, 15, 10, 0, tzinfo=PACIFIC).timestamp())
    july = int(datetime(2026, 7, 2, 10, 0, tzinfo=PACIFIC).timestamp())
    appointments = [
        {"status": "scheduled", "windowStart": mid_june, "released": False},
        {"status": "scheduled", "windowStart": july, "released": True},
    ]
    assert not _job_has_unreleased_annual_for_month(
        appointments,
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
    ("has_link", "has_scheduled", "spans", "tie", "expected"),
    [
        (False, True, False, False, "no_servicetrade_link"),
        (True, True, True, False, "annual_spans_months"),
        (True, True, False, True, "annual_skip_tie"),
        (True, True, False, False, None),
    ],
)
def test_derive_prep_warning(has_link, has_scheduled, spans, tie, expected):
    assert (
        derive_prep_warning(
            has_service_trade_link=has_link,
            has_scheduled_annual_in_month=has_scheduled,
            annual_spans_months=spans,
            annual_skip_tie=tie,
        )
        == expected
    )


def test_annual_month_first_from_job_appointments_uses_earliest():
    assert _annual_month_first_from_job_appointments(
        [date(2026, 7, 3), date(2026, 6, 28)],
    ) == date(2026, 6, 1)
    assert _annual_month_first_from_job_appointments([]) is None


def test_skip_month_for_spanning_job_closer_to_july():
    june_first = date(2026, 6, 1)
    july_first = date(2026, 7, 1)
    june_test = effective_route_test_day(june_first, weekday_iso=2, week_occurrence=1)
    july_test = effective_route_test_day(july_first, weekday_iso=2, week_occurrence=1)
    assert june_test is not None and july_test is not None
    appt_dates = (
        date(2026, 6, 28),
        date(2026, 7, 3),
    )
    skip_month, is_tie = _skip_month_for_spanning_job(
        [june_first, july_first],
        weekday_iso=2,
        week_occurrence=1,
        appointment_dates=appt_dates,
    )
    assert not is_tie
    assert skip_month == july_first


def test_pick_saved_annual_month_prefers_upcoming():
    current = date(2026, 6, 1)
    assert (
        _pick_saved_annual_month(
            [date(2026, 5, 1), date(2026, 9, 1)],
            current_month=current,
        )
        == "September"
    )


def test_pick_saved_annual_month_falls_back_to_recent_past():
    current = date(2026, 6, 1)
    assert (
        _pick_saved_annual_month(
            [date(2026, 4, 1), date(2026, 5, 1)],
            current_month=current,
        )
        == "May"
    )
