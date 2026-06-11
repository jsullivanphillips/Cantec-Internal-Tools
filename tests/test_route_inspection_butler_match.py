from __future__ import annotations

from collections import defaultdict
from types import SimpleNamespace

from app.monthly.route_inspection_csv_import import (
    canonical_street_address_key,
    iter_street_index_keys,
    iter_street_lookup_keys,
    resolve_monthly_location_for_csv_row,
)


def _butler_location():
    loc = SimpleNamespace(
        id=484,
        address="6649 Butler Cresecent",
        label="6649 Butler Cresecent",
        label_normalized="6649 butler cresecent",
        property_management_company="TPM Properties",
        property_management_company_normalized="tpm properties",
        building_name="Butler Building",
        monthly_route_id=36,
    )
    canonical_index: dict[str, list[object]] = defaultdict(list)
    for key in iter_street_index_keys(loc.address):
        canonical_index[key].append(loc)
    label_index = {loc.label_normalized: [loc]}
    return loc, canonical_index, label_index


def test_butler_cresecent_typo_matches_sheet_crescent():
    assert canonical_street_address_key("6649 Butler Cresecent") == canonical_street_address_key(
        "6649 Butler Crescent"
    )
    assert iter_street_lookup_keys("6649 Butler Crescent")[0] in iter_street_index_keys(
        "6649 Butler Cresecent"
    )


def test_butler_sheet_row_matches_despite_pmc_shorthand():
    loc, canonical_index, label_index = _butler_location()
    matched, err, detail = resolve_monthly_location_for_csv_row(
        canonical_index=canonical_index,
        label_index=label_index,
        monthly_route_id=36,
        street="6649 Butler Crescent",
        building="Butler Building",
        company="TPM",
    )
    assert err is None, detail
    assert matched is loc
