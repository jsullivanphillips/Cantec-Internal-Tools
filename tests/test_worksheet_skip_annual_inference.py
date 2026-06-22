"""Explicit user skip reasons must override annual-month inference on paperwork."""

from __future__ import annotations

from datetime import date

from app.monthly.billing_board import _location_month_skip_reason_category_label
from app.monthly.worksheet_locations import _office_stop_status


def test_office_stop_status_uses_annual_month_when_skip_has_no_reason():
    stop = {
        "result_status": "skipped",
        "annual_month": "June",
        "skip_reason": None,
        "skip_category": None,
    }
    assert _office_stop_status(stop, date(2026, 6, 1)) == "annual"


def test_office_stop_status_honors_explicit_non_annual_skip_reason():
    stop = {
        "result_status": "skipped",
        "test_outcome": "skipped",
        "annual_month": "June",
        "skip_reason": "no_access",
        "skip_category": "access_issues",
    }
    assert _office_stop_status(stop, date(2026, 6, 1)) == "skipped"


def test_billing_board_skip_label_honors_explicit_non_annual_skip_reason():
    label = _location_month_skip_reason_category_label(
        test_outcome="skipped",
        result_status="skipped",
        skip_category="access_issues",
        skip_reason="no_access",
        annual_month="June",
        month_first=date(2026, 6, 1),
        loc_annual_month="June",
    )
    assert label == "Access issues"
