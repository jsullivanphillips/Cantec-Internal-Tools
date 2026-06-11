"""Unit tests for TEST DAY parsing (no DB)."""

import pytest

from app.monthly.test_day import ParsedTestDay, format_test_day_token, monthly_test_day_is_cancelled, parse_test_day


def test_parse_w1_r7():
    p = parse_test_day("W1-R7")
    assert p == ParsedTestDay(weekday_iso=2, week_occurrence=1, route_number=7, raw="W1-R7")


def test_format_test_day_token_roundtrip():
    token = format_test_day_token(weekday_iso=2, week_occurrence=1, route_number=24)
    assert token == "W1-R24"
    assert parse_test_day(token) == ParsedTestDay(
        weekday_iso=2,
        week_occurrence=1,
        route_number=24,
        raw="W1-R24",
    )


def test_parse_th2_r15_case_insensitive_r():
    p = parse_test_day("TH2-r15")
    assert p.weekday_iso == 3
    assert p.week_occurrence == 2
    assert p.route_number == 15


def test_parse_whitespace():
    p = parse_test_day("  TH2-R15  ")
    assert p.route_number == 15


def test_empty_returns_none():
    assert parse_test_day("") is None
    assert parse_test_day(None) is None
    assert parse_test_day("   ") is None


def test_parse_dash_still_errors_without_cancelled_guard():
    """Callers should use monthly_test_day_is_cancelled before parse_test_day."""
    assert monthly_test_day_is_cancelled("-") is True
    with pytest.raises(ValueError):
        parse_test_day("-")


@pytest.mark.parametrize(
    "bad",
    [
        "X1-R1",
        "W1-R",
        "W-R7",
        "W0-R7",
        "W6-R7",
    ],
)
def test_invalid_raises(bad):
    with pytest.raises(ValueError):
        parse_test_day(bad)
