"""Shared ServiceTrade backflow asset resolution for CRD email automation."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Callable

_PAGE_LIMIT = 500


def normalize(value: Any) -> str:
    """Safely normalize and uppercase serial numbers or strings."""
    if value is None:
        return ""
    if not isinstance(value, str):
        value = str(value)
    return unicodedata.normalize("NFKC", value).strip().upper()


@dataclass(frozen=True)
class ResolutionResult:
    resolved: dict[str, dict[str, Any]]
    still_missing: list[str]
    created: list[dict[str, Any]]


def _is_backflow_asset(asset: dict[str, Any]) -> bool:
    return (asset.get("type") or "").lower() == "backflow"


def _serial_from_asset(asset: dict[str, Any]) -> str:
    return normalize(asset.get("properties", {}).get("serial", ""))


def fetch_paginated_locations(
    list_locations_page: Callable[[dict[str, Any]], list[dict[str, Any]]],
    *,
    limit: int = _PAGE_LIMIT,
) -> list[dict[str, Any]]:
    """Paginate GET /location and return all active locations."""
    locations: list[dict[str, Any]] = []
    page = 1
    while True:
        params = {"status": "active", "limit": limit, "page": page}
        batch = list_locations_page(params)
        if not isinstance(batch, list):
            break
        for raw in batch:
            if isinstance(raw, dict):
                locations.append(raw)
        if len(batch) < limit:
            break
        page += 1
    return locations


def build_backflow_serial_index(
    list_locations_page: Callable[[dict[str, Any]], list[dict[str, Any]]],
    fetch_location_assets: Callable[[int], list[dict[str, Any]]],
    *,
    limit: int = _PAGE_LIMIT,
) -> dict[str, dict[str, Any]]:
    """
    Build normalized serial -> backflow asset map across all ServiceTrade locations.

    ServiceTrade requires locationId on GET /asset, so assets are fetched per location.
    """
    index: dict[str, dict[str, Any]] = {}
    for loc in fetch_paginated_locations(list_locations_page, limit=limit):
        loc_id = loc.get("id")
        if not loc_id:
            continue
        for asset in fetch_location_assets(int(loc_id)):
            if not _is_backflow_asset(asset):
                continue
            serial = _serial_from_asset(asset)
            if serial and serial not in index:
                index[serial] = asset
    return index


class BackflowSerialIndexCache:
    """
    Incremental per-run cache of backflow assets indexed by normalized serial.

    Scans ServiceTrade locations page-by-page (GET /asset requires locationId).
    Resumes from the last page on subsequent lookups within the same run.
    """

    def __init__(
        self,
        list_locations_page: Callable[[dict[str, Any]], list[dict[str, Any]]],
        fetch_location_assets: Callable[[int], list[dict[str, Any]]],
        *,
        limit: int = _PAGE_LIMIT,
    ) -> None:
        self._list_locations_page = list_locations_page
        self._fetch_location_assets = fetch_location_assets
        self._limit = limit
        self._index: dict[str, dict[str, Any]] = {}
        self._next_page = 1
        self._locations_exhausted = False
        self._scanned_location_ids: set[int] = set()

    def lookup(self, serials: list[str]) -> dict[str, dict[str, Any]]:
        """Find backflow assets for the given serials anywhere in ServiceTrade."""
        wanted = {normalize(serial) for serial in serials if normalize(serial)}
        if not wanted:
            return {}

        found = {serial: self._index[serial] for serial in wanted if serial in self._index}
        missing = wanted - set(found.keys())
        if not missing or self._locations_exhausted:
            return found

        while missing and not self._locations_exhausted:
            locations = self._list_locations_page(
                {"status": "active", "limit": self._limit, "page": self._next_page}
            )
            if not isinstance(locations, list) or not locations:
                self._locations_exhausted = True
                break

            for loc in locations:
                loc_id = loc.get("id")
                if not loc_id:
                    continue
                loc_id_int = int(loc_id)
                if loc_id_int in self._scanned_location_ids:
                    continue
                self._scanned_location_ids.add(loc_id_int)
                for asset in self._fetch_location_assets(loc_id_int):
                    if not _is_backflow_asset(asset):
                        continue
                    serial = _serial_from_asset(asset)
                    if not serial or serial not in missing:
                        continue
                    self._index[serial] = asset
                    found[serial] = asset
                    missing.remove(serial)
                    if not missing:
                        return found

            if len(locations) < self._limit:
                self._locations_exhausted = True
            else:
                self._next_page += 1

        return found


def device_info_for_serial(devices: dict[str, Any], normalized_serial: str) -> dict[str, Any]:
    """Look up parsed device info when Devices keys may not be normalized."""
    for key, info in devices.items():
        if normalize(key) == normalized_serial:
            return info if isinstance(info, dict) else {}
    raw = devices.get(normalized_serial)
    return raw if isinstance(raw, dict) else {}


def build_backflow_create_payload(
    location_id: int,
    serial: str,
    device_info: dict[str, Any],
) -> dict[str, Any]:
    """Build ServiceTrade POST /asset payload for a new backflow device."""
    hazard = device_info.get("HazardType") or ""
    hazard_token = hazard.split()[0] if hazard else ""
    make = device_info.get("Make") or ""
    model = device_info.get("Model") or ""
    return {
        "locationId": location_id,
        "name": f"Backflow {model} ({serial})",
        "type": "backflow",
        "properties": {
            "manufacturer": make.split()[0] if make else "",
            "model": model.split()[0] if model else "",
            "serial": serial,
            "size": " ".join(re.findall(r"[\d/]+", device_info.get("FixtureSize", "") or "")) or None,
            "water_one_hazard": device_info.get("HazardType"),
            "location_in_site": device_info.get("Location"),
            "feed": hazard_token,
            "type": device_info.get("Type"),
            "application": hazard_token,
        },
    }


def asset_location_id(asset: dict[str, Any]) -> int | None:
    """Return the ServiceTrade location id for an asset."""
    raw = asset.get("locationId")
    if raw is not None:
        return int(raw)
    location = asset.get("location")
    if isinstance(location, dict) and location.get("id") is not None:
        return int(location["id"])
    return None


def resolve_backflow_assets(
    wanted_serials: list[str],
    locations: list[dict[str, Any]],
    *,
    serial_index: BackflowSerialIndexCache | dict[str, dict[str, Any]],
    fetch_location_assets: Callable[[int], list[dict[str, Any]]],
    create_missing: bool = False,
    devices: dict[str, Any] | None = None,
    create_asset: Callable[[dict[str, Any]], dict[str, Any] | None] | None = None,
) -> ResolutionResult:
    """
    Resolve email serial numbers to ServiceTrade backflow assets.

    Order: local match on all address-matched locations, global backflow search,
    then optional creation on the first matched location only.
    """
    wanted = [normalize(serial) for serial in wanted_serials if normalize(serial)]
    resolved: dict[str, dict[str, Any]] = {}

    for loc in locations:
        loc_id = loc.get("id")
        if not loc_id:
            continue
        for asset in fetch_location_assets(int(loc_id)):
            if not _is_backflow_asset(asset):
                continue
            serial = _serial_from_asset(asset)
            if serial in wanted and serial not in resolved:
                resolved[serial] = asset

    unresolved = [serial for serial in wanted if serial not in resolved]
    if unresolved:
        if isinstance(serial_index, BackflowSerialIndexCache):
            found = serial_index.lookup(unresolved)
        else:
            found = {
                serial: serial_index[serial]
                for serial in unresolved
                if serial in serial_index
            }
        for serial, asset in found.items():
            resolved[serial] = asset

    created: list[dict[str, Any]] = []
    still_missing = [serial for serial in wanted if serial not in resolved]

    if create_missing and still_missing and locations:
        first_loc = locations[0].get("id")
        if first_loc and create_asset is not None:
            device_map = devices or {}
            for serial in still_missing:
                device_info = device_info_for_serial(device_map, serial)
                if not device_info:
                    print(f" ⚠️ No device info found for serial {serial}")
                    continue
                payload = build_backflow_create_payload(int(first_loc), serial, device_info)
                new_asset = create_asset(payload)
                if new_asset:
                    resolved[serial] = new_asset
                    created.append(new_asset)

    still_missing = [serial for serial in wanted if serial not in resolved]
    return ResolutionResult(resolved=resolved, still_missing=still_missing, created=created)


def unique_assets_by_id(assets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deduplicate assets by ServiceTrade id while preserving order."""
    seen: set[Any] = set()
    unique: list[dict[str, Any]] = []
    for asset in assets:
        asset_id = asset.get("id")
        if asset_id is None or asset_id in seen:
            continue
        seen.add(asset_id)
        unique.append(asset)
    return unique
