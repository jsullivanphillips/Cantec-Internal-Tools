from __future__ import annotations

from collections import defaultdict
from types import SimpleNamespace

from app.monthly.route_inspection_csv_import import (
    _iter_label_lookup_keys,
    iter_street_index_keys,
    parse_address_block,
    resolve_monthly_location_for_csv_row,
)


def _richmond_gate_location(*, address: str = "1696 Pear Street"):
    loc = SimpleNamespace(
        id=501,
        address=address,
        label="3610 + 3614 Richmond & 1696 Pear Street",
        label_normalized="3610 + 3614 richmond & 1696 pear street",
        property_management_company="Firm Management",
        property_management_company_normalized="firm management",
        building_name="Richmond Gate",
        monthly_route_id=12,
    )
    canonical_index: dict[str, list[object]] = defaultdict(list)
    keys_added: set[str] = set()
    for source in (loc.address, loc.label):
        for key in iter_street_index_keys(source):
            if key in keys_added:
                continue
            keys_added.add(key)
            canonical_index[key].append(loc)
    label_index: dict[str, list[object]] = defaultdict(list)
    for key in _iter_label_lookup_keys(loc.label_normalized):
        label_index[key].append(loc)
    return loc, canonical_index, label_index


def test_label_lookup_keys_strip_trailing_street_on_ampersand_corner():
    keys = _iter_label_lookup_keys("3610 + 3614 richmond & 1696 pear street")
    assert keys[0] == "3610 + 3614 richmond & 1696 pear street"
    assert "3610 + 3614 richmond & 1696 pear" in keys


def test_richmond_gate_sheet_matches_label_without_street_suffix():
    loc, canonical_index, label_index = _richmond_gate_location()
    block = """3610 + 3614 Richmond & 1696 Pear
Name: Richmond Gate
Management: Firm Manag."""
    street, building, company = parse_address_block(block)
    matched, err, detail = resolve_monthly_location_for_csv_row(
        canonical_index=canonical_index,
        label_index=label_index,
        monthly_route_id=12,
        street=street,
        building=building,
        company=company,
    )
    assert err is None, detail
    assert matched is loc


def test_richmond_gate_street_fallback_when_address_is_single_civic():
    loc, canonical_index, label_index = _richmond_gate_location(address="1696 Pear Street")
    block = """3610 + 3614 Richmond & 1696 Pear
Name: Richmond Gate
Management: Firm Management"""
    street, building, company = parse_address_block(block)
    matched, err, detail = resolve_monthly_location_for_csv_row(
        canonical_index=canonical_index,
        label_index=label_index,
        monthly_route_id=12,
        street=street,
        building=building,
        company=company,
    )
    assert err is None, detail
    assert matched is loc
