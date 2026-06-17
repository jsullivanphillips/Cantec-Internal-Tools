"""Effective monthly route test day (nth weekday, skipping BC stat holidays)."""

from __future__ import annotations

from datetime import date

from app.monthly.bc_stat_holidays import bc_richer_holidays, nth_weekday_of_month


def _bc_stat_holiday_dates_for_year(year: int) -> set[date]:
    return set(bc_richer_holidays(year).values())


def is_bc_stat_holiday(day: date) -> bool:
    return day in _bc_stat_holiday_dates_for_year(day.year)


def effective_route_test_day(
    month_first: date,
    *,
    weekday_iso: int,
    week_occurrence: int,
) -> date | None:
    """Same rules as ``effectiveRouteTestDayIso`` on the frontend."""
    occurrence = int(week_occurrence)
    while occurrence >= 1 and occurrence <= 5:
        day = nth_weekday_of_month(month_first.year, month_first.month, int(weekday_iso), occurrence)
        if day is None:
            return None
        if not is_bc_stat_holiday(day):
            return day
        occurrence += 1
    return None
