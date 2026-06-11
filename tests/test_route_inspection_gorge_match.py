from __future__ import annotations

from collections import defaultdict
from types import SimpleNamespace

from app.monthly.route_inspection_csv_import import (
    _preprocess_sheet_street_for_match,
    iter_street_index_keys,
    parse_address_block,
    resolve_monthly_location_for_csv_row,
)


def _gorge_locations():
    locs = {}
    for letter in "AB":
        locs[letter] = SimpleNamespace(
            id=100 + ord(letter),
            address="120 Gorge Road East",
            label=f"120 Gorge Road East - Building {letter}",
            label_normalized=f"120 gorge road east - building {letter.lower()}",
            property_management_company="Victoria Native Friendship Centre",
            property_management_company_normalized="victoria native friendship centre",
            building_name=None,
            monthly_route_id=46,
        )
    canonical_index: dict[str, list[object]] = defaultdict(list)
    for loc in locs.values():
        for key in iter_street_index_keys(loc.address):
            canonical_index[key].append(loc)
    label_index = {loc.label_normalized: [loc] for loc in locs.values()}
    return locs, canonical_index, label_index


def test_gorge_building_paren_stripped_for_street_canonical_only():
    assert _preprocess_sheet_street_for_match('120 Gorge Road East (Building "A")') == (
        "120 Gorge Road East"
    )


def test_gorge_buildings_a_and_b_match_separately():
    locs, canonical_index, label_index = _gorge_locations()
    for expected, letter in ((locs["A"], "A"), (locs["B"], "B")):
        block = f"""120 Gorge Road East (Building "{letter}")
Name: Victoria Native Friendship Centre
Management: Victoria Native Friendship Centre"""
        street, building, company = parse_address_block(block)
        assert street == "120 Gorge Road East"
        assert building == f"Building {letter}"
        matched, err, detail = resolve_monthly_location_for_csv_row(
            canonical_index=canonical_index,
            label_index=label_index,
            monthly_route_id=46,
            street=street,
            building=building,
            company=company,
        )
        assert err is None, detail
        assert matched is expected
