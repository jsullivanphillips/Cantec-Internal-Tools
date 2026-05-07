"""Tests for sheet Time In / Time Out classification on CSV import."""

from app.monthly.sheet_visit_times import analyze_sheet_time_cells, truncate_sheet_time_raw


def test_analyze_empty_cells_no_history_signal():
    r = analyze_sheet_time_cells(None, None)
    assert r.result_status is None
    assert r.skip_reason is None
    assert r.source_value_raw is None


def test_analyze_tested_when_clock_like():
    r = analyze_sheet_time_cells("8:48am", "8:58am")
    assert r.result_status == "tested"
    assert r.skip_reason is None
    assert r.source_value_raw == "8:48am | 8:58am"


def test_analyze_skipped_annual_when_booked_text():
    r = analyze_sheet_time_cells("annual", "")
    assert r.result_status == "skipped"
    assert r.skip_reason == "annual_booked"


def test_analyze_skipped_sheet_value_when_not_clock():
    r = analyze_sheet_time_cells("see notes", "n/a")
    assert r.result_status == "skipped"
    assert r.skip_reason == "sheet_value"


def test_truncate_sheet_time_raw():
    long_cell = "x" * 200
    t = truncate_sheet_time_raw(long_cell)
    assert t is not None and len(t) == 64
