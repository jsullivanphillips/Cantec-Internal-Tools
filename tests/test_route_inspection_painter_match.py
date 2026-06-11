from __future__ import annotations

from collections import defaultdict
from types import SimpleNamespace

from app.monthly.route_inspection_csv_import import (
    iter_street_index_keys,
    resolve_monthly_location_for_csv_row,
)


def _painter_locations():
    loc_a = SimpleNamespace(
        id=372,
        address="3319A Painter Road",
        label="3319A Painter Road",
        label_normalized="3319a painter road",
        property_management_company="Pemberton Holmes",
        property_management_company_normalized="pemberton holmes",
        building_name=None,
        monthly_route_id=24,
    )
    loc_b = SimpleNamespace(
        id=373,
        address="3319B Painter Road",
        label="3319B Painter Road",
        label_normalized="3319b painter road",
        property_management_company="Pemberton Holmes",
        property_management_company_normalized="pemberton holmes",
        building_name=None,
        monthly_route_id=24,
    )
    canonical_index: dict[str, list[object]] = defaultdict(list)
    for loc in (loc_a, loc_b):
        for key in iter_street_index_keys(loc.address):
            canonical_index[key].append(loc)
    label_index = {
        "3319a painter road": [loc_a],
        "3319b painter road": [loc_b],
    }
    return loc_a, loc_b, canonical_index, label_index


def test_painter_index_keeps_a_and_b_separate():
    loc_a, loc_b, canonical_index, _ = _painter_locations()
    assert canonical_index["3319a painter road"] == [loc_a]
    assert canonical_index["3319b painter road"] == [loc_b]
    assert "3319 painter road" not in canonical_index


def test_painter_sheet_rows_match_correct_building():
    loc_a, loc_b, canonical_index, label_index = _painter_locations()
    for expected, street in (
        (loc_a, "3319A Painter Rd"),
        (loc_b, "3319B Painter Rd"),
    ):
        matched, err, detail = resolve_monthly_location_for_csv_row(
            canonical_index=canonical_index,
            label_index=label_index,
            monthly_route_id=24,
            street=street,
            building="Fairwest Construction",
            company="Pemberton - Res",
        )
        assert err is None, detail
        assert matched is expected
