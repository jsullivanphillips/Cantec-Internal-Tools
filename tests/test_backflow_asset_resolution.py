"""Tests for shared backflow asset resolution helpers."""

from __future__ import annotations

from app.scripts.backflow_asset_resolution import (
    BackflowSerialIndexCache,
    build_backflow_create_payload,
    build_backflow_serial_index,
    device_info_for_serial,
    fetch_paginated_locations,
    normalize,
    resolve_backflow_assets,
    unique_assets_by_id,
)


def _asset(asset_id: int, serial: str, *, location_id: int | None = None) -> dict:
    payload = {
        "id": asset_id,
        "type": "backflow",
        "properties": {"serial": serial},
    }
    if location_id is not None:
        payload["locationId"] = location_id
    return payload


def test_normalize_uppercases_serial():
    assert normalize("abc123") == "ABC123"


def test_fetch_paginated_locations_pages_until_short_batch():
    calls: list[dict] = []

    def list_locations_page(params):
        calls.append(dict(params))
        page = params["page"]
        if page == 1:
            return [{"id": 1}]
        if page == 2:
            return [{"id": 2}]
        return []

    locations = fetch_paginated_locations(list_locations_page, limit=1)
    assert [loc["id"] for loc in locations] == [1, 2]
    assert calls[0]["page"] == 1
    assert calls[1]["page"] == 2


def test_build_backflow_serial_index_maps_normalized_serials():
    location_assets = {
        1: [_asset(1, "abc"), {"id": 99, "type": "extinguisher", "properties": {"serial": "SKIP"}}],
        2: [_asset(3, "XYZ")],
    }

    def list_locations_page(params):
        if params["page"] == 1:
            return [{"id": 1}, {"id": 2}]
        return []

    def fetch_location_assets(location_id: int):
        return location_assets[location_id]

    index = build_backflow_serial_index(list_locations_page, fetch_location_assets, limit=2)
    assert set(index.keys()) == {"ABC", "XYZ"}
    assert index["ABC"]["id"] == 1


def test_resolve_local_match_on_second_address_matched_location():
    location_assets = {
        10: [_asset(100, "OTHER")],
        20: [_asset(200, "SN1")],
    }

    def fetch_location_assets(location_id: int):
        return location_assets[location_id]

    result = resolve_backflow_assets(
        ["SN1"],
        [{"id": 10}, {"id": 20}],
        serial_index={},
        fetch_location_assets=fetch_location_assets,
    )

    assert result.still_missing == []
    assert result.resolved["SN1"]["id"] == 200
    assert result.created == []


def test_resolve_global_fallback_when_local_miss():
    def fetch_location_assets(location_id: int):
        if location_id == 99:
            return [_asset(300, "SN2", location_id=99)]
        return []

    cache = BackflowSerialIndexCache(
        lambda params: [{"id": 99}] if params["page"] == 1 else [],
        fetch_location_assets,
    )

    result = resolve_backflow_assets(
        ["SN2"],
        [{"id": 10}],
        serial_index=cache,
        fetch_location_assets=lambda _loc_id: [],
    )

    assert result.resolved["SN2"]["id"] == 300
    assert result.still_missing == []
    assert result.created == []


def test_resolve_does_not_create_when_global_match_found():
    created_payloads: list[dict] = []

    def create_asset(payload):
        created_payloads.append(payload)
        return _asset(999, payload["properties"]["serial"])

    result = resolve_backflow_assets(
        ["SN3"],
        [{"id": 10}],
        serial_index={"SN3": _asset(301, "SN3")},
        fetch_location_assets=lambda _loc_id: [],
        create_missing=True,
        devices={"SN3": {"Model": "M1", "Make": "Make"}},
        create_asset=create_asset,
    )

    assert result.resolved["SN3"]["id"] == 301
    assert created_payloads == []
    assert result.created == []


