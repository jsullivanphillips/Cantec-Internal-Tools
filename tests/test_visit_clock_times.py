"""Unit tests for visit clock parsing helpers."""

from __future__ import annotations

from app.monthly.visit_clock_times import (
    duration_minutes_from_start_end,
    format_visit_clock_minutes,
    median_minutes,
    parse_visit_clock_minutes,
)


def test_parse_visit_clock_minutes_ampm():
    assert parse_visit_clock_minutes("3:05 PM") == 15 * 60 + 5
    assert parse_visit_clock_minutes("12:30 AM") == 30
    assert parse_visit_clock_minutes("12:00 PM") == 12 * 60
    assert parse_visit_clock_minutes("11:59 PM") == 23 * 60 + 59


def test_parse_visit_clock_minutes_24h():
    assert parse_visit_clock_minutes("15:45") == 15 * 60 + 45
    assert parse_visit_clock_minutes("09:00") == 9 * 60


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
