"""ST-based annual skip inference on paperwork."""

from __future__ import annotations

from datetime import date

from app.monthly.billing_board import _location_month_skip_reason_category_label
from app.monthly.worksheet_locations import _office_stop_status


def test_office_stop_status_uses_scheduled_annual_when_skip_has_no_reason():
    stop = {
        "result_status": "skipped",
        "scheduled_annual_auto_skip": True,
        "skip_reason": None,
        "skip_category": None,
    }
    assert _office_stop_status(stop, date(2026, 6, 1)) == "annual"


def test_office_stop_status_honors_explicit_non_annual_skip_reason():
    stop = {
        "result_status": "skipped",
        "test_outcome": "skipped",
        "scheduled_annual_auto_skip": True,
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
    )
    assert label == "Access issues"
