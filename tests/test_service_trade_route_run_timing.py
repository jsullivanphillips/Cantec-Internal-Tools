"""Unit tests for ServiceTrade route run timing helpers."""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from app.monthly.service_trade_route_run_timing import (
    SYNC_STATUS_NO_JOB,
    SYNC_STATUS_NO_ST_LINK,
    SYNC_STATUS_OK,
    SYNC_STATUS_SCHEDULED,
    RouteRunTimingSyncResult,
    fetch_scheduled_testing_jobs_route_month,
    run_times_from_clock_pairs,
    select_testing_job_for_month,
    sync_route_month_timing,
)

PACIFIC = ZoneInfo("America/Vancouver")


def _month_window_may_2026() -> tuple[int, int]:
    start = datetime(2026, 5, 1, tzinfo=PACIFIC)
    end = datetime(2026, 6, 1, tzinfo=PACIFIC)
    return int(start.timestamp()), int(end.timestamp())


def _job(
    job_id: int,
    *,
    job_type: str = "testing",
    window_start: int,
    status: str = "scheduled",
) -> dict:
    return {
        "id": job_id,
        "type": job_type,
        "status": status,
        "appointments": [
            {
                "status": status,
                "windowStart": window_start,
            }
        ],
    }


def test_select_testing_job_for_month_picks_latest_window_start():
    start_ts, end_ts = _month_window_may_2026()
    early = int(datetime(2026, 5, 5, 9, 0, tzinfo=PACIFIC).timestamp())
    late = int(datetime(2026, 5, 20, 9, 0, tzinfo=PACIFIC).timestamp())
    jobs = [
        _job(101, window_start=early),
        _job(102, window_start=late),
        _job(103, job_type="inspection", window_start=late),
    ]
    selected = select_testing_job_for_month(jobs, start_ts=start_ts, end_ts=end_ts)
    assert selected is not None
    assert selected["id"] == 102


def test_select_testing_job_for_month_none_when_no_qualifying_jobs():
    start_ts, end_ts = _month_window_may_2026()
    outside = int(datetime(2026, 4, 15, 9, 0, tzinfo=PACIFIC).timestamp())
    jobs = [_job(101, window_start=outside)]
    assert select_testing_job_for_month(jobs, start_ts=start_ts, end_ts=end_ts) is None


def test_run_times_from_clock_pairs_uses_onsite_span():
    in_ts = int(datetime(2026, 5, 15, 8, 15, tzinfo=PACIFIC).timestamp())
    out_ts = int(datetime(2026, 5, 15, 16, 0, tzinfo=PACIFIC).timestamp())
    pairs = [
        {
            "start": {"activity": "onsite", "eventTime": in_ts},
            "end": {"activity": "onsite", "eventTime": out_ts},
        },
        {
            "start": {"activity": "travel", "eventTime": in_ts},
            "end": {"activity": "travel", "eventTime": out_ts},
        },
    ]
    clock_in_at, clock_out_at, duration_minutes = run_times_from_clock_pairs(pairs)
    assert clock_in_at is not None
    assert clock_out_at is not None
    assert duration_minutes == (16 * 60) - (8 * 60 + 15)


def test_run_times_from_clock_pairs_returns_none_without_onsite():
    pairs = [
        {
            "start": {"activity": "travel", "eventTime": 1},
            "end": {"activity": "travel", "eventTime": 2},
        }
    ]
    assert run_times_from_clock_pairs(pairs) == (None, None, None)


class _FakeResponse:
    def __init__(self, payload: dict):
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


class _FakeSession:
    def __init__(self, responses: dict[str, dict]):
        self.responses = responses
        self.calls: list[tuple[str, dict | None]] = []

    def get(self, url: str, params=None):
        self.calls.append((url, params))
        if "/appointment" in url:
            return _FakeResponse(self.responses.get("appointments", {"data": {"appointments": []}}))
        if "/clockevent" in url:
            job_id = url.rstrip("/").split("/")[-2]
            return _FakeResponse(self.responses.get(f"clockevent:{job_id}", {"data": {"pairedEvents": []}}))
        if params and params.get("status") == "scheduled":
            return _FakeResponse(self.responses.get("scheduled_jobs", {"data": {"jobs": [], "totalPages": 1}}))
        return _FakeResponse(self.responses.get("jobs", {"data": {"jobs": [], "totalPages": 1}}))


