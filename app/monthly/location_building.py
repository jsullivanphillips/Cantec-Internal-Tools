"""Building name helpers for flat ``MonthlyLocation`` rows."""

from __future__ import annotations

from app.db_models import MonthlyLocation
from app.monthly.location_identity import normalize_label


def monthly_location_building_name(loc: MonthlyLocation | None) -> str | None:
    """Display building name; falls back to label for legacy rows."""
    if loc is None:
        return None
    explicit = (loc.building_name or "").strip()
    if explicit:
        return explicit
    legacy = (loc.label or "").strip()
    return legacy or None


def monthly_location_sheet_name_normalized(loc: MonthlyLocation) -> str:
    """Normalized name used to match route-inspection CSV ``Name:`` lines."""
    explicit = normalize_label(loc.building_name)
    if explicit:
        return explicit
    return loc.label_normalized or ""
