from __future__ import annotations

from collections import defaultdict
from types import SimpleNamespace

from app.monthly.route_inspection_csv_import import (
    iter_street_lookup_keys,
    parse_address_block,
    resolve_monthly_location_for_csv_row,
)


def test_resolve_london_drugs_corner_inline_address_block():
    loc = SimpleNamespace(
        id=569,
        address="911 Yates Street & 990 View Street",
        label="990 View & 911 Yates (London Drugs)",
        label_normalized="990 view & 911 yates (london drugs)",
        property_management_company="Colliers",
        property_management_company_normalized="colliers",
        building_name="Harris Green",
        monthly_route_id=8,
    )
    canonical_index: dict[str, list[object]] = defaultdict(list)
    for key in iter_street_lookup_keys(loc.address):
        canonical_index[key].append(loc)
    label_index = {loc.label_normalized: [loc]}

    addr_block = "990 View & 911 Yates (London Drugs) Name: Harris Green Management:Colliers"
    street, building, company = parse_address_block(addr_block)
    assert street == "990 View & 911 Yates (London Drugs)"
    assert building == "Harris Green"
    assert company == "Colliers"

    matched, err, detail = resolve_monthly_location_for_csv_row(
        canonical_index=canonical_index,
        label_index=label_index,
        monthly_route_id=8,
        street=street,
        building=building,
        company=company,
    )
    assert err is None
    assert detail == ""
    assert matched is loc
