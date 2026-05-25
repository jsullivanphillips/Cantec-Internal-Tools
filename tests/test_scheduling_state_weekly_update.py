"""Regression tests for weekly scheduling snapshot timing."""

from __future__ import annotations

from datetime import datetime, timezone

from app.db_models import WeeklySchedulingStats
from app.services.scheduling_diff import BaselineState
from app.scripts import scheduling_state_weekly_update as weekly_update


def test_weekly_snapshot_is_not_complete_midweek():
    now = datetime(2026, 5, 21, 16, 0, 0, tzinfo=timezone.utc)

    assert weekly_update._weekly_snapshot_period_is_complete(now) is False


def test_weekly_snapshot_is_complete_on_local_period_end_date():
    now = datetime(2026, 5, 25, 18, 52, 0, tzinfo=timezone.utc)

    assert weekly_update._weekly_snapshot_period_is_complete(now) is True

    week_start, week_end = weekly_update._weekly_stats_bucket_for_run(now)
    assert week_start.isoformat() == "2026-05-18T00:00:00-07:00"
    assert week_end.isoformat() == "2026-05-25T00:00:00-07:00"


def test_weekly_snapshot_is_not_complete_after_period_end_date_window():
    now = datetime(2026, 5, 26, 16, 0, 0, tzinfo=timezone.utc)

    assert weekly_update._weekly_snapshot_period_is_complete(now) is False


def test_generated_before_period_end_flags_partial_snapshot_rows():
    row = WeeklySchedulingStats(
        period_start=datetime(2026, 5, 18, 7, 0, 0, tzinfo=timezone.utc),
        period_end=datetime(2026, 5, 25, 7, 0, 0, tzinfo=timezone.utc),
        job_type=weekly_update.DEFAULT_WEEKLY_JOB_TYPE,
        scheduled_count=14,
        rescheduled_count=6,
        generated_at=datetime(2026, 5, 21, 9, 0, 29, tzinfo=timezone.utc),
    )

    assert weekly_update._generated_before_period_end(row) is True


def test_generated_on_or_after_period_end_is_not_partial():
    row = WeeklySchedulingStats(
        period_start=datetime(2026, 5, 18, 7, 0, 0, tzinfo=timezone.utc),
        period_end=datetime(2026, 5, 25, 7, 0, 0, tzinfo=timezone.utc),
        job_type=weekly_update.DEFAULT_WEEKLY_JOB_TYPE,
        scheduled_count=14,
        rescheduled_count=6,
        generated_at=datetime(2026, 5, 25, 9, 0, 29, tzinfo=timezone.utc),
    )

    assert weekly_update._generated_before_period_end(row) is False


def test_print_baseline_to_now_diff_reports_candidate_totals(monkeypatch):
    fixed_now = datetime(2026, 5, 25, 18, 52, 0, tzinfo=timezone.utc)
    existing_row = WeeklySchedulingStats(
        period_start=datetime(2026, 5, 18, 7, 0, 0, tzinfo=timezone.utc),
        period_end=datetime(2026, 5, 25, 7, 0, 0, tzinfo=timezone.utc),
        job_type=weekly_update.DEFAULT_WEEKLY_JOB_TYPE,
        scheduled_count=14,
        rescheduled_count=6,
        generated_at=datetime(2026, 5, 21, 9, 0, 29, tzinfo=timezone.utc),
    )

    class _FixedDatetime:
        @staticmethod
        def now(tz=None):
            return fixed_now

        @staticmethod
        def fromtimestamp(timestamp, tz=None):
            return datetime.fromtimestamp(timestamp, tz=tz)

        @staticmethod
        def fromisoformat(value):
            return datetime.fromisoformat(value)

    monkeypatch.setattr(weekly_update, "datetime", _FixedDatetime)
    monkeypatch.setattr(
        weekly_update,
        "_load_baseline_by_id",
        lambda: {
            1: BaselineState(job_id=1, scheduled_date=None),
            2: BaselineState(job_id=2, scheduled_date=datetime(2026, 6, 1, 7, 0, 0, tzinfo=timezone.utc)),
        },
    )
    monkeypatch.setattr(
        weekly_update,
        "_fetch_live_jobs_normalized",
        lambda job_type, now: [
            {"id": 1, "scheduled_date": datetime(2026, 6, 2, 7, 0, 0, tzinfo=timezone.utc)},
            {"id": 2, "scheduled_date": datetime(2026, 6, 3, 7, 0, 0, tzinfo=timezone.utc)},
        ],
    )
    monkeypatch.setattr(weekly_update, "get_weekly_stats_row_for_run", lambda now, job_type: existing_row)

    result = weekly_update.print_baseline_to_now_diff()

    assert result["scheduled_delta_since_baseline"] == 1
    assert result["rescheduled_delta_since_baseline"] == 1
    assert result["candidate_totals_if_added_to_existing_row"] == {
        "scheduled_count": 15,
        "rescheduled_count": 7,
    }
    assert result["writes_database"] is False
