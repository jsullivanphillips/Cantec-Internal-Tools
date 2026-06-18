"""Unit tests for visit clock parsing helpers."""

from __future__ import annotations

from app.monthly.visit_clock_times import (
    duration_minutes_from_start_end,
    format_visit_clock_minutes,
    is_plausible_field_visit_clock,
    median_minutes,
    parse_visit_clock_minutes,
    visit_duration_minutes_from_clocks,
)


def test_parse_visit_clock_minutes_ampm():
    assert parse_visit_clock_minutes("3:05 PM") == 15 * 60 + 5
    assert parse_visit_clock_minutes("12:30 AM") == 30
    assert parse_visit_clock_minutes("12:00 PM") == 12 * 60
    assert parse_visit_clock_minutes("11:59 PM") == 23 * 60 + 59


def test_parse_visit_clock_minutes_24h():
    assert parse_visit_clock_minutes("15:45") == 15 * 60 + 45
    assert parse_visit_clock_minutes("09:00") == 9 * 60


def test_parse_visit_clock_minutes_infers_meridiem_for_ambiguous_times():
    assert parse_visit_clock_minutes("8:30") == 8 * 60 + 30
    assert parse_visit_clock_minutes("7:08") == 7 * 60 + 8
    assert parse_visit_clock_minutes("12:41") == 12 * 60 + 41
    assert parse_visit_clock_minutes("1:04") == 13 * 60 + 4
    assert parse_visit_clock_minutes("3:15") == 15 * 60 + 15


def test_duration_for_ambiguous_lunchtime_clocks():
    start = parse_visit_clock_minutes("12:41")
    end = parse_visit_clock_minutes("1:04")
    assert start is not None and end is not None
    assert duration_minutes_from_start_end(start, end) == 23


def test_parse_visit_clock_minutes_rejects_non_clock():
    assert parse_visit_clock_minutes(None) is None
    assert parse_visit_clock_minutes("") is None
    assert parse_visit_clock_minutes("annual booked") is None


def test_format_visit_clock_minutes():
    assert format_visit_clock_minutes(15 * 60 + 5) == "3:05 PM"
    assert format_visit_clock_minutes(0) == "12:00 AM"


def test_median_minutes():
    assert median_minutes([600, 720, 900]) == 720
    assert median_minutes([600, 660, 720, 900]) == 690
    assert median_minutes([]) is None


def test_duration_minutes_overnight_wrap():
    assert duration_minutes_from_start_end(22 * 60, 2 * 60) == 4 * 60


def test_visit_duration_rejects_midnight_time_out():
    assert visit_duration_minutes_from_clocks("11:11", "0:00") is None


def test_visit_duration_rejects_overnight_wrap():
    start = parse_visit_clock_minutes("11:11")
    end = parse_visit_clock_minutes("0:00")
    assert start is not None and end == 0
    assert visit_duration_minutes_from_clocks("11:11 AM", "12:00 AM") is None


def test_visit_duration_accepts_normal_morning_visit():
    assert visit_duration_minutes_from_clocks("8:00 AM", "9:00 AM") == 60
    assert visit_duration_minutes_from_clocks("11:11", "12:30 PM") == 79


def test_visit_duration_rejects_clocks_outside_field_hours():
    assert visit_duration_minutes_from_clocks("6:30 AM", "7:00 AM") is None
    assert visit_duration_minutes_from_clocks("8:00 AM", "5:30 PM") is None


def test_visit_duration_rejects_implausibly_long_visit():
    assert visit_duration_minutes_from_clocks("6:45 AM", "5:00 PM") is None


def test_is_plausible_field_visit_clock():
    assert is_plausible_field_visit_clock(0) is False
    assert is_plausible_field_visit_clock(6 * 60 + 45) is True
    assert is_plausible_field_visit_clock(17 * 60) is True
    assert is_plausible_field_visit_clock(17 * 60 + 1) is False
