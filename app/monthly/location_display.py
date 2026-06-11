"""Display labels for flat monthly locations and worksheet rows."""

from __future__ import annotations

import re

from app.db_models import MonthlyLocation

_STREET_SUFFIX_ABBREV = {
    "road": "Rd",
    "street": "St",
    "avenue": "Ave",
    "boulevard": "Blvd",
    "drive": "Dr",
    "lane": "Ln",
    "court": "Ct",
    "place": "Pl",
    "crescent": "Cres",
    "highway": "Hwy",
    "circle": "Cir",
    "trail": "Tr",
    "parkway": "Pkwy",
    "square": "Sq",
}

_STREET_SUFFIX_PATTERN = re.compile(
    r"\b(Road|Street|Avenue|Boulevard|Drive|Lane|Court|Place|Crescent|Highway|Circle|Trail|Parkway|Square)\b",
    re.IGNORECASE,
)


def short_street_address(raw: str) -> str:
    """First comma-separated line with abbreviated street suffixes (``800 Johnson St``)."""
    trimmed = (raw or "").strip()
    if not trimmed:
        return trimmed
    street_line = trimmed.split(",", 1)[0].strip()

    def _repl(match: re.Match[str]) -> str:
        word = match.group(0)
        return _STREET_SUFFIX_ABBREV.get(word.casefold(), word)

    return _STREET_SUFFIX_PATTERN.sub(_repl, street_line)


def billing_address_for_location(
    loc: MonthlyLocation | None,
    location_id: int,
) -> str:
    if loc is not None:
        addr = (loc.display_address or loc.address or "").strip()
        if addr:
            return addr
    return f"Location {location_id}"


def location_primary_label(loc: MonthlyLocation) -> str:
    """Primary title: location label, or billing address when label is empty."""
    label = (loc.label or "").strip()
    billing = billing_address_for_location(loc, int(loc.id))
    return label or billing


def location_billing_subline(
    primary_label: str,
    loc: MonthlyLocation,
) -> str | None:
    billing = billing_address_for_location(loc, int(loc.id))
    if billing.casefold() == (primary_label or "").strip().casefold():
        return None
    return billing


def enrich_location_display_fields(
    location_row: dict[str, object],
    loc: MonthlyLocation,
) -> dict[str, object]:
    primary = location_primary_label(loc)
    location_row["primary_label"] = primary
    location_row["billing_address_subline"] = location_billing_subline(primary, loc)
    return location_row


def location_row_display_labels(loc: MonthlyLocation) -> tuple[str, list[str] | None]:
    """Billing-board location row: title + optional subline labels."""
    return location_primary_label(loc), None
