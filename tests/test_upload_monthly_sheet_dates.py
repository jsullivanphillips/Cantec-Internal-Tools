"""Month/year parsing for upload_monthly_sheet (Jan-26 vs 26-Jan)."""

from datetime import date

from app.scripts.upload_monthly_sheet import _parse_month_header, _parse_start_up_date


def test_parse_month_header_jan_26():
    assert _parse_month_header("Jan-26") == date(2026, 1, 1)


def test_parse_month_header_26_jan():
    assert _parse_month_header("26-Jan") == date(2026, 1, 1)


def test_parse_month_header_april_full_name():
    assert _parse_month_header("April-26") == date(2026, 4, 1)


def test_parse_start_up_date_both_orders():
    assert _parse_start_up_date("Aug-23") == date(2023, 8, 1)
    assert _parse_start_up_date("23-Aug") == date(2023, 8, 1)


def test_parse_month_header_invalid():
    assert _parse_month_header("not-a-month") is None
