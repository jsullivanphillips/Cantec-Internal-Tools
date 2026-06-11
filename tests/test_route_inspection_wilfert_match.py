from __future__ import annotations

from collections import defaultdict
from types import SimpleNamespace

from app.monthly.route_inspection_csv_import import (
    iter_street_index_keys,
    iter_street_lookup_keys,
    parse_address_block,
    resolve_monthly_location_for_csv_row,
)


def _wilfert_locations():
    locs = {}
    for letter in "ABC":
        locs[letter] = SimpleNamespace(
            id=ord(letter),
            address="2676 Wilfert Road, Victoria, British Columbia V9B 5Z3, Canada",
            label=f"2676 Wilfert Road - Building {letter}",
            label_normalized=f"2676 wilfert road - building {letter.lower()}",
            property_management_company="Mainline Living Property Management",
            property_management_company_normalized="mainline living property management",
            building_name=None,
            monthly_route_id=24,
        )
    canonical_index: dict[str, list[object]] = defaultdict(list)
    for loc in locs.values():
        for key in iter_street_index_keys(loc.address):
            canonical_index[key].append(loc)
    label_index = {loc.label_normalized: [loc] for loc in locs.values()}
    return locs, canonical_index, label_index


def test_wilfert_hyphen_civic_lookup_finds_shared_street():
    _, canonical_index, _ = _wilfert_locations()
    keys = iter_street_lookup_keys("2676-C Wilfert Road")
    assert "2676 wilfert road" in keys
    assert len(canonical_index["2676 wilfert road"]) == 3


def test_wilfert_buildings_a_b_c_match_separately():
    locs, canonical_index, label_index = _wilfert_locations()
    blocks = {
        "A": """2676-A Wilfert Road
Name: Marakai "East" (Building "A")
Management: Mainline Living Property Management""",
        "B": """2676-B Wilfert Road
Name: Marakai "South" (Building "B")
Management: Mainline Living Property Management""",
        "C": """2676-C Wilfert Road
Name: Marakai "North & West" (Building "C")
Management: Mainline Living Property Management""",
    }
    for letter, block in blocks.items():
        street, building, company = parse_address_block(block)
        matched, err, detail = resolve_monthly_location_for_csv_row(
            canonical_index=canonical_index,
            label_index=label_index,
            monthly_route_id=24,
            street=street,
            building=building,
            company=company,
        )
        assert err is None, detail
        assert matched is locs[letter]
