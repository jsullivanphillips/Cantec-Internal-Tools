"""Unit tests for technician sheet street normalization (CSV ↔ library matching)."""

from __future__ import annotations

from app.monthly.route_inspection_csv_import import (
    _pmc_sheet_matches_db,
    canonical_street_address_key,
    iter_street_lookup_keys,
    parse_address_block,
)


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


def test_canonical_pat_bay_matches_patricia_bay():
    assert canonical_street_address_key("5100 Patricia Bay Hwy") == canonical_street_address_key(
        "5100 Pat Bay Highway"
    )


def test_canonical_keating_x_road_matches_cross_road():
    assert canonical_street_address_key("2261 Keating Cross Road") == canonical_street_address_key(
        "2261 Keating X Road"
    )


def test_parse_address_block_standalone_building_line():
    street, building, company = parse_address_block("4678 Elk Lake Drive\nBuilding B")
    assert street == "4678 Elk Lake Drive"
    assert building == "Building B"
    assert company is None


def test_parse_address_block_name_colon_still_sets_building():
    street, building, company = parse_address_block(
        "620 View Street\nName: Central\nManagement: Equitex"
    )
    assert street == "620 View Street"
    assert building == "Central"
    assert company == "Equitex"


def test_pmc_fuzzy_colliers_vs_colliers_mall():
    assert _pmc_sheet_matches_db("colliers", "colliers - mall")
    assert _pmc_sheet_matches_db("colliers - mall", "colliers") is False


def test_pmc_fuzzy_sheet_longer_than_db_not_matched():
    assert _pmc_sheet_matches_db("colliers international", "colliers") is False


def test_pmc_no_false_match_unrelated_prefix():
    assert _pmc_sheet_matches_db("cent", "century") is False


def test_canonical_merchant_matches_merchant_way():
    sheet = canonical_street_address_key("3011 Merchant")
    db_keys = iter_street_lookup_keys("3011 Merchant Way")
    assert sheet in db_keys


def test_canonical_mills_rd_w_matches_mills_road():
    assert canonical_street_address_key("2035 Mills Rd W") == canonical_street_address_key(
        "2035 Mills Road"
    )


def test_canonical_civic_letter_suffix_matches_bare_number():
    assert canonical_street_address_key("9911a McDonald Park") == canonical_street_address_key(
        "9911 McDonald Park"
    )


def test_canonical_mcdonlad_typo_matches_mcdonald():
    assert canonical_street_address_key("9911 McDonlad Park") == canonical_street_address_key(
        "9911 McDonald Park"
    )


def test_canonical_academy_cl_matches_close():
    assert canonical_street_address_key("805 Academy Cl") == canonical_street_address_key(
        "805 Academy Close"
    )


def test_canonical_cedar_hill_matches_cedar_hill_cross_road():
    sheet = canonical_street_address_key("3221 Cedar Hill")
    db_keys = iter_street_lookup_keys("3221 Cedar Hill Cross Road")
    assert sheet in db_keys
