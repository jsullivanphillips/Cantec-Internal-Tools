"""
Parse technician sheet ``Time In`` / ``Time Out`` cells for monthly route imports.

Produces ``source_value_raw`` for audit and classifies rows into tested/skipped.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_SHEET_TIME_RAW_MAX = 64
_SOURCE_COMBINED_MAX = 255

_ANNUAL_OR_BOOKED = re.compile(r"annual|booked", re.IGNORECASE)


def truncate_sheet_time_raw(cell: str | None) -> str | None:
    s = " ".join((cell or "").strip().split())
    if not s:
        return None
    return s[:_SHEET_TIME_RAW_MAX]


def looks_like_sheet_clock(cell: str | None) -> bool:
    s = " ".join((cell or "").strip().split()).lower()
    if not s:
        return False
    return ("am" in s or "pm" in s or ":" in s) and any(c.isdigit() for c in s)


@dataclass(frozen=True)
class SheetTimeImportRow:
    result_status: str | None
    skip_reason: str | None
    source_value_raw: str | None


def analyze_sheet_time_cells(time_in: str | None, time_out: str | None) -> SheetTimeImportRow:
    """
    Classify sheet time columns for ``MonthlyRouteTestHistory`` upsert.

    When both cells are empty, returns all-null classification (no history row from times).
    """
    raw_in = truncate_sheet_time_raw(time_in)
    raw_out = truncate_sheet_time_raw(time_out)
    if not raw_in and not raw_out:
        return SheetTimeImportRow(None, None, None)

    combined = f"{raw_in or ''} | {raw_out or ''}".strip()
    if len(combined) > _SOURCE_COMBINED_MAX:
        combined = combined[:_SOURCE_COMBINED_MAX]

    if _ANNUAL_OR_BOOKED.search(raw_in or "") or _ANNUAL_OR_BOOKED.search(raw_out or ""):
        return SheetTimeImportRow("skipped", "annual_booked", combined or None)

    if looks_like_sheet_clock(raw_in) or looks_like_sheet_clock(raw_out):
        return SheetTimeImportRow("tested", None, combined or None)

    return SheetTimeImportRow("skipped", "sheet_value", combined or None)
