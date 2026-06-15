"""Parse technician visit clock strings (sheet + portal) for dashboard metrics."""

from __future__ import annotations

import re

from app.monthly.sheet_visit_times import looks_like_sheet_clock

_AMPM_RE = re.compile(
    r"^\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*$",
    re.IGNORECASE,
)
_24H_RE = re.compile(r"^\s*(\d{1,2}):(\d{2})\s*$")


def _infer_visit_clock_is_am(hour12: int) -> bool:
    """Guess AM/PM for route visit clocks written without meridiem.

    Field sheets typically cover morning through early afternoon:
    - 7–11 → AM
    - 12 → PM (noon; ``12:41`` is lunch, not 12:41 AM)
    - 1–6 → PM
    """
    if 1 <= hour12 <= 6:
        return False
    if 7 <= hour12 <= 11:
        return True
    if hour12 == 12:
        return False
    raise ValueError(f"hour out of range: {hour12}")


def _hour12_to_minutes_since_midnight(hour12: int, minute: int, *, is_am: bool) -> int:
    if is_am:
        hour24 = 0 if hour12 == 12 else hour12
    else:
        hour24 = 12 if hour12 == 12 else hour12 + 12
    return hour24 * 60 + minute


def parse_visit_clock_minutes(raw: str | None) -> int | None:
    """Parse a visit clock label to minutes since midnight, or ``None`` if not a clock."""
    text = " ".join((raw or "").strip().split())
    if not text or not looks_like_sheet_clock(text):
        return None

    ampm_match = _AMPM_RE.match(text)
    if ampm_match:
        hour = int(ampm_match.group(1))
        minute = int(ampm_match.group(2) or 0)
        meridiem = ampm_match.group(3).upper()
        if hour < 1 or hour > 12 or minute < 0 or minute > 59:
            return None
        if meridiem == "AM":
            hour24 = 0 if hour == 12 else hour
        else:
            hour24 = 12 if hour == 12 else hour + 12
        return hour24 * 60 + minute

    h24_match = _24H_RE.match(text)
    if h24_match:
        hour = int(h24_match.group(1))
        minute = int(h24_match.group(2))
        if minute < 0 or minute > 59:
            return None
        if hour >= 13:
            if hour > 23:
                return None
            return hour * 60 + minute
        if hour == 0:
            return minute
        if 1 <= hour <= 12:
            is_am = _infer_visit_clock_is_am(hour)
            return _hour12_to_minutes_since_midnight(hour, minute, is_am=is_am)
        return None

    return None


def format_visit_clock_minutes(minutes: int) -> str:
    """Format minutes since midnight as ``h:mm AM/PM``."""
    normalized = int(minutes) % (24 * 60)
    hour24 = normalized // 60
    minute = normalized % 60
    meridiem = "AM" if hour24 < 12 else "PM"
    hour12 = hour24 % 12 or 12
    return f"{hour12}:{minute:02d} {meridiem}"


def median_minutes(values: list[int]) -> int | None:
    if not values:
        return None
    ordered = sorted(int(v) for v in values)
    mid = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[mid]
    return round((ordered[mid - 1] + ordered[mid]) / 2)


MINUTES_PER_DAY = 24 * 60


def duration_minutes_from_start_end(start_minute: int, end_minute: int) -> int:
    duration = int(end_minute) - int(start_minute)
    if duration < 0:
        duration += MINUTES_PER_DAY
    return duration
