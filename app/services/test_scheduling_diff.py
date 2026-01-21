# tests/services/test_scheduling_diff.py
from datetime import datetime, timezone

from app.services.scheduling_diff import BaselineState, compute_scheduling_diffs


def dt(y, m, d, hh=0, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=timezone.utc)


def test_new_job_already_scheduled_counts_as_scheduled():
    baseline = {}  # job not in DB yet
    live = [{"id": 1, "scheduled_date": dt(2026, 2, 1)}]

    scheduled, rescheduled = compute_scheduling_diffs(baseline, live)

    assert scheduled == 1
    assert rescheduled == 0


def test_new_job_unscheduled_does_not_count():
    baseline = {}
    live = [{"id": 1, "scheduled_date": None}]

    scheduled, rescheduled = compute_scheduling_diffs(baseline, live)

    assert scheduled == 0
    assert rescheduled == 0


def test_existing_unscheduled_to_scheduled_counts_as_scheduled():
    baseline = {1: BaselineState(job_id=1, scheduled_date=None)}
    live = [{"id": 1, "scheduled_date": dt(2026, 2, 1)}]

    scheduled, rescheduled = compute_scheduling_diffs(baseline, live)

    assert scheduled == 1
    assert rescheduled == 0


def test_existing_scheduled_unchanged_does_not_count():
    baseline = {1: BaselineState(job_id=1, scheduled_date=dt(2026, 2, 1))}
    live = [{"id": 1, "scheduled_date": dt(2026, 2, 1)}]

    scheduled, rescheduled = compute_scheduling_diffs(baseline, live)

    assert scheduled == 0
    assert rescheduled == 0


def test_existing_scheduled_to_different_date_counts_as_rescheduled():
    baseline = {1: BaselineState(job_id=1, scheduled_date=dt(2026, 2, 1))}
    live = [{"id": 1, "scheduled_date": dt(2026, 2, 8)}]

    scheduled, rescheduled = compute_scheduling_diffs(baseline, live)

    assert scheduled == 0
    assert rescheduled == 1


def test_existing_scheduled_to_none_does_not_count_in_current_rules():
    # Your current rules don't track "unscheduled_count"
    baseline = {1: BaselineState(job_id=1, scheduled_date=dt(2026, 2, 1))}
    live = [{"id": 1, "scheduled_date": None}]

    scheduled, rescheduled = compute_scheduling_diffs(baseline, live)

    assert scheduled == 0
    assert rescheduled == 0


def test_multiple_jobs_mixed_counts_correctly():
    baseline = {
        1: BaselineState(job_id=1, scheduled_date=None),               # will become scheduled => scheduled +1
        2: BaselineState(job_id=2, scheduled_date=dt(2026, 2, 1)),      # will reschedule => rescheduled +1
        3: BaselineState(job_id=3, scheduled_date=dt(2026, 2, 1)),      # unchanged => +0
    }
    live = [
        {"id": 1, "scheduled_date": dt(2026, 2, 3)},
        {"id": 2, "scheduled_date": dt(2026, 2, 5)},
        {"id": 3, "scheduled_date": dt(2026, 2, 1)},
        {"id": 4, "scheduled_date": dt(2026, 2, 7)},  # new scheduled job => scheduled +1
        {"id": 5, "scheduled_date": None},            # new unscheduled => +0
    ]

    scheduled, rescheduled = compute_scheduling_diffs(baseline, live)

    assert scheduled == 2  # job 1 + job 4
    assert rescheduled == 1  # job 2
