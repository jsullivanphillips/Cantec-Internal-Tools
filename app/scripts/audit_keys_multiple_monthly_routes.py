"""
Read-only audit: do any ``keys`` rows tie (via barcode / keycode) to ``MonthlyRouteLocation``
rows that sit on **more than one** ``monthly_route_id``?

Usage (repo root, DATABASE_URL set):

    python -m app.scripts.audit_keys_multiple_monthly_routes
    python -m app.scripts.audit_keys_multiple_monthly_routes --limit 50

Does not modify data.
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict

from app import create_app
from app.db_models import Key, MonthlyRoute, MonthlyRouteLocation
from app.monthly.monthly_keys_keycode import (
    canonical_keycode_from_monthly_keys_field,
    monthly_keys_field_indicates_no_key,
)


def _norm_space(value: str | None) -> str:
    return " ".join((value or "").strip().split())


def _norm_keycode_cf(value: str | None) -> str:
    return _norm_space(value).casefold()


def _monthly_keys_canonical_cf(raw: str | None) -> str:
    return _norm_keycode_cf(canonical_keycode_from_monthly_keys_field(raw))


def _barcode_int(barcode: str | None) -> int | None:
    text = _norm_space(barcode)
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def _route_label(route: MonthlyRoute | None, route_id: int | None) -> str:
    if route_id is None:
        return "(no monthly_route_id)"
    if route is None:
        return f"id={route_id}"
    return f"R{route.route_number} ({route.weekday_iso}/{route.week_occurrence}) id={route.id}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit keys vs multiple monthly routes.")
    parser.add_argument("--limit", type=int, default=40, help="Max violations to print in detail.")
    args = parser.parse_args(argv)

    app = create_app()
    with app.app_context():
        locations = MonthlyRouteLocation.query.all()
        keys_list = Key.query.all()
        routes = {r.id: r for r in MonthlyRoute.query.all()}
        keys_by_id = {k.id: k for k in keys_list}

        bc_to_locs: dict[int, list[MonthlyRouteLocation]] = defaultdict(list)
        for loc in locations:
            bc = _barcode_int(loc.barcode)
            if bc is None:
                continue
            bc_to_locs[bc].append(loc)

        keycode_cf_to_key: dict[str, Key] = {}
        for k in keys_list:
            keycode_cf_to_key[_norm_keycode_cf(k.keycode)] = k

        keycode_match_by_key_id: dict[int, list[MonthlyRouteLocation]] = defaultdict(list)
        for loc in locations:
            if _barcode_int(loc.barcode) is not None:
                continue
            if monthly_keys_field_indicates_no_key(loc.keys):
                continue
            mk = _monthly_keys_canonical_cf(loc.keys)
            if not mk:
                continue
            key_row = keycode_cf_to_key.get(mk)
            if key_row is None:
                continue
            keycode_match_by_key_id[key_row.id].append(loc)

        keys_with_links: set[int] = set()
        for k in keys_list:
            if k.barcode is not None and bc_to_locs.get(int(k.barcode)):  # Key.barcode is BigInteger
                keys_with_links.add(k.id)
        keys_with_links.update(keycode_match_by_key_id.keys())

        multi_route: list[tuple[Key, dict[int | None, list[int]], list[MonthlyRouteLocation]]] = []
        mixed_null: list[tuple[Key, list[MonthlyRouteLocation]]] = []

        for kid in sorted(keys_with_links):
            k = keys_by_id.get(kid)
            if k is None:
                continue
            by_loc_id: dict[int, MonthlyRouteLocation] = {}
            if k.barcode is not None:
                for loc in bc_to_locs.get(int(k.barcode), []):  # Key.barcode stored as integer
                    by_loc_id[loc.id] = loc
            for loc in keycode_match_by_key_id.get(k.id, []):
                by_loc_id[loc.id] = loc
            locs = list(by_loc_id.values())

            route_ids_non_null = {loc.monthly_route_id for loc in locs if loc.monthly_route_id is not None}
            has_null = any(loc.monthly_route_id is None for loc in locs)

            if len(route_ids_non_null) > 1:
                detail = defaultdict(list)
                for loc in locs:
                    detail[loc.monthly_route_id].append(loc.id)
                multi_route.append((k, dict(detail), locs))
            elif has_null and route_ids_non_null:
                mixed_null.append((k, locs))

        print("=== Audit: keys linked to multiple monthly routes (read-only) ===\n")
        print(f"Keys with ≥1 monthly library match (barcode and/or keycode path): {len(keys_with_links)}")
        print(f"Keys with matches on >1 distinct monthly_route_id: {len(multi_route)}")
        print(f"Keys with some linked rows missing monthly_route_id + some assigned: {len(mixed_null)}")
        print()

        if multi_route:
            print("[MULTIPLE ROUTES — detail]")
            for i, (k, rid_to_lids, locs) in enumerate(multi_route[: args.limit]):
                print(f"  key id={k.id} keycode={k.keycode!r} barcode={k.barcode}")
                print(f"    monthly_route_ids: {sorted(r for r in rid_to_lids if r is not None)}")
                for rid, lids in sorted(rid_to_lids.items(), key=lambda x: (x[0] is None, x[0] or 0)):
                    r = routes.get(rid) if rid is not None else None
                    print(f"      {_route_label(r, rid)} -> location_ids={sorted(lids)}")
            if len(multi_route) > args.limit:
                print(f"  ... ({len(multi_route) - args.limit} more)")
            print()

        if mixed_null:
            print("[PARTIAL — route FK missing on some linked rows]")
            for k, locs in mixed_null[: args.limit]:
                null_locs = [x.id for x in locs if x.monthly_route_id is None]
                set_locs = [(x.id, x.monthly_route_id) for x in locs if x.monthly_route_id is not None]
                print(f"  key id={k.id} keycode={k.keycode!r} barcode={k.barcode}")
                print(f"    no route: location_ids={sorted(null_locs)}")
                print(f"    assigned: {set_locs}")
            if len(mixed_null) > args.limit:
                print(f"  ... ({len(mixed_null) - args.limit} more)")
            print()

        if not multi_route and not mixed_null:
            print("OK: no key ties to more than one distinct monthly_route_id among matched library rows.")
            print("(PARTIAL bucket empty too — no mix of NULL vs assigned routes for same key.)")

        return 1 if multi_route else 0


if __name__ == "__main__":
    sys.exit(main())
