"""Provenance for ``MonthlyLocationMonth`` outcome fields (master sheet vs run vs portal)."""

from __future__ import annotations

from app.db_models import MonthlyLocationMonth

HISTORY_SOURCE_MASTER_SHEET = "master_sheet"
HISTORY_SOURCE_ROUTE_CSV = "route_csv"
HISTORY_SOURCE_TECHNICIAN_PORTAL = "technician_portal"

PROTECTED_HISTORY_SOURCES = frozenset(
    {
        HISTORY_SOURCE_ROUTE_CSV,
        HISTORY_SOURCE_TECHNICIAN_PORTAL,
    }
)


def is_history_protected_from_master_sheet(row: MonthlyLocationMonth) -> bool:
    """True when master-sheet import must not overwrite existing run or portal outcomes."""
    if (row.history_source or "").strip() in PROTECTED_HISTORY_SOURCES:
        return True
    if row.run_id is not None:
        return True
    if (row.test_outcome or "").strip():
        return True
    return False
