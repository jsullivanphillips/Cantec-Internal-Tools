"""Route-scoped testing site lookup for inspection CSV import fallback."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Literal

from app.db_models import MonthlyRouteLocation, MonthlyTestingSite
from app.monthly.monthly_sites_sync import ensure_monthly_site_for_location, sync_testing_sites_from_legacy
from app.monthly.worksheet_stops import _route_locations

TestingSiteMatchKind = Literal["location", "testing_site_label"]


@dataclass(frozen=True)
class CsvRowTarget:
    location: MonthlyRouteLocation
    testing_site: MonthlyTestingSite | None
    match_kind: TestingSiteMatchKind


def _testing_site_lookup_texts(ts: MonthlyTestingSite) -> list[str]:
    out: list[str] = []
    for raw in (ts.label, ts.building_name):
        text = (raw or "").strip()
        if text:
            out.append(text)
    return out


def load_testing_sites_by_canonical_label(route_id: int) -> dict[str, list[tuple[MonthlyRouteLocation, MonthlyTestingSite]]]:
    """Index testing sites on ``route_id`` by canonical street keys from label/building_name."""
    from app.monthly.route_inspection_csv_import import iter_street_lookup_keys

    idx: dict[str, list[tuple[MonthlyRouteLocation, MonthlyTestingSite]]] = defaultdict(list)
    for loc in _route_locations(route_id):
        ensure_monthly_site_for_location(loc)
        ts_rows = sync_testing_sites_from_legacy(loc)
        if not ts_rows:
            continue
        for ts in ts_rows:
            seen_keys: set[str] = set()
            for text in _testing_site_lookup_texts(ts):
                for key in iter_street_lookup_keys(text):
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)
                    idx[key].append((loc, ts))
    return idx


def lookup_testing_sites_for_sheet_street(
    canonical_index: dict[str, list[tuple[MonthlyRouteLocation, MonthlyTestingSite]]],
    street_line: str,
) -> list[tuple[MonthlyRouteLocation, MonthlyTestingSite]]:
    """Prefer the longest CSV-side key that has testing-site hits."""
    from app.monthly.route_inspection_csv_import import iter_street_lookup_keys

    hits: list[tuple[MonthlyRouteLocation, MonthlyTestingSite]] = []
    seen_pairs: set[tuple[int, int]] = set()
    for key in iter_street_lookup_keys(street_line):
        bucket = canonical_index.get(key)
        if not bucket:
            continue
        for loc, ts in bucket:
            pair = (int(loc.id), int(ts.id))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            hits.append((loc, ts))
        if hits:
            return hits
    return []


def resolve_testing_site_by_sheet_street(
    *,
    at_street: list[tuple[MonthlyRouteLocation, MonthlyTestingSite]],
    street_display: str,
) -> tuple[MonthlyRouteLocation | None, MonthlyTestingSite | None, str | None, str]:
    """Match CSV street to a route-scoped testing site via label/building_name keys."""
    n = len(at_street)
    if n == 0:
        return None, None, "unmatched", "0 testing sites with this canonical street line"
    if n == 1:
        loc, ts = at_street[0]
        return loc, ts, None, ""

    loc_ids = {int(loc.id) for loc, _ in at_street}
    ts_ids = {int(ts.id) for _, ts in at_street}
    if len(loc_ids) == 1 and len(ts_ids) > 1:
        detail = (
            f"{n} testing sites at {street_display!r} under location id={next(iter(loc_ids))}; "
            "narrow with distinct labels"
        )
        return None, None, "testing_site_duplicate", detail

    detail = f"{n} testing sites match {street_display!r} on this route"
    return None, None, "testing_site_ambiguous", detail
