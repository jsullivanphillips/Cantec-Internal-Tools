from __future__ import annotations

from collections import defaultdict
from types import SimpleNamespace

from app.monthly.route_inspection_csv_import import (
    iter_street_index_keys,
    parse_address_block,
    resolve_monthly_location_for_csv_row,
)


def _clarke_location():
    loc = SimpleNamespace(
        id=106,
        address="1209 & 1229 Clarke Road",
        label="1209 & 1229 Clarke Road",
        label_normalized="1209 & 1229 clarke road",
        property_management_company="Central Saanich Municipality",
        property_management_company_normalized="central saanich municipality",
        building_name=None,
        monthly_route_id=36,
    )
    canonical_index: dict[str, list[object]] = defaultdict(list)
    for key in iter_street_index_keys(loc.address):
        canonical_index[key].append(loc)
    label_index = {loc.label_normalized: [loc]}
    return loc, canonical_index, label_index


def test_clarke_plus_civic_matches_ampersand_label():
    loc, canonical_index, label_index = _clarke_location()
    block = """1209+1229 Clarke Road
Name: Central Saanich Cultural Centre
Management:Central Saanich"""
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
