"""Dashboard route-card indicator for cached ServiceTrade testing jobs."""

from __future__ import annotations

from app.db_models import MonthlyRouteRunTimingMonth
from app.monthly.service_trade_route_run_timing import (
    SYNC_STATUS_NO_JOB,
    SYNC_STATUS_NO_ST_LINK,
    SYNC_STATUS_SCHEDULED,
)

ServiceTradeJobDotColor = str  # "green" | "green_light" | "blue_light" | "grey" | "red"


def _no_service_trade_job_dot() -> dict[str, str]:
    return {
        "color": "red",
        "tooltip": "No ServiceTrade testing job for this month",
    }


def dashboard_service_trade_job_dot(
    *,
    has_st_route_link: bool,
    timing_row: MonthlyRouteRunTimingMonth | None,
) -> dict[str, str]:
    """Return ``{color, tooltip}`` for the monthlies routes overview card."""
    if not has_st_route_link:
        return {
            "color": "grey",
            "tooltip": "No ServiceTrade route link",
        }
    if timing_row is None:
        return _no_service_trade_job_dot()
    if timing_row.sync_status == SYNC_STATUS_NO_ST_LINK:
        return {
            "color": "grey",
            "tooltip": "No ServiceTrade route link",
        }
    if timing_row.sync_status == SYNC_STATUS_NO_JOB or timing_row.service_trade_job_id is None:
        return _no_service_trade_job_dot()

    job_status = (timing_row.service_trade_job_status or "").strip().lower()
    if job_status == "completed":
        return {
            "color": "green",
            "tooltip": "ServiceTrade testing job completed",
        }
    if timing_row.service_trade_appointment_released is True:
        return {
            "color": "green_light",
            "tooltip": "ServiceTrade job released to technicians",
        }
    if job_status == "scheduled" or timing_row.sync_status == SYNC_STATUS_SCHEDULED:
        return {
            "color": "blue_light",
            "tooltip": "ServiceTrade job scheduled — not released yet",
        }
    return {
        "color": "grey",
        "tooltip": "No qualifying ServiceTrade appointment this month",
    }
