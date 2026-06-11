"""Route-scoped flat location lookup for inspection CSV import fallback."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Literal

from app.db_models import MonthlyLocation
from app.monthly.worksheet_locations import _route_locations

LocationMatchKind = Literal["location", "location_label"]


@dataclass(frozen=True)
class CsvRowTarget:
    location: MonthlyLocation
    match_kind: LocationMatchKind


def _location_lookup_texts(loc: MonthlyLocation) -> list[str]:
    out: list[str] = []
    for raw in (loc.label, loc.display_address):
        text = (raw or "").strip()
        if text:
            out.append(text)
    return out


def load_locations_by_canonical_label(route_id: int) -> dict[str, list[MonthlyLocation]]:
    """Index route locations by canonical street keys from ``label`` / ``display_address``."""
    from app.monthly.route_inspection_csv_import import iter_street_lookup_keys

    idx: dict[str, list[MonthlyLocation]] = defaultdict(list)
    for loc in _route_locations(route_id):
        seen_keys: set[str] = set()
        for text in _location_lookup_texts(loc):
            for key in iter_street_lookup_keys(text):
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                idx[key].append(loc)
    return idx


def lookup_locations_for_sheet_street(
    canonical_index: dict[str, list[MonthlyLocation]],
    street_line: str,
) -> list[MonthlyLocation]:
    """Prefer the longest CSV-side key that has route location hits."""
    from app.monthly.route_inspection_csv_import import iter_street_lookup_keys

    hits: list[MonthlyLocation] = []
    seen_ids: set[int] = set()
    for key in iter_street_lookup_keys(street_line):
        bucket = canonical_index.get(key)
        if not bucket:
            continue
        for loc in bucket:
            lid = int(loc.id)
            if lid in seen_ids:
                continue
            seen_ids.add(lid)
            hits.append(loc)
        if hits:
            return hits
    return []


def resolve_location_by_sheet_street(
    *,
    at_street: list[MonthlyLocation],
    street_display: str,
) -> tuple[MonthlyLocation | None, str | None, str]:
    """Match CSV street to a route-scoped location via label/display keys."""
    n = len(at_street)
    if n == 0:
        return None, "unmatched", "0 locations with this canonical street line"
    if n == 1:
        return at_street[0], None, ""

    loc_ids = {int(loc.id) for loc in at_street}
    detail = f"{n} route locations match {street_display!r} on this route (ids={sorted(loc_ids)})"
    return None, "location_ambiguous", detail
