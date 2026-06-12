"""Fetch open ServiceTrade deficiencies for a linked monthly library location."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import requests

from app.db_models import MonthlyLocation
from app.monthly.service_trade_annual_schedule import _authenticate_service_trade
from app.monthly.service_trade_site_match import SERVICE_TRADE_API_BASE

SERVICE_TRADE_DEFICIENCY_APP_BASE = "https://app.servicetrade.com/deficiency/details/id"

CLOSED_DEFICIENCY_STATUSES = frozenset({"fixed", "invalid"})

OFFICE_DEFICIENCY_SERVICE_LINES: dict[str, dict[str, object]] = {
    "alarm_system": {
        "label": "Alarm Systems",
        "service_line_id": 1,
        "asset_types": frozenset({"alarm_device"}),
    },
    "emergency_light": {
        "label": "Emergency Light",
        "service_line_id": 2,
        "asset_types": frozenset({"elight"}),
    },
    "extinguishers": {
        "label": "Extinguishers",
        "service_line_id": 3,
        "asset_types": frozenset({"extinguisher"}),
    },
}

_PAGE_LIMIT = 500


def normalize_office_service_line_key(value: str | None) -> str:
    key = (value or "").strip().lower()
    if key not in OFFICE_DEFICIENCY_SERVICE_LINES:
        raise ValueError("invalid_service_line")
    return key


def office_service_line_service_trade_id(service_line_key: str) -> int:
    key = normalize_office_service_line_key(service_line_key)
    return int(OFFICE_DEFICIENCY_SERVICE_LINES[key]["service_line_id"])


def office_service_line_asset_types(service_line_key: str) -> frozenset[str]:
    key = normalize_office_service_line_key(service_line_key)
    return frozenset(OFFICE_DEFICIENCY_SERVICE_LINES[key]["asset_types"])


def _st_deficiency_description(title: str, description: str | None) -> str:
    """ServiceTrade generates its own title; send only the free-text body."""
    body = (description or "").strip()
    if body:
        return body
    return title.strip()


def _parse_created_deficiency_id(data: object) -> int:
    if not isinstance(data, dict):
        raise RuntimeError("Unexpected ServiceTrade deficiency create response.")
    raw_id = data.get("id")
    if raw_id is None and isinstance(data.get("deficiency"), dict):
        raw_id = data["deficiency"].get("id")
    if raw_id is None:
        raise RuntimeError("ServiceTrade deficiency create response missing id.")
    return int(raw_id)


def _http_error_detail(resp: requests.Response) -> str:
    try:
        payload = resp.json()
        if isinstance(payload, dict):
            for key in ("messages", "message", "error"):
                val = payload.get(key)
                if val:
                    return str(val)
        return resp.text[:800] if resp.text else f"HTTP {resp.status_code}"
    except Exception:
        return resp.text[:800] if resp.text else f"HTTP {resp.status_code}"


def _asset_matches_service_line(asset: dict[str, Any], service_line_key: str) -> bool:
    key = normalize_office_service_line_key(service_line_key)
    cfg = OFFICE_DEFICIENCY_SERVICE_LINES[key]
    asset_type = str(asset.get("type") or "").strip().lower()
    if asset_type in cfg["asset_types"]:
        return True
    sl_id = _safe_get(asset, "serviceLine", "id")
    if sl_id is not None and int(sl_id) == int(cfg["service_line_id"]):
        return True
    return False


def resolve_st_asset_id_for_service_line(
    assets: list[dict[str, Any]],
    service_line_key: str,
) -> int:
    matches = [asset for asset in assets if _asset_matches_service_line(asset, service_line_key)]
    if not matches:
        raise ValueError("no_servicetrade_asset")
    matches.sort(key=lambda asset: (str(asset.get("name") or ""), int(asset.get("id") or 0)))
    return int(matches[0]["id"])


def fetch_st_location_assets(
    http: requests.Session,
    st_location_id: int,
    *,
    limit: int = _PAGE_LIMIT,
) -> list[dict[str, Any]]:
    assets: list[dict[str, Any]] = []
    page = 1
    while True:
        resp = http.get(
            f"{SERVICE_TRADE_API_BASE}/asset",
            params={
                "locationId": int(st_location_id),
                "limit": limit,
                "page": page,
            },
        )
        if not resp.ok:
            raise RuntimeError(
                f"ServiceTrade asset lookup failed ({resp.status_code}): {_http_error_detail(resp)}"
            )
        data = resp.json().get("data") or {}
        batch = data.get("assets") or []
        if not isinstance(batch, list):
            break
        for raw in batch:
            if isinstance(raw, dict):
                assets.append(raw)
        if len(batch) < limit:
            break
        page += 1
    return assets


def create_service_trade_deficiency(
    *,
    st_location_id: int,
    service_line_key: str,
    title: str,
    severity: str,
    description: str | None,
    session: requests.Session | None = None,
    username: str | None = None,
    password: str | None = None,
) -> int:
    """Create a deficiency in ServiceTrade; returns the new deficiency id."""
    user = username or os.getenv("PROCESSING_USERNAME")
    pwd = password or os.getenv("PROCESSING_PASSWORD")
    if not user or not pwd:
        raise RuntimeError("Missing ServiceTrade creds. Set PROCESSING_USERNAME/PROCESSING_PASSWORD.")

    sev = (severity or "").strip().lower() or "deficient"

    http = session or requests.Session()
    _authenticate_service_trade(http, username=user, password=pwd)

    assets = fetch_st_location_assets(http, int(st_location_id))
    asset_id = resolve_st_asset_id_for_service_line(assets, service_line_key)

    resp = http.post(
        f"{SERVICE_TRADE_API_BASE}/deficiency",
        json={
            "assetId": int(asset_id),
            "severity": sev,
            "description": _st_deficiency_description(title, description),
        },
    )
    if not resp.ok:
        raise RuntimeError(
            f"ServiceTrade deficiency create failed ({resp.status_code}): {_http_error_detail(resp)}"
        )
    payload = resp.json()
    data = payload.get("data") if isinstance(payload, dict) else None
    return _parse_created_deficiency_id(data)


def _safe_get(d: dict[str, Any] | None, *keys: str) -> Any:
    current: Any = d
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
        if current is None:
            return None
    return current


def _location_display_label(loc: MonthlyLocation) -> str:
    text = (loc.display_address or loc.address or "").strip()
    if text:
        return text
    return f"Location {int(loc.id)}"


def _reported_on_iso(raw: dict[str, Any]) -> str | None:
    reported_on = raw.get("reportedOn")
    if reported_on is None:
        return None
    try:
        ts = int(reported_on)
    except (TypeError, ValueError):
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _is_open_deficiency(raw: dict[str, Any]) -> bool:
    status = str(raw.get("status") or "").strip().lower()
    return status not in CLOSED_DEFICIENCY_STATUSES


def serialize_service_trade_deficiency(raw: dict[str, Any]) -> dict[str, object]:
    deficiency_id = raw.get("id")
    if deficiency_id is None:
        raise ValueError("missing_deficiency_id")
    def_id = int(deficiency_id)
    return {
        "deficiency_id": def_id,
        "status": str(raw.get("status") or "").strip() or None,
        "severity": str(raw.get("severity") or "").strip() or None,
        "description": str(raw.get("description") or "").strip() or None,
        "reported_on": _reported_on_iso(raw),
        "service_line": str(_safe_get(raw, "serviceLine", "name") or "").strip() or None,
        "url": f"{SERVICE_TRADE_DEFICIENCY_APP_BASE}/{def_id}",
    }


def fetch_service_trade_deficiencies_for_location(
    st_location_id: int,
    *,
    session: requests.Session | None = None,
    username: str | None = None,
    password: str | None = None,
) -> list[dict[str, object]]:
    """Return open ServiceTrade deficiencies for one building location id."""
    user = username or os.getenv("PROCESSING_USERNAME")
    pwd = password or os.getenv("PROCESSING_PASSWORD")
    if not user or not pwd:
        raise RuntimeError("Missing ServiceTrade creds. Set PROCESSING_USERNAME/PROCESSING_PASSWORD.")

    http = session or requests.Session()
    _authenticate_service_trade(http, username=user, password=pwd)

    open_rows: list[dict[str, Any]] = []
    page = 1
    while True:
        resp = http.get(
            f"{SERVICE_TRADE_API_BASE}/deficiency",
            params={
                "locationId": int(st_location_id),
                "limit": _PAGE_LIMIT,
                "page": page,
            },
        )
        resp.raise_for_status()
        data = resp.json().get("data") or {}
        batch = data.get("deficiencies") or []
        if not isinstance(batch, list):
            break
        for raw in batch:
            if isinstance(raw, dict) and _is_open_deficiency(raw):
                open_rows.append(raw)
        if len(batch) < _PAGE_LIMIT:
            break
        page += 1

    open_rows.sort(
        key=lambda row: int(row.get("reportedOn") or 0),
        reverse=True,
    )
    return [serialize_service_trade_deficiency(row) for row in open_rows]


def build_location_service_trade_deficiencies_payload(
    location_id: int,
    *,
    session: requests.Session | None = None,
    username: str | None = None,
    password: str | None = None,
) -> dict[str, object]:
    loc = MonthlyLocation.query.filter_by(id=int(location_id)).one_or_none()
    if loc is None:
        raise LookupError("location_not_found")

    st_site_id = loc.service_trade_site_location_id
    if st_site_id is None:
        raise ValueError("no_servicetrade_link")

    deficiencies = fetch_service_trade_deficiencies_for_location(
        int(st_site_id),
        session=session,
        username=username,
        password=password,
    )
    return {
        "location_id": int(loc.id),
        "location_label": _location_display_label(loc),
        "service_trade_site_location_id": int(st_site_id),
        "deficiencies": deficiencies,
    }
