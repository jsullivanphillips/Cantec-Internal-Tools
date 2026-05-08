"""Unit tests for technician sheet street normalization (CSV ↔ library matching)."""

from __future__ import annotations

from app.monthly.route_inspection_csv_import import canonical_street_address_key


def test_canonical_yates_paren_range_matches_hyphen_form():
    assert canonical_street_address_key("709 (-715) Yates") == canonical_street_address_key(
        "709-715 Yates"
    )


def test_canonical_douglas_slash_secondary_address_uses_primary():
    assert canonical_street_address_key("1125 Douglas / (702 Fort)") == canonical_street_address_key(
        "1125 Douglas"
    )


def test_canonical_still_trims_comma_tail_before_slash_rules():
    assert canonical_street_address_key("1125 Douglas / Foo, Victoria, BC") == canonical_street_address_key(
        "1125 Douglas"
    )
