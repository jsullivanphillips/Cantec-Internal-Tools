"""Match monthly library locations to ServiceTrade building locations."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any, Protocol

import requests

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
SERVICE_TRADE_APP_LOCATIONS_BASE = os.getenv(
    "SERVICE_TRADE_APP_LOCATIONS_BASE",
    "https://app.servicetrade.com/locations",
)

_STREET_TYPE_SUFFIXES = frozenset({
    "ST",
    "STREET",
    "STR",
    "AVE",
    "AVENUE",
    "AV",
    "BLVD",
    "BOULEVARD",
    "RD",
    "ROAD",
    "DR",
    "DRIVE",
    "LN",
    "LANE",
    "CT",
    "COURT",
    "PL",
    "PLACE",
    "CRES",
    "CRESCENT",
    "WAY",
    "HWY",
    "HIGHWAY",
    "PKWY",
    "PARKWAY",
    "SQ",
    "SQUARE",
    "TRAIL",
    "TERR",
    "TERRACE",
})

_SAINT_PREFIXES = frozenset({"ST", "SAINT", "ST."})

_STREET_SUFFIX_CANONICAL = {
    "ST": "ST",
    "STREET": "ST",
    "STR": "ST",
    "AVE": "AVE",
    "AVENUE": "AVE",
    "AV": "AVE",
    "BLVD": "BLVD",
    "BOULEVARD": "BLVD",
    "RD": "RD",
    "ROAD": "RD",
    "DR": "DR",
    "DRIVE": "DR",
    "LN": "LN",
    "LANE": "LN",
    "CT": "CT",
    "COURT": "CT",
    "PL": "PL",
    "PLACE": "PL",
    "CRES": "CRES",
    "CRESCENT": "CRES",
    "WAY": "WAY",
    "HWY": "HWY",
    "HIGHWAY": "HWY",
    "PKWY": "PKWY",
    "PARKWAY": "PKWY",
    "SQ": "SQ",
    "SQUARE": "SQ",
    "TRAIL": "TRAIL",
    "TERR": "TERR",
    "TERRACE": "TERR",
}

_DIRECTIONAL_CANONICAL = {
    "N": "NORTH",
    "S": "SOUTH",
    "E": "EAST",
    "W": "WEST",
    "NE": "NORTHEAST",
    "NW": "NORTHWEST",
    "SE": "SOUTHEAST",
    "SW": "SOUTHWEST",
    "NORTH": "NORTH",
    "SOUTH": "SOUTH",
    "EAST": "EAST",
    "WEST": "WEST",
    "NORTHEAST": "NORTHEAST",
    "NORTHWEST": "NORTHWEST",
    "SOUTHEAST": "SOUTHEAST",
    "SOUTHWEST": "SOUTHWEST",
}

_CIVIC_TOKEN_RE = re.compile(
    r"^(\d{1,7})([A-Z])?(?:-(\d{1,7})([A-Z])?)?$",
    re.IGNORECASE,
)
_MAX_EXPANDED_CIVIC_RANGE = 24


def _expand_civic_range(start: str, end: str) -> list[str]:
    start_i = int(start)
    end_i = int(end)
    if end_i < start_i:
        start_i, end_i = end_i, start_i
    if end_i - start_i > _MAX_EXPANDED_CIVIC_RANGE:
        return [start, end]
    return [str(value) for value in range(start_i, end_i + 1)]


def _preprocess_address_line(address: str | None) -> str:
    if not address:
        return ""
    text = address.strip()
    if not text:
        return ""
    if "," in text:
        text = text.split(",", 1)[0].strip()
    text = re.sub(r'\s*-\s*building\b.*$', "", text, flags=re.IGNORECASE)
    text = re.sub(r"(\d)\s+-\s+(\d)", r"\1-\2", text)
    text = re.sub(r"(\d+)\s*&\s*(\d+)", r"\1-\2", text)
    text = re.sub(r"(\d+)\s*/\s*(\d+)", r"\1-\2", text)
    return text.strip()


def _street_line_for_match(address: str | None) -> str:
    text = _preprocess_address_line(address)
    if not text:
        return ""
    text = text.replace(".", " ")
    text = re.sub(r"(?<!\d)-(?!\d)", " ", text)
    text = re.sub(r"[^\w\s'-]", " ", text)
    return re.sub(r"\s+", " ", text).strip().upper()


def _parse_civic_token(token: str) -> tuple[str, tuple[str, ...]] | None:
    match = _CIVIC_TOKEN_RE.match(token.upper())
    if match is None:
        return None
    base = match.group(1)
    letter = (match.group(2) or "").upper()
    end = match.group(3)
    end_letter = (match.group(4) or "").upper()
    numbers: list[str] = [base]
    if letter:
        numbers.append(f"{base}{letter}")
    if end:
        numbers.extend(_expand_civic_range(base, end))
        if end_letter:
            numbers.append(f"{end}{end_letter}")
    deduped = tuple(dict.fromkeys(numbers))
    return base, deduped


def _canonicalize_name_tokens(name_tokens: list[str]) -> list[str]:
    return [_DIRECTIONAL_CANONICAL.get(token, token) for token in name_tokens]


def _parse_street_address(
    address: str | None,
) -> tuple[str, tuple[str, ...], list[str], str | None] | None:
    line = _street_line_for_match(address)
    if not line:
        return None
    tokens = line.split()
    if not tokens:
        return None

    civic = _parse_civic_token(tokens[0])
    if civic is None:
        return None
    primary_number, all_numbers = civic

    name_tokens = list(tokens[1:])
    while name_tokens and name_tokens[0] in _SAINT_PREFIXES:
        name_tokens.pop(0)

    canonical_suffix: str | None = None
    if name_tokens and name_tokens[-1] in _STREET_TYPE_SUFFIXES:
        raw_suffix = name_tokens.pop()
        canonical_suffix = _STREET_SUFFIX_CANONICAL.get(raw_suffix, raw_suffix)

    name_tokens = [token for token in name_tokens if token not in _STREET_TYPE_SUFFIXES]
    name_tokens = _canonicalize_name_tokens(name_tokens)
    if not name_tokens and canonical_suffix is None:
        return None
    return primary_number, all_numbers, name_tokens, canonical_suffix


def _format_compare_text(
    number: str,
    name_tokens: list[str],
    canonical_suffix: str | None,
) -> str:
    parts = [number, *name_tokens]
    if canonical_suffix:
        parts.append(canonical_suffix)
    return " ".join(parts)


def _format_match_key(number: str, name_tokens: list[str]) -> str | None:
    if not name_tokens:
        return None
    key_tokens = name_tokens[:2] if len(name_tokens) > 2 else name_tokens
    return f"{number} {' '.join(key_tokens)}"


def _lookup_keys_for_address(address: str | None) -> set[str]:
    parsed = _parse_street_address(address)
    if parsed is None:
        return set()
    _primary_number, all_numbers, name_tokens, canonical_suffix = parsed
    keys: set[str] = set()
    for number in all_numbers:
        match_key = _format_match_key(number, name_tokens)
        if match_key:
            keys.add(match_key)
        keys.add(_format_compare_text(number, name_tokens, canonical_suffix))
    return keys


def normalize_street_compare_text(address: str | None) -> str | None:
    """Canonical street text for equivalence checks (``1005 CHARLES ST``)."""
    parsed = _parse_street_address(address)
    if parsed is None:
        return None
    primary_number, _all_numbers, name_tokens, canonical_suffix = parsed
    return _format_compare_text(primary_number, name_tokens, canonical_suffix)


def normalize_street_match_key(address: str | None) -> str | None:
    """Extract a match key from a street address.

    Uses the street number plus the first one or two significant name tokens so
    ``1005 St. Charles Street`` and ``1005 St Charles St`` both become ``1005 CHARLES``.
    """
    parsed = _parse_street_address(address)
    if parsed is None:
        return None
    primary_number, _all_numbers, name_tokens, _canonical_suffix = parsed
    return _format_match_key(primary_number, name_tokens)


class MonthlyLocationLike(Protocol):
    id: int
    address: str
    display_address: str | None
    label: str
    property_management_company: str | None
    status_normalized: str
    service_trade_site_location_id: int | None
    monthly_route_id: int | None


@dataclass(frozen=True)
class ServiceTradeLocationCandidate:
    location_id: int
    name: str
    street: str
    street_key: str


@dataclass(frozen=True)
class ProposedSiteMatch:
    monthly_location_id: int
    service_trade_location_id: int
    monthly_label: str
    monthly_address: str
    service_trade_name: str
    service_trade_street: str
    street_key: str


@dataclass(frozen=True)
class UnmatchedMonthlyLocation:
    monthly_location_id: int
    label: str
    address: str
    property_management_company: str | None
    monthly_route_id: int | None
    status_normalized: str
    reason: str
    street_key: str | None = None
    candidate_count: int = 0


@dataclass(frozen=True)
class SiteMatchConflict:
    kind: str
    message: str
    monthly_location_id: int | None = None
    service_trade_location_id: int | None = None
    street_key: str | None = None


@dataclass
class MonthlySiteMatchResult:
    proposed: list[ProposedSiteMatch] = field(default_factory=list)
    unmatched: list[UnmatchedMonthlyLocation] = field(default_factory=list)
    conflicts: list[SiteMatchConflict] = field(default_factory=list)
    skipped_already_linked: int = 0
    skipped_inactive: int = 0


def is_active_monthly_location_status(status_normalized: str | None) -> bool:
    """Only ``active`` library rows participate in auto-match and unmatched reporting."""
    return (status_normalized or "").strip().lower() == "active"


def _dedupe_candidates_by_compare_text(
    candidates: list[ServiceTradeLocationCandidate],
) -> list[ServiceTradeLocationCandidate]:
    deduped: dict[str, ServiceTradeLocationCandidate] = {}
    for candidate in candidates:
        compare_text = normalize_street_compare_text(candidate.street)
        if not compare_text:
            continue
        existing = deduped.get(compare_text)
        if existing is None or candidate.location_id < existing.location_id:
            deduped[compare_text] = candidate
    return sorted(deduped.values(), key=lambda item: item.location_id)


def _narrow_candidates_for_monthly_address(
    address: str | None,
    display_address: str | None,
    candidates: list[ServiceTradeLocationCandidate],
) -> list[ServiceTradeLocationCandidate]:
    narrowed = _dedupe_candidates_by_compare_text(candidates)
    if len(narrowed) <= 1:
        return narrowed

    monthly_texts = {
        text
        for text in (
            normalize_street_compare_text(address),
            normalize_street_compare_text(display_address),
        )
        if text
    }
    if not monthly_texts:
        return narrowed

    exact = [
        candidate
        for candidate in narrowed
        if normalize_street_compare_text(candidate.street) in monthly_texts
    ]
    return exact if len(exact) == 1 else narrowed


def monthly_location_street_key(
    address: str | None,
    display_address: str | None = None,
) -> str | None:
    return normalize_street_match_key(address) or normalize_street_match_key(display_address)


def service_trade_site_location_url(service_trade_location_id: int) -> str:
    return f"{SERVICE_TRADE_APP_LOCATIONS_BASE}/{int(service_trade_location_id)}"


def _service_trade_street(location: dict[str, Any]) -> str:
    address = location.get("address") or {}
    if isinstance(address, dict):
        return str(address.get("street") or "").strip()
    return str(address or "").strip()


def service_trade_location_candidate(location: dict[str, Any]) -> ServiceTradeLocationCandidate | None:
    location_id = location.get("id")
    if location_id is None:
        return None
    street = _service_trade_street(location)
    street_key = normalize_street_match_key(street)
    if street_key is None:
        return None
    name = str(location.get("name") or "").strip()
    return ServiceTradeLocationCandidate(
        location_id=int(location_id),
        name=name,
        street=street,
        street_key=street_key,
    )


def build_street_index(
    service_trade_locations: list[dict[str, Any]],
) -> dict[str, list[ServiceTradeLocationCandidate]]:
    index: dict[str, list[ServiceTradeLocationCandidate]] = {}
    for raw in service_trade_locations:
        candidate = service_trade_location_candidate(raw)
        if candidate is None:
            continue
        index_keys = _lookup_keys_for_address(candidate.street)
        index_keys.add(candidate.street_key)
        for key in index_keys:
            index.setdefault(key, []).append(candidate)
    for key in index:
        index[key].sort(key=lambda item: item.location_id)
    return index


def _lookup_street_candidates(
    address: str | None,
    display_address: str | None,
    street_index: dict[str, list[ServiceTradeLocationCandidate]],
) -> tuple[str | None, list[ServiceTradeLocationCandidate]]:
    lookup_keys: set[str] = set()
    street_key = monthly_location_street_key(address, display_address)
    for raw in (address, display_address):
        lookup_keys.update(_lookup_keys_for_address(raw))

    if not lookup_keys:
        return street_key, []

    merged: list[ServiceTradeLocationCandidate] = []
    seen_ids: set[int] = set()
    for key in lookup_keys:
        for candidate in street_index.get(key, []):
            cid = int(candidate.location_id)
            if cid in seen_ids:
                continue
            seen_ids.add(cid)
            merged.append(candidate)
    return street_key, merged


def propose_monthly_site_matches(
    monthly_locations: list[MonthlyLocationLike],
    street_index: dict[str, list[ServiceTradeLocationCandidate]],
) -> MonthlySiteMatchResult:
    """Propose high-confidence links for monthly rows without an existing ST site id."""
    result = MonthlySiteMatchResult()

    for loc in monthly_locations:
        existing_id = loc.service_trade_site_location_id
        if existing_id is not None:
            result.skipped_already_linked += 1
            continue

        status = (loc.status_normalized or "").strip().lower()
        if not is_active_monthly_location_status(status):
            result.skipped_inactive += 1
            continue

        street_key = monthly_location_street_key(loc.address, loc.display_address)
        if street_key is None and normalize_street_compare_text(loc.address) is None:
            result.unmatched.append(
                UnmatchedMonthlyLocation(
                    monthly_location_id=int(loc.id),
                    label=(loc.label or "").strip(),
                    address=(loc.address or "").strip(),
                    property_management_company=(loc.property_management_company or None),
                    monthly_route_id=int(loc.monthly_route_id) if loc.monthly_route_id is not None else None,
                    status_normalized=status or "active",
                    reason="no_parseable_street_key",
                )
            )
            continue

        street_key, candidates = _lookup_street_candidates(
            loc.address,
            loc.display_address,
            street_index,
        )
        candidates = _narrow_candidates_for_monthly_address(
            loc.address,
            loc.display_address,
            candidates,
        )
        if len(candidates) == 0:
            result.unmatched.append(
                UnmatchedMonthlyLocation(
                    monthly_location_id=int(loc.id),
                    label=(loc.label or "").strip(),
                    address=(loc.address or "").strip(),
                    property_management_company=(loc.property_management_company or None),
                    monthly_route_id=int(loc.monthly_route_id) if loc.monthly_route_id is not None else None,
                    status_normalized=status or "active",
                    reason="no_service_trade_candidate",
                    street_key=street_key,
                    candidate_count=0,
                )
            )
            continue

        if len(candidates) > 1:
            result.unmatched.append(
                UnmatchedMonthlyLocation(
                    monthly_location_id=int(loc.id),
                    label=(loc.label or "").strip(),
                    address=(loc.address or "").strip(),
                    property_management_company=(loc.property_management_company or None),
                    monthly_route_id=int(loc.monthly_route_id) if loc.monthly_route_id is not None else None,
                    status_normalized=status or "active",
                    reason="multiple_service_trade_candidates",
                    street_key=street_key,
                    candidate_count=len(candidates),
                )
            )
            continue

        candidate = candidates[0]
        st_id = int(candidate.location_id)
        result.proposed.append(
            ProposedSiteMatch(
                monthly_location_id=int(loc.id),
                service_trade_location_id=st_id,
                monthly_label=(loc.label or "").strip(),
                monthly_address=(loc.address or "").strip(),
                service_trade_name=candidate.name,
                service_trade_street=candidate.street,
                street_key=street_key or normalize_street_compare_text(loc.address) or "",
            )
        )

    return result


def fetch_active_service_trade_locations(
    *,
    username: str | None = None,
    password: str | None = None,
    session: requests.Session | None = None,
    limit: int = 2000,
) -> list[dict[str, Any]]:
    """Fetch all active ServiceTrade locations (paginated)."""
    user = username or os.getenv("PROCESSING_USERNAME")
    pwd = password or os.getenv("PROCESSING_PASSWORD")
    if not user or not pwd:
        raise RuntimeError("Missing ServiceTrade creds. Set PROCESSING_USERNAME/PROCESSING_PASSWORD.")

    http = session or requests.Session()
    http.headers.setdefault("Accept", "application/json")
    auth_resp = http.post(
        f"{SERVICE_TRADE_API_BASE}/auth",
        json={"username": user, "password": pwd},
    )
    auth_resp.raise_for_status()

    all_locations: list[dict[str, Any]] = []
    page = 1
    params = {"status": "active", "limit": limit}
    while True:
        paged_params = dict(params)
        paged_params["page"] = page
        resp = http.get(f"{SERVICE_TRADE_API_BASE}/location", params=paged_params)
        resp.raise_for_status()
        payload = resp.json()
        data = payload.get("data") or {}
        locations = data.get("locations") or []
        if not locations:
            break
        all_locations.extend(locations)
        if len(locations) < limit:
            break
        page += 1
    return all_locations


def verify_service_trade_location_exists(
    service_trade_location_id: int,
    *,
    username: str | None = None,
    password: str | None = None,
    session: requests.Session | None = None,
) -> bool:
    """Return True when ``GET /location/{id}`` succeeds."""
    user = username or os.getenv("PROCESSING_USERNAME")
    pwd = password or os.getenv("PROCESSING_PASSWORD")
    if not user or not pwd:
        raise RuntimeError("Missing ServiceTrade creds. Set PROCESSING_USERNAME/PROCESSING_PASSWORD.")

    http = session or requests.Session()
    http.headers.setdefault("Accept", "application/json")
    auth_resp = http.post(
        f"{SERVICE_TRADE_API_BASE}/auth",
        json={"username": user, "password": pwd},
    )
    auth_resp.raise_for_status()
    resp = http.get(f"{SERVICE_TRADE_API_BASE}/location/{int(service_trade_location_id)}")
    if resp.status_code == 404:
        return False
    resp.raise_for_status()
    return True
