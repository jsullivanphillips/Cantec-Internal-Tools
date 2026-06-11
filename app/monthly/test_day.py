"""
Parse Excel-style TEST DAY tokens, e.g. ``W1-R7`` (first Wednesday, route 7),
``TH2-R15`` (second Thursday, route 15).

Weekday letters follow longest-prefix matching so ``TH`` is Thursday, not Tuesday.
``weekday_iso`` uses ``datetime.weekday()`` (Monday=0 .. Sunday=6).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Longest token first (``TH`` before ``T``, ``TU`` before ``T``, etc.).
_WEEKDAY_PREFIXES: tuple[tuple[str, int], ...] = (
    ("TH", 3),
    ("SA", 5),
    ("SU", 6),
    ("MO", 0),
    ("TU", 1),
    ("WE", 2),
    ("FR", 4),
    ("W", 2),
    ("T", 1),
    ("M", 0),
    ("F", 4),
)

_REST_PATTERN = re.compile(r"^\s*(\d+)\s*-\s*R\s*(\d+)\s*$", re.IGNORECASE)


@dataclass(frozen=True)
class ParsedTestDay:
    weekday_iso: int
    """``datetime.weekday()`` value (Monday=0 .. Sunday=6)."""

    week_occurrence: int
    """1 = first such weekday in the month."""

    route_number: int
    raw: str


def monthly_test_day_is_cancelled(raw: str | None) -> bool:
    """
    True when TEST DAY is ``-`` (or unicode dash variants), meaning monthly bell
    testing was cancelled for that location — not a routing token.

    Empty / whitespace is **not** cancelled here (use ``parse_test_day`` blank handling).
    """
    text = " ".join((raw or "").strip().split())
    return text in ("-", "–", "—")


def parse_test_day(raw: str | None) -> ParsedTestDay | None:
    """
    Return a structured parse result or ``None`` if ``raw`` is empty/whitespace.

    Call :func:`monthly_test_day_is_cancelled` first so ``-`` is not treated as a parse error.

    Raises ``ValueError`` if the text is non-empty but not a supported TEST DAY token.
    """
    text = (raw or "").strip()
    if not text:
        return None

    head = text.upper()
    wd_iso: int | None = None
    matched_len = 0
    for prefix, iso in _WEEKDAY_PREFIXES:
        if head.startswith(prefix):
            wd_iso = iso
            matched_len = len(prefix)
            break
    if wd_iso is None:
        raise ValueError(f"unrecognized weekday prefix in TEST DAY {text!r}")

    rest = text[matched_len:].strip()
    m = _REST_PATTERN.match(rest)
    if not m:
        raise ValueError(f"expected '<n>-R<route>' after weekday in TEST DAY {text!r}")

    nth = int(m.group(1))
    route = int(m.group(2))
    if nth < 1 or nth > 5:
        raise ValueError(f"week occurrence must be 1..5 in TEST DAY {text!r}")
    if route < 1:
        raise ValueError(f"route number must be positive in TEST DAY {text!r}")

    return ParsedTestDay(
        weekday_iso=wd_iso,
        week_occurrence=nth,
        route_number=route,
        raw=text,
    )


def pattern_key(parsed: ParsedTestDay) -> tuple[int, int]:
    """Canonical (weekday, occurrence) pair for consistency checks."""
    return (parsed.weekday_iso, parsed.week_occurrence)


_ISO_TO_PREFIX: dict[int, str] = {
    0: "M",
    1: "TU",
    2: "W",
    3: "TH",
    4: "F",
    5: "SA",
    6: "SU",
}


def format_test_day_token(*, weekday_iso: int, week_occurrence: int, route_number: int) -> str:
    """Build a canonical TEST DAY token (e.g. ``W1-R7``) for route assignment dropdowns."""
    if not 0 <= weekday_iso <= 6:
        raise ValueError(f"weekday_iso must be 0..6, got {weekday_iso}")
    if week_occurrence < 1 or week_occurrence > 5:
        raise ValueError(f"week_occurrence must be 1..5, got {week_occurrence}")
    if route_number < 1:
        raise ValueError(f"route_number must be positive, got {route_number}")
    prefix = _ISO_TO_PREFIX[weekday_iso]
    return f"{prefix}{week_occurrence}-R{route_number}"
