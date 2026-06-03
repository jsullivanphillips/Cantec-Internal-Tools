"""BC stat holiday golden dates (shared with frontend bcStatHolidays.ts)."""

from __future__ import annotations

from datetime import date

from app.monthly.bc_stat_holidays import bc_richer_holidays, company_9_holidays


def test_bc_richer_holidays_2026():
    hol = bc_richer_holidays(2026)
    assert hol["Family Day (BC)"] == date(2026, 2, 16)
    assert hol["Good Friday"] == date(2026, 4, 3)
    assert hol["Victoria Day"] == date(2026, 5, 18)
    assert hol["Canada Day"] == date(2026, 7, 1)
    assert hol["BC Day"] == date(2026, 8, 3)
    assert hol["National Day for Truth and Reconciliation"] == date(2026, 9, 30)
    assert hol["Boxing Day"] == date(2026, 12, 28)


def test_company_9_has_twelve_core_days_without_bc_extras():
    hol = company_9_holidays(2026)
    assert len(hol) == 9
    richer = bc_richer_holidays(2026)
    assert len(richer) == 12
