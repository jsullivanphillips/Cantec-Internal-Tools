"""BC statutory holidays for scheduling and monthly route test-day logic."""

from __future__ import annotations

from datetime import date, timedelta


def _month_range(year: int, month: int) -> tuple[date, date]:
    import calendar

    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


def nth_weekday_of_month(year: int, month: int, weekday: int, n: int) -> date | None:
    """``weekday``: Mon=0..Sun=6; ``n`` is 1-based occurrence within the month."""
    first, last = _month_range(year, month)
    count = 0
    cur = first
    while cur <= last:
        if cur.weekday() == weekday:
            count += 1
            if count == n:
                return cur
        cur += timedelta(days=1)
    return None


def weekday_before(year: int, month: int, day: int, weekday: int) -> date:
    """e.g. Monday before May 25 (Victoria Day): weekday=0 (Mon)."""
    target = date(year, month, day)
    cur = target - timedelta(days=1)
    while cur.weekday() != weekday:
        cur -= timedelta(days=1)
    return cur


def observed(dt: date) -> date:
    if dt.weekday() == 5:
        return dt + timedelta(days=2)
    if dt.weekday() == 6:
        return dt + timedelta(days=1)
    return dt


def _easter_sunday(year: int) -> date:
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    easter_month = (h + l - 7 * m + 114) // 31
    easter_day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, easter_month, easter_day)


def company_9_holidays(year: int) -> dict[str, date]:
    easter = _easter_sunday(year)
    good_friday = easter - timedelta(days=2)
    holidays = {
        "New Year's Day": observed(date(year, 1, 1)),
        "Family Day (BC)": nth_weekday_of_month(year, 2, 0, 3),
        "Good Friday": good_friday,
        "Victoria Day": weekday_before(year, 5, 25, 0),
        "Canada Day": observed(date(year, 7, 1)),
        "Labour Day": nth_weekday_of_month(year, 9, 0, 1),
        "Thanksgiving": nth_weekday_of_month(year, 10, 0, 2),
        "Remembrance Day": observed(date(year, 11, 11)),
        "Christmas Day": observed(date(year, 12, 25)),
    }
    return {name: dt for name, dt in holidays.items() if dt is not None}


def bc_richer_holidays(year: int) -> dict[str, date]:
    h = company_9_holidays(year).copy()
    h.update(
        {
            "BC Day": nth_weekday_of_month(year, 8, 0, 1),
            "National Day for Truth and Reconciliation": observed(date(year, 9, 30)),
            "Boxing Day": observed(date(year, 12, 26)),
        }
    )
    return h
