"""Compatibility wrapper for flat monthly location display helpers."""

from __future__ import annotations

from app.monthly.location_display import (
    billing_address_for_location,
    enrich_location_display_fields,
    location_billing_subline,
    location_primary_label,
    location_row_display_labels,
)

def enrich_stop_display_fields(
    stop: dict[str, object],
    loc,
) -> dict[str, object]:
    """Deprecated alias for the flat location display enricher."""
    return enrich_location_display_fields(stop, loc)