def test_sync_route_month_timing_no_st_link():
    result = sync_route_month_timing(SimpleNamespace(), st_route_id=None, month_first=datetime(2026, 5, 1).date())
    assert result.sync_status == SYNC_STATUS_NO_ST_LINK
    assert result.duration_minutes is None


def test_sync_route_month_timing_no_job():
    session = _FakeSession({"jobs": {"data": {"jobs": [], "totalPages": 1}}})
    result = sync_route_month_timing(session, st_route_id=999, month_first=datetime(2026, 5, 1).date())
    assert result.sync_status == SYNC_STATUS_NO_JOB


def test_sync_route_month_timing_ok():
    start_ts = int(datetime(2026, 5, 10, 8, 0, tzinfo=PACIFIC).timestamp())
    in_ts = int(datetime(2026, 5, 10, 8, 0, tzinfo=PACIFIC).timestamp())
    out_ts = int(datetime(2026, 5, 10, 14, 0, tzinfo=PACIFIC).timestamp())
    session = _FakeSession(
        {
            "jobs": {
                "data": {
                    "jobs": [_job(501, window_start=start_ts)],
                    "totalPages": 1,
                }
            },
            "clockevent:501": {
                "data": {
                    "pairedEvents": [
                        {
                            "start": {"activity": "onsite", "eventTime": in_ts},
                            "end": {"activity": "onsite", "eventTime": out_ts},
                        }
                    ]
                }
            },
        }
    )
    result = sync_route_month_timing(session, st_route_id=123, month_first=datetime(2026, 5, 1).date())
    assert isinstance(result, RouteRunTimingSyncResult)
    assert result.sync_status == SYNC_STATUS_OK
    assert result.service_trade_job_id == 501
    assert result.duration_minutes == 6 * 60


def test_sync_route_month_timing_scheduled_job_before_completion():
    start_ts = int(datetime(2026, 7, 7, 8, 0, tzinfo=PACIFIC).timestamp())
    session = _FakeSession(
        {
            "jobs": {"data": {"jobs": [], "totalPages": 1}},
            "scheduled_jobs": {
                "data": {
                    "jobs": [_job(701, window_start=start_ts, status="scheduled")],
                    "totalPages": 1,
                }
            },
        }
    )
    result = sync_route_month_timing(session, st_route_id=123, month_first=datetime(2026, 7, 1).date())
    assert result.sync_status == SYNC_STATUS_SCHEDULED
    assert result.service_trade_job_id == 701
    assert result.duration_minutes is None
    assert result.service_trade_job_status == "scheduled"
    assert result.service_trade_appointment_released is None
    assert not any("/clockevent" in url for url, _ in session.calls)


def test_fetch_scheduled_testing_jobs_enriches_missing_appointments():
    start_ts, end_ts = _month_window_may_2026()
    session = _FakeSession(
        {
            "scheduled_jobs": {
                "data": {
                    "jobs": [{"id": 801, "type": "testing", "status": "scheduled"}],
                    "totalPages": 1,
                }
            },
            "appointments": {
                "data": {
                    "appointments": [
                        {"status": "scheduled", "windowStart": start_ts + 3600, "released": False}
                    ]
                }
            },
        }
    )
    jobs = fetch_scheduled_testing_jobs_route_month(
        session,
        55,
        month_first=datetime(2026, 5, 1).date(),
    )
    assert len(jobs) == 1
    assert jobs[0]["appointments"][0]["released"] is False
    selected = select_testing_job_for_month(jobs, start_ts=start_ts, end_ts=end_ts)
    assert selected is not None
    assert selected["id"] == 801
