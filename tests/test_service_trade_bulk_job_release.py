"""Bulk ServiceTrade job release helpers."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

from app.monthly.service_trade_bulk_job_release import (
    eligible_routes_from_cache,
    month_allows_bulk_st_release,
    timing_row_eligible_for_bulk,
)
from app.monthly.service_trade_route_run_timing import SYNC_STATUS_SCHEDULED


def test_month_not_allowed_for_past_month():
    current = date(2026, 6, 1)
    assert month_allows_bulk_st_release(date(2026, 6, 1), current_month_first=current) is True
    assert month_allows_bulk_st_release(date(2026, 7, 1), current_month_first=current) is True
    assert month_allows_bulk_st_release(date(2026, 5, 1), current_month_first=current) is False


def test_timing_row_eligible_for_scheduled_only():
    row = SimpleNamespace(
        service_trade_job_id=100,
        sync_status=SYNC_STATUS_SCHEDULED,
        service_trade_job_status="scheduled",
        service_trade_appointment_released=False,
    )
    assert timing_row_eligible_for_bulk(row) is True

    completed = SimpleNamespace(
        service_trade_job_id=101,
        sync_status="ok",
        service_trade_job_status="completed",
        service_trade_appointment_released=True,
    )
    assert timing_row_eligible_for_bulk(completed) is False


def test_bulk_status_action_release_vs_unrelease():
    routes = [SimpleNamespace(id=1, route_number=5, service_trade_route_location_id=9001)]
    timing = {
        1: SimpleNamespace(
            monthly_route_id=1,
            service_trade_job_id=100,
            sync_status=SYNC_STATUS_SCHEDULED,
            service_trade_job_status="scheduled",
            service_trade_appointment_released=False,
        )
    }
    eligible = eligible_routes_from_cache(routes, timing)
    assert len(eligible) == 1
    assert eligible[0].released is False

    timing_released = {
        1: SimpleNamespace(
            monthly_route_id=1,
            service_trade_job_id=100,
            sync_status=SYNC_STATUS_SCHEDULED,
            service_trade_job_status="scheduled",
            service_trade_appointment_released=True,
        )
    }
    eligible_released = eligible_routes_from_cache(routes, timing_released)
    assert all(row.released is True for row in eligible_released)
