"""Display labels for testing sites on worksheets and monthly stop UI."""

from __future__ import annotations

from app.db_models import MonthlyRouteLocation, MonthlyTestingSite


def billing_address_for_location(
    loc: MonthlyRouteLocation | None,
    location_id: int,
) -> str:
    if loc is not None:
        addr = (loc.display_address or loc.address or "").strip()
        if addr:
            return addr
    return f"Location {location_id}"


def testing_site_primary_label(
    ts: MonthlyTestingSite,
    loc: MonthlyRouteLocation,
    *,
    site_count: int,
    site_index: int = 0,
) -> str:
    """Primary stop title: testing site label, or billing address for single-site null labels."""
    label = (ts.label or "").strip()
    billing = billing_address_for_location(loc, int(loc.id))
    if site_count <= 1:
        return label or billing
    if label:
        return label
    return f"Testing site {site_index + 1}"


def testing_site_billing_subline(
    primary_label: str,
    loc: MonthlyRouteLocation,
) -> str | None:
    billing = billing_address_for_location(loc, int(loc.id))
    if billing.casefold() == (primary_label or "").strip().casefold():
        return None
    return billing


def testing_site_index_and_count(
    ts_list: list[MonthlyTestingSite],
    ts: MonthlyTestingSite,
) -> tuple[int, int]:
    count = len(ts_list) or 1
    for index, row in enumerate(ts_list):
        if int(row.id) == int(ts.id):
            return index, count
    return 0, count


def enrich_stop_display_fields(
    stop: dict[str, object],
    ts: MonthlyTestingSite,
    loc: MonthlyRouteLocation,
    *,
    site_count: int,
    site_index: int = 0,
) -> dict[str, object]:
    primary = testing_site_primary_label(
        ts,
        loc,
        site_count=site_count,
        site_index=site_index,
    )
    stop["primary_label"] = primary
    stop["billing_address_subline"] = testing_site_billing_subline(primary, loc)
    return stop


def location_row_display_labels(
    loc: MonthlyRouteLocation,
    ts_rows: list[MonthlyTestingSite],
) -> tuple[str, list[str] | None]:
    """Billing-board location row: title + optional list of site labels for subline."""
    billing = billing_address_for_location(loc, int(loc.id))
    site_count = len(ts_rows)
    if site_count <= 1:
        if not ts_rows:
            return billing, None
        primary = testing_site_primary_label(ts_rows[0], loc, site_count=1, site_index=0)
        return primary, None
    labels = [
        testing_site_primary_label(ts, loc, site_count=site_count, site_index=index)
        for index, ts in enumerate(ts_rows)
    ]
    return billing, labels
