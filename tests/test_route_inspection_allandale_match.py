from __future__ import annotations

from collections import defaultdict
from types import SimpleNamespace

from app.monthly.route_inspection_csv_import import (
    iter_street_lookup_keys,
    parse_address_block,
    resolve_monthly_location_for_csv_row,
)


def _allandale_locations():
    loc_d = SimpleNamespace(
        id=101,
        address="681 Allandale Road",
        label="Building D",
        label_normalized="building d",
        property_management_company="Sherringham Holdings",
        property_management_company_normalized="sherringham holdings",
        building_name=None,
        monthly_route_id=5,
    )
    loc_b = SimpleNamespace(
        id=102,
        address="681 Allandale Road",
        label="Building B",
        label_normalized="building b",
        property_management_company="Sherringham Holdings",
        property_management_company_normalized="sherringham holdings",
        building_name=None,
        monthly_route_id=5,
    )
    canonical_index: dict[str, list[object]] = defaultdict(list)
    for loc in (loc_d, loc_b):
        for key in iter_street_lookup_keys(loc.address):
            canonical_index[key].append(loc)
    label_index = {
        "building d": [loc_d],
        "building b": [loc_b],
    }
    return loc_d, loc_b, canonical_index, label_index


def test_allandale_building_d_and_b_match_separately():
    loc_d, loc_b, canonical_index, label_index = _allandale_locations()
    for expected, building_letter in ((loc_d, "D"), (loc_b, "B")):
        block = f"""681 Allandale Rd
Building {building_letter}
Name: Allandale District
Management: Sherringham Group"""
        street, building, company = parse_address_block(block)
        matched, err, detail = resolve_monthly_location_for_csv_row(
            canonical_index=canonical_index,
            label_index=label_index,
            monthly_route_id=5,
            street=street,
            building=building,
            company=company,
        )
        assert err is None, detail
        assert matched is expected
