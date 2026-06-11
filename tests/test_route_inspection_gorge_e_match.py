from __future__ import annotations

from collections import defaultdict
from types import SimpleNamespace

from app.monthly.route_inspection_csv_import import (
    canonical_street_address_key,
    iter_street_index_keys,
    iter_street_lookup_keys,
    resolve_monthly_location_for_csv_row,
)


def _gorge_e_location():
    loc = SimpleNamespace(
        id=130,
        address="129 Gorge Road E",
        label="129 Gorge Road E",
        label_normalized="129 gorge road e",
        property_management_company="Belmont Properties",
        property_management_company_normalized="belmont properties",
        building_name=None,
        monthly_route_id=46,
    )
    canonical_index: dict[str, list[object]] = defaultdict(list)
    for key in iter_street_index_keys(loc.address):
        canonical_index[key].append(loc)
    label_index = {loc.label_normalized: [loc]}
    return loc, canonical_index, label_index


def test_gorge_road_east_matches_abbreviated_e():
    assert canonical_street_address_key("129 Gorge Road East") == canonical_street_address_key(
        "129 Gorge Road E"
    )
    assert iter_street_lookup_keys("129 Gorge Road East")[0] in iter_street_index_keys(
        "129 Gorge Road E"
    )


def test_gorge_road_east_sheet_matches_library_label():
    loc, canonical_index, label_index = _gorge_e_location()
    matched, err, detail = resolve_monthly_location_for_csv_row(
        canonical_index=canonical_index,
        label_index=label_index,
        monthly_route_id=46,
        street="129 Gorge Road East",
        building=None,
        company="Belmont Properties",
    )
    assert err is None, detail
    assert matched is loc
