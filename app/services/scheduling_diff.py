# app/services/scheduling_diff.py
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Mapping, Any


@dataclass(frozen=True)
class BaselineState:
    job_id: int
    scheduled_date: Optional[datetime]


def compute_scheduling_diffs(
    baseline_by_id: Mapping[int, BaselineState],
    live_jobs: list[dict[str, Any]],
) -> tuple[int, int]:
    """
    Returns: (scheduled_count, rescheduled_count)

    scheduled_count:
      - baseline missing AND live has scheduled_date
      - baseline scheduled_date is None AND live has scheduled_date

    rescheduled_count:
      - baseline scheduled_date not None AND live scheduled_date not None AND changed

    Note:
      - live scheduled_date None does not count as anything
      - if you later want "unscheduled_count", add it here
    """
    scheduled_count = 0
    rescheduled_count = 0

    for job in live_jobs:
        job_id = job.get("id")
        if not job_id:
            continue

        new_sd: Optional[datetime] = job.get("scheduled_date")  # normalized upstream
        baseline = baseline_by_id.get(job_id)
        old_sd = baseline.scheduled_date if baseline else None

        if baseline is None:
            if new_sd is not None:
                scheduled_count += 1
            continue

        if old_sd is None and new_sd is not None:
            scheduled_count += 1
            continue

        if old_sd is not None and new_sd is not None and old_sd != new_sd:
            rescheduled_count += 1

    return scheduled_count, rescheduled_count
