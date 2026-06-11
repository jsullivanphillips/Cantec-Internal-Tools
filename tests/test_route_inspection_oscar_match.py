from __future__ import annotations

from collections import defaultdict
from types import SimpleNamespace

from app.monthly.route_inspection_csv_import import (
    iter_street_index_keys,
    iter_street_lookup_keys,
    resolve_monthly_location_for_csv_row,
)


def _oscar_single_civic_location():
    """Master sheet often stores ``1275 Oscar Street`` while route CSV uses ``1275-1277``."""
    loc = SimpleNamespace(
        id=129,
        address="1275 Oscar Street",
        label="1275-1277 Oscar Street",
        label_normalized="1275-1277 oscar street",
        property_management_company="1275 Oscar Street Holdings Ltd",
        property_management_company_normalized="1275 oscar street holdings ltd",
        building_name=None,
        monthly_route_id=37,
    )
    canonical_index: dict[str, list[object]] = defaultdict(list)
    for key in iter_street_index_keys(loc.address):
        canonical_index[key].append(loc)
    label_index = {loc.label_normalized: [loc]}
    return loc, canonical_index, label_index


def test_oscar_range_sheet_lookup_falls_back_to_leading_civic():
    loc, canonical_index, _ = _oscar_single_civic_location()
    keys = iter_street_lookup_keys("1275-1277 Oscar St")
    assert "1275 oscar street" in keys
    assert canonical_index["1275 oscar street"] == [loc]


def test_oscar_range_sheet_matches_label_with_single_civic_address():
    loc, canonical_index, label_index = _oscar_single_civic_location()
    matched, err, detail = resolve_monthly_location_for_csv_row(
        canonical_index=canonical_index,
        label_index=label_index,
        monthly_route_id=37,
        street="1275-1277 Oscar St",
        building=None,
        company="1275 Oscar Street Holdings Ltd",
    )
    assert err is None, detail
    assert matched is loc


def test_oscar_range_sheet_matches_full_range_address():
    loc = SimpleNamespace(
        id=200,
        address="1275-1277 Oscar Street",
        label="1275-1277 Oscar Street",
        label_normalized="1275-1277 oscar street",
        property_management_company="1275 Oscar Street Holdings Ltd",
        property_management_company_normalized="1275 oscar street holdings ltd",
        building_name=None,
        monthly_route_id=37,
    )
    canonical_index: dict[str, list[object]] = defaultdict(list)
    for key in iter_street_index_keys(loc.address):
        canonical_index[key].append(loc)
    label_index = {loc.label_normalized: [loc]}
    matched, err, detail = resolve_monthly_location_for_csv_row(
        canonical_index=canonical_index,
        label_index=label_index,
        monthly_route_id=37,
        street="1275-1277 Oscar St",
        building=None,
        company="1275 Oscar Street Holdings Ltd",
    )
    assert err is None, detail
    assert matched is loc
