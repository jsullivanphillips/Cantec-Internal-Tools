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


def test_canonical_spelled_ordinals_match_numeric_abbreviations():
    assert canonical_street_address_key("100 Third Avenue") == canonical_street_address_key("100 3rd Avenue")
    assert canonical_street_address_key("50 Second Street") == canonical_street_address_key("50 2nd Street")
    assert canonical_street_address_key("1 First Road") == canonical_street_address_key("1 1st Road")


def test_canonical_hyphenated_twenty_first_matches_21st():
    assert canonical_street_address_key("100 Twenty-First Street") == canonical_street_address_key("100 21st Street")


def test_canonical_numeric_ordinal_leading_zeros_normalized():
    assert canonical_street_address_key("100 03rd Ave") == canonical_street_address_key("100 3rd Ave")
