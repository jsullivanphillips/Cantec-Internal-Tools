"""Dashboard ServiceTrade job dot indicator."""

from __future__ import annotations

from types import SimpleNamespace

from app.monthly.service_trade_run_job_dashboard import dashboard_service_trade_job_dot
from app.monthly.service_trade_route_run_timing import (
    SYNC_STATUS_NO_JOB,
    SYNC_STATUS_NO_ST_LINK,
    SYNC_STATUS_OK,
    SYNC_STATUS_SCHEDULED,
)


def _row(**kwargs):
    return SimpleNamespace(**kwargs)


def test_dot_grey_without_st_route_link():
    dot = dashboard_service_trade_job_dot(has_st_route_link=False, timing_row=None)
    assert dot == {"color": "grey", "tooltip": "No ServiceTrade route link"}


def test_dot_red_without_cached_row():
    dot = dashboard_service_trade_job_dot(has_st_route_link=True, timing_row=None)
    assert dot["color"] == "red"
    assert dot["tooltip"] == "No ServiceTrade testing job for this month"


def test_dot_green_when_completed():
    dot = dashboard_service_trade_job_dot(
        has_st_route_link=True,
        timing_row=_row(
            sync_status=SYNC_STATUS_OK,
            service_trade_job_id=101,
            service_trade_job_status="completed",
            service_trade_appointment_released=False,
        ),
    )
    assert dot == {
        "color": "green",
        "tooltip": "ServiceTrade testing job completed",
    }


def test_dot_green_light_when_released():
    dot = dashboard_service_trade_job_dot(
        has_st_route_link=True,
        timing_row=_row(
            sync_status=SYNC_STATUS_SCHEDULED,
            service_trade_job_id=102,
            service_trade_job_status="scheduled",
            service_trade_appointment_released=True,
        ),
    )
    assert dot == {
        "color": "green_light",
        "tooltip": "ServiceTrade job released to technicians",
    }


def test_dot_blue_light_when_scheduled_not_released():
    dot = dashboard_service_trade_job_dot(
        has_st_route_link=True,
        timing_row=_row(
            sync_status=SYNC_STATUS_SCHEDULED,
            service_trade_job_id=103,
            service_trade_job_status="scheduled",
            service_trade_appointment_released=False,
        ),
    )
    assert dot == {
        "color": "blue_light",
        "tooltip": "ServiceTrade job scheduled — not released yet",
    }


def test_dot_red_when_no_job_cached():
    dot = dashboard_service_trade_job_dot(
        has_st_route_link=True,
        timing_row=_row(
            sync_status=SYNC_STATUS_NO_JOB,
            service_trade_job_id=None,
            service_trade_job_status=None,
            service_trade_appointment_released=None,
        ),
    )
    assert dot["color"] == "red"
    assert dot["tooltip"] == "No ServiceTrade testing job for this month"


def test_dot_grey_when_no_st_link_status():
    dot = dashboard_service_trade_job_dot(
        has_st_route_link=True,
        timing_row=_row(
            sync_status=SYNC_STATUS_NO_ST_LINK,
            service_trade_job_id=None,
            service_trade_job_status=None,
            service_trade_appointment_released=None,
        ),
    )
    assert dot["tooltip"] == "No ServiceTrade route link"
