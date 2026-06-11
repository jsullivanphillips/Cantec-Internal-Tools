"""Unit tests for technician sheet street normalization (CSV ↔ library matching)."""

from __future__ import annotations

from app.monthly.route_inspection_csv_import import (
    _pmc_sheet_matches_db,
    canonical_street_address_key,
    iter_street_index_keys,
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
    assert canonical_street_address_key("2261 Keating X Rd") == canonical_street_address_key(
        "2261 Keating Cross Road"
    )


def test_canonical_gorge_road_east_matches_e():
    assert canonical_street_address_key("129 Gorge Road East") == canonical_street_address_key(
        "129 Gorge Road E"
    )


def test_parse_address_block_seaport_place():
    street, building, company = parse_address_block(
        "9851 Seaport Place\nName: Seaport Place\nManagement: Colliers"
    )
    assert street == "9851 Seaport Place"
    assert building == "Seaport Place"
    assert company == "Colliers"


def test_parse_address_block_standalone_building_line():
    street, building, company = parse_address_block("4678 Elk Lake Drive\nBuilding B")
    assert street == "4678 Elk Lake Drive"
    assert building == "Building B"
    assert company is None


def test_parse_address_block_building_line_wins_over_name_for_disambiguation():
    street, building, company = parse_address_block(
        "681 Allandale Rd\nBuilding D\nName: Allandale District\nManagement: Sherringham Group"
    )
    assert street == "681 Allandale Rd"
    assert building == "Building D"
    assert company == "Sherringham Group"


def test_parse_address_block_name_colon_still_sets_building():
    street, building, company = parse_address_block(
        "620 View Street\nName: Central\nManagement: Equitex"
    )
    assert street == "620 View Street"
    assert building == "Central"
    assert company == "Equitex"


def test_parse_address_block_inline_name_and_management():
    street, building, company = parse_address_block(
        "990 View & 911 Yates (London Drugs) Name: Harris Green Management:Colliers"
    )
    assert street == "990 View & 911 Yates (London Drugs)"
    assert building == "Harris Green"
    assert company == "Colliers"


def test_parse_address_block_inline_name_and_management_multiline():
    """Standalone ``Building …`` on a later line wins over inline ``Name:`` on the street line."""
    street, building, company = parse_address_block(
        "990 View & 911 Yates (London Drugs) Name: Harris Green Management:Colliers\nBuilding B"
    )
    assert street == "990 View & 911 Yates (London Drugs)"
    assert building == "Building B"
    assert company == "Colliers"


def test_pmc_fuzzy_colliers_vs_colliers_mall():
    assert _pmc_sheet_matches_db("colliers", "colliers - mall")
    assert _pmc_sheet_matches_db("colliers - mall", "colliers") is False


def test_pmc_fuzzy_sheet_longer_than_db_not_matched():
    assert _pmc_sheet_matches_db("colliers international", "colliers") is False


def test_pmc_fuzzy_shared_lead_token_group_vs_holdings():
    assert _pmc_sheet_matches_db("sherringham group", "sherringham holdings")


def test_pmc_fuzzy_tpm_vs_tpm_properties():
    assert _pmc_sheet_matches_db("tpm", "tpm properties")


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
    assert canonical_street_address_key("9911a McDonald Park") != canonical_street_address_key(
        "9911 McDonald Park"
    )
    sheet_keys = iter_street_lookup_keys("9911a McDonald Park")
    db_keys = iter_street_index_keys("9911 McDonald Park")
    assert canonical_street_address_key("9911 McDonald Park") in sheet_keys
    assert sheet_keys[0] in db_keys or canonical_street_address_key("9911 McDonald Park") in db_keys


def test_canonical_3319a_and_3319b_stay_distinct():
    assert canonical_street_address_key("3319A Painter Road") == "3319a painter road"
    assert canonical_street_address_key("3319B Painter Road") == "3319b painter road"
    assert (
        canonical_street_address_key("3319A Painter Road")
        != canonical_street_address_key("3319B Painter Road")
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


def test_canonical_ampersand_corners_order_insensitive():
    sheet = canonical_street_address_key("990 View & 911 Yates (London Drugs)")
    db = canonical_street_address_key("911 Yates Street & 990 View Street")
    assert sheet == "911 yates 990 view"
    assert db == "911 yates street 990 view street"


def test_dual_civic_plus_matches_ampersand_label():
    sheet = canonical_street_address_key("1209+1229 Clarke Road")
    db = canonical_street_address_key("1209 & 1229 Clarke Road")
    assert sheet == db
    assert iter_street_lookup_keys("1209+1229 Clarke Road")[0] in iter_street_lookup_keys(
        "1209 & 1229 Clarke Road"
    )


def test_ampersand_corner_sheet_matches_db_lookup_keys():
    sheet_keys = iter_street_lookup_keys("990 View & 911 Yates (London Drugs)")
    db_keys = iter_street_lookup_keys("911 Yates Street & 990 View Street")
    assert sheet_keys[0] in db_keys
