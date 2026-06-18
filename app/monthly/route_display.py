"""Shared monthly route display labels for API and portal."""

from __future__ import annotations

from app.db_models import MonthlyRoute

_WD_FULL = (
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
)

DISPLAY_NAME_MAX_LEN = 255


def english_ordinal(n: int) -> str:
    """1st, 2nd, … for monthly week occurrence (typically 1..5)."""
    if 11 <= (n % 100) <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def normalize_route_display_name(raw: object) -> str | None:
    """Strip and normalize optional route display_name; empty → None."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        raw = str(raw)
    s = raw.strip()
    if not s:
        return None
    if len(s) > DISPLAY_NAME_MAX_LEN:
        s = s[:DISPLAY_NAME_MAX_LEN]
    return s


def monthly_route_schedule_label(mr: MonthlyRoute) -> str:
    """Schedule-only label, e.g. ``R17 · 3rd Monday``."""
    wd = (
        _WD_FULL[mr.weekday_iso]
        if isinstance(mr.weekday_iso, int) and 0 <= mr.weekday_iso <= 6
        else "?"
    )
    occ = int(mr.week_occurrence) if mr.week_occurrence is not None else 0
    nth = english_ordinal(occ) if occ >= 1 else str(occ)
    return f"R{mr.route_number} · {nth} {wd}"


def monthly_route_display_label(mr: MonthlyRoute) -> str:
    """Human-facing label with optional suffix, e.g. ``R17 · 3rd Monday · Thrifty's 2``."""
    base = monthly_route_schedule_label(mr)
    dn = normalize_route_display_name(mr.display_name)
    return f"{base} · {dn}" if dn else base