def test_resolve_creates_on_first_location_when_nowhere_found():
    created: list[dict] = []

    def create_asset(payload):
        asset = _asset(400, payload["properties"]["serial"], location_id=payload["locationId"])
        created.append(payload)
        return asset

    result = resolve_backflow_assets(
        ["SN4"],
        [{"id": 55}, {"id": 66}],
        serial_index={},
        fetch_location_assets=lambda _loc_id: [],
        create_missing=True,
        devices={"sn4": {"Model": "750", "Make": "Watts", "HazardType": "Irrigation"}},
        create_asset=create_asset,
    )

    assert result.still_missing == []
    assert result.resolved["SN4"]["id"] == 400
    assert created[0]["locationId"] == 55


def test_resolve_without_create_leaves_serials_missing():
    result = resolve_backflow_assets(
        ["SN5"],
        [{"id": 10}],
        serial_index={},
        fetch_location_assets=lambda _loc_id: [],
        create_missing=False,
    )

    assert result.resolved == {}
    assert result.still_missing == ["SN5"]


def test_device_info_for_serial_matches_non_normalized_keys():
    devices = {"abc9": {"Model": "750"}}
    assert device_info_for_serial(devices, "ABC9")["Model"] == "750"


def test_build_backflow_create_payload_uses_first_location():
    payload = build_backflow_create_payload(
        77,
        "SN6",
        {"Make": "Watts 750", "Model": "007M1", "FixtureSize": '1/2"', "HazardType": "Irrigation supply"},
    )
    assert payload["locationId"] == 77
    assert payload["type"] == "backflow"
    assert payload["properties"]["serial"] == "SN6"
    assert payload["properties"]["manufacturer"] == "Watts"


def test_unique_assets_by_id_preserves_first_occurrence():
    assets = [_asset(1, "A"), _asset(1, "A"), _asset(2, "B")]
    assert [asset["id"] for asset in unique_assets_by_id(assets)] == [1, 2]


def test_backflow_serial_index_cache_resumes_and_reuses():
    location_calls = 0
    asset_calls = 0

    def list_locations_page(params):
        nonlocal location_calls
        location_calls += 1
        if params["page"] == 1:
            return [{"id": 1}]
        if params["page"] == 2:
            return [{"id": 2}]
        return []

    def fetch_location_assets(location_id: int):
        nonlocal asset_calls
        asset_calls += 1
        if location_id == 1:
            return [_asset(1, "CACHE1", location_id=1)]
        if location_id == 2:
            return [_asset(2, "CACHE2", location_id=2)]
        return []

    cache = BackflowSerialIndexCache(list_locations_page, fetch_location_assets, limit=1)

    first = cache.lookup(["CACHE1"])
    assert first["CACHE1"]["id"] == 1
    assert location_calls == 1
    assert asset_calls == 1

    second = cache.lookup(["CACHE2"])
    assert second["CACHE2"]["id"] == 2
    assert location_calls == 3
    assert asset_calls == 2

    third = cache.lookup(["CACHE1", "CACHE2"])
    assert set(third.keys()) == {"CACHE1", "CACHE2"}
    assert location_calls == 3
    assert asset_calls == 2


def test_resolve_prefers_local_match_over_global_index():
    local_asset = _asset(10, "DUP", location_id=1)
    global_asset = _asset(20, "DUP", location_id=2)

    result = resolve_backflow_assets(
        ["DUP"],
        [{"id": 1}],
        serial_index={"DUP": global_asset},
        fetch_location_assets=lambda _loc_id: [local_asset],
    )

    assert result.resolved["DUP"]["id"] == 10


def test_resolve_ignores_non_backflow_local_assets():
    result = resolve_backflow_assets(
        ["SN7"],
        [{"id": 1}],
        serial_index={},
        fetch_location_assets=lambda _loc_id: [
            {"id": 50, "type": "extinguisher", "properties": {"serial": "SN7"}},
        ],
    )

    assert result.resolved == {}
    assert result.still_missing == ["SN7"]
