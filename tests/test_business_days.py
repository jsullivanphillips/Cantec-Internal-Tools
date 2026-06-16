from datetime import date

from app.utils.business_days import business_days_between


def test_business_days_same_day():
    assert business_days_between(date(2026, 6, 16), date(2026, 6, 16)) == 0


def test_business_days_next_weekday():
    # Monday to Tuesday
    assert business_days_between(date(2026, 6, 15), date(2026, 6, 16)) == 1


def test_business_days_skips_weekend():
    # Friday to Monday = 1 business day (Saturday/Sunday skipped)
    assert business_days_between(date(2026, 6, 12), date(2026, 6, 15)) == 1


def test_business_days_ten_day_window():
    start = date(2026, 6, 1)
    end = date(2026, 6, 15)
    assert business_days_between(start, end) == 10
