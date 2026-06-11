from __future__ import annotations

from collections import defaultdict
from types import SimpleNamespace

from app.monthly.route_inspection_csv_import import (
    canonical_street_address_key,
    iter_street_index_keys,
    iter_street_lookup_keys,
    parse_address_block,
    resolve_monthly_location_for_csv_row,
)


def _newton_location():
    loc = SimpleNamespace(
        id=308,
        address="2530 Mt Newton X Road",
        label="2530 Mt Newton X Road",
        label_normalized="2530 mt newton x road",
        property_management_company="Starlight/Devon",
        property_management_company_normalized="starlight/devon",
        building_name="Lochside Apartments",
        monthly_route_id=36,
    )
    canonical_index: dict[str, list[object]] = defaultdict(list)
    for key in iter_street_index_keys(loc.address):
        canonical_index[key].append(loc)
    label_index = {loc.label_normalized: [loc]}
    return loc, canonical_index, label_index


def test_newton_x_rd_canonical_matches_x_road_address():
    sheet = canonical_street_address_key("2530 Mt Newton X Rd")
    db = canonical_street_address_key("2530 Mt Newton X Road")
    assert sheet == db == "2530 mount newton cross road"
    assert iter_street_lookup_keys("2530 Mt Newton X Rd")[0] in iter_street_lookup_keys(
        "2530 Mt Newton X Road"
    )


def test_newton_sheet_row_matches_library_label():
    loc, canonical_index, label_index = _newton_location()
    block = """2530 Mt Newton X Rd
Name: Lochside Apartments 
Management:Starlight / Devon"""
    street, building, company = parse_address_block(block)
    matched, err, detail = resolve_monthly_location_for_csv_row(
        canonical_index=canonical_index,
        label_index=label_index,
        monthly_route_id=36,
        street=street,
        building=building,
        company=company,
    )
    assert err is None, detail
    assert matched is loc
