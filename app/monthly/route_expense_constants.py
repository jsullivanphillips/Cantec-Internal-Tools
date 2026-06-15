"""Fixed defaults for monthly route expense breakdown (Metrics tab)."""

from __future__ import annotations

from app.db_models import MonthlyRoute

LABOUR_RATE_PER_HOUR = 45.0
TRUCK_CHARGE_PER_MONTH = 25.0
DEFAULT_TECH_COUNT = 2
BILLED_AVG_HOURS_THRESHOLD = 7.5
BILLED_AVG_HOURS_CAP = 8.0


def billed_avg_hours(avg_hours: float | None) -> float | None:
    """Hours used for labour expense; (7.5, 8) bills as 8; 8+ uses actual median."""
    if avg_hours is None or avg_hours <= 0:
        return None
    if avg_hours > BILLED_AVG_HOURS_THRESHOLD and avg_hours < BILLED_AVG_HOURS_CAP:
        return BILLED_AVG_HOURS_CAP
    return avg_hours


def is_avg_hours_capped_for_billing(avg_hours: float | None) -> bool:
    if avg_hours is None:
        return False
    return avg_hours > BILLED_AVG_HOURS_THRESHOLD and avg_hours < BILLED_AVG_HOURS_CAP


def effective_tech_count(route: MonthlyRoute) -> int:
    stored = route.tech_count
    if stored is None:
        return DEFAULT_TECH_COUNT
    return int(stored)


def serialize_cost_constants() -> dict[str, float | int]:
    return {
        "labour_rate_per_hour": LABOUR_RATE_PER_HOUR,
        "truck_charge_per_month": TRUCK_CHARGE_PER_MONTH,
        "default_tech_count": DEFAULT_TECH_COUNT,
    }
