"""
Read-only migration readiness report for monthly routes + keys alignment.

Does not insert, update, or delete any rows. Safe to run anytime.

Usage (from repo root, with app env / DATABASE_URL configured):

    python -m app.scripts.check_monthly_migration_readiness
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict

from sqlalchemy.orm import selectinload

from app import create_app
from app.db_models import Key, MonthlyLocation, MonthlyRoute, MonthlyRouteSnapshot
from app.monthly.monthly_keys_keycode import (
    canonical_keycode_from_monthly_keys_field,
    monthly_keys_field_indicates_no_key,
)
from app.monthly.test_day import monthly_test_day_is_cancelled, parse_test_day, pattern_key


def _norm_space(value: str | None) -> str:
    return " ".join((value or "").strip().split())


def _norm_addr(value: str | None) -> str:
    return _norm_space(value).casefold()


def _norm_keycode(value: str | None) -> str:
    return _norm_space(value).casefold()


def _monthly_keys_canonical_cf(raw: str | None) -> str:
    """Monthly KEYS column normalized toward keys.keycode for compares / lookups."""
    return _norm_keycode(canonical_keycode_from_monthly_keys_field(raw))


def _barcode_to_int(barcode: str | None) -> int | None:
    text = _norm_space(barcode)
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def _check_test_days(locations: list[MonthlyLocation]) -> dict[str, object]:
    parse_errors: list[tuple[int, str, str]] = []
    blank_test_day: list[int] = []
    cancelled_test_day: list[int] = []
    patterns_by_route: dict[int, set[tuple[int, int]]] = defaultdict(set)
    parsed_rows: list[tuple[int, object]] = []

    for loc in locations:
        td = loc.test_day
        if not (td or "").strip():
            blank_test_day.append(loc.id)
            continue
        if monthly_test_day_is_cancelled(td):
            cancelled_test_day.append(loc.id)
            continue
        try:
            parsed = parse_test_day(td)
        except ValueError as ex:
            parse_errors.append((loc.id, td or "", str(ex)))
            continue
        if parsed is None:
            blank_test_day.append(loc.id)
            continue
        parsed_rows.append((loc.id, parsed))
        patterns_by_route[parsed.route_number].add(pattern_key(parsed))

    route_conflicts = {
        rn: sorted(seen)
        for rn, seen in patterns_by_route.items()
        if len(seen) > 1
    }

    return {
        "parse_errors": parse_errors,
        "blank_test_day_ids": blank_test_day,
        "cancelled_test_day_ids": cancelled_test_day,
        "route_conflicts": route_conflicts,
        "parsed_row_count": len(parsed_rows),
    }


def _check_keys_barcode(locations: list[MonthlyLocation], keys_by_barcode: dict[int, Key]) -> dict[str, object]:
    mismatches: list[dict[str, object]] = []
    legacy_suffix_ok: list[int] = []
    missing_key_row: list[int] = []
    barcode_parse_fail: list[tuple[int, str]] = []
    barcode_skipped_monthly_no_key: list[int] = []

    for loc in locations:
        raw_bc = _norm_space(loc.barcode)
        if not raw_bc:
            continue
        bc = _barcode_to_int(loc.barcode)
        if bc is None:
            barcode_parse_fail.append((loc.id, raw_bc))
            continue
        key_row = keys_by_barcode.get(bc)
        if key_row is None:
            missing_key_row.append(loc.id)
            continue
        if monthly_keys_field_indicates_no_key(loc.keys):
            barcode_skipped_monthly_no_key.append(loc.id)
            continue
        monthly_cf = _monthly_keys_canonical_cf(loc.keys)
        k_code = _norm_keycode(key_row.keycode)
        if monthly_cf != k_code:
            mismatches.append(
                {
                    "location_id": loc.id,
                    "barcode": bc,
                    "monthly_keys_field": loc.keys,
                    "monthly_canonical_keycode": canonical_keycode_from_monthly_keys_field(loc.keys),
                    "keys_table_keycode": key_row.keycode,
                }
            )
        elif _norm_keycode(loc.keys) != k_code:
            legacy_suffix_ok.append(loc.id)

    return {
        "barcode_mismatches": mismatches,
        "barcode_legacy_suffix_only_ok": legacy_suffix_ok,
        "barcode_missing_key_record": missing_key_row,
        "barcode_parse_failures": barcode_parse_fail,
        "barcode_skipped_monthly_no_key": barcode_skipped_monthly_no_key,
    }


def _check_keys_address_keycode(
    locations: list[MonthlyLocation],
    keys_by_keycode: dict[str, Key],
) -> dict[str, object]:
    """Locations without barcode: compare KEYS column to keys.keycode + address on key."""

    keycode_not_found: list[tuple[int, str]] = []
    address_mismatches: list[dict[str, object]] = []

    for loc in locations:
        if _barcode_to_int(loc.barcode) is not None:
            continue
        if monthly_keys_field_indicates_no_key(loc.keys):
            continue
        mk = _monthly_keys_canonical_cf(loc.keys)
        if not mk:
            continue
        key_row = keys_by_keycode.get(mk)
        if key_row is None:
            keycode_not_found.append((loc.id, loc.keys or ""))
            continue
        addr_norm = _norm_addr(loc.address)
        key_addrs = {_norm_addr(a.address) for a in key_row.addresses}
        if addr_norm not in key_addrs:
            key_addr_raw = [a.address for a in key_row.addresses]
            address_mismatches.append(
                {
                    "location_id": loc.id,
                    "key_id": key_row.id,
                    "keycode": key_row.keycode,
                    "monthly_keys_column": loc.keys,
                    "monthly_address": loc.address,
                    "monthly_display_address": loc.display_address,
                    "monthly_label": loc.label,
                    "monthly_property_management_company": loc.property_management_company,
                    "monthly_address_normalized": addr_norm,
                    "key_addresses_on_file": key_addr_raw,
                    "key_addresses_normalized": sorted(key_addrs),
                }
            )

    return {
        "address_keycode_unknown_keycode": keycode_not_found,
        "address_keycode_address_mismatch": address_mismatches,
    }


def _check_service_trade_linkage(
    locations: list[MonthlyLocation],
    monthly_routes: list[MonthlyRoute],
    snapshots: list[MonthlyRouteSnapshot],
) -> dict[str, object]:
    site_st_ids = {
        loc.service_trade_site_location_id
        for loc in locations
        if loc.service_trade_site_location_id is not None
    }
    route_clock_st_ids = {
        r.service_trade_route_location_id
        for r in monthly_routes
        if r.service_trade_route_location_id is not None
    }

    snapshot_st_ids = {s.location_id for s in snapshots}
    snapshots_linked_to_route_entity = sum(1 for sid in snapshot_st_ids if sid in route_clock_st_ids)
    snapshots_not_linked_routes = len(snapshot_st_ids) - snapshots_linked_to_route_entity

    return {
        "monthly_location_rows_total": len(locations),
        "monthly_location_rows_with_service_trade_site_location_id": len(site_st_ids),
        "monthly_location_rows_without_service_trade_site_location_id": len(locations) - len(site_st_ids),
        "monthly_route_entities_total": len(monthly_routes),
        "monthly_route_entities_with_service_trade_route_location_id": len(route_clock_st_ids),
        "snapshot_rows_total": len(snapshots),
        "snapshot_st_ids_linked_to_monthly_route_entity": snapshots_linked_to_route_entity,
        "snapshot_st_ids_not_linked_to_monthly_route_entity": snapshots_not_linked_routes,
    }


def run_report(limit_detail: int) -> None:
    locations = (
        MonthlyLocation.query.options(selectinload(MonthlyLocation.monthly_route)).all()
    )
    keys_list = Key.query.options(selectinload(Key.addresses)).all()
    snapshots = MonthlyRouteSnapshot.query.all()
    monthly_routes = MonthlyRoute.query.all()

    keys_by_barcode: dict[int, Key] = {}
    for k in keys_list:
        if k.barcode is not None:
            keys_by_barcode[int(k.barcode)] = k

    keys_by_keycode_cf: dict[str, Key] = {_norm_keycode(k.keycode): k for k in keys_list}

    print("=== Monthly migration readiness (read-only) ===\n")

    td = _check_test_days(locations)
    print("[TEST DAY]")
    print(f"  Locations total: {len(locations)}")
    print(f"  Successfully parsed rows: {td['parsed_row_count']}")
    print(f"  Blank TEST DAY: {len(td['blank_test_day_ids'])}")
    print(f"  Cancelled monthly (TEST DAY is dash): {len(td['cancelled_test_day_ids'])}")
    errs = td["parse_errors"]
    print(f"  Parse errors: {len(errs)}")
    for row in errs[:limit_detail]:
        print(f"    location_id={row[0]} test_day={row[1]!r} -> {row[2]}")
    if len(errs) > limit_detail:
        print(f"    ... ({len(errs) - limit_detail} more)")

    conflicts = td["route_conflicts"]
    print(f"  Route numbers with conflicting weekday/occurrence: {len(conflicts)}")
    for rn, patterns in sorted(conflicts.items())[:limit_detail]:
        print(f"    R{rn}: {patterns}")
    if len(conflicts) > limit_detail:
        print(f"    ... ({len(conflicts) - limit_detail} more)")

    kb = _check_keys_barcode(locations, keys_by_barcode)
    print("\n[KEYS via barcode] (monthly column canonicalized: legacy K / [K] suffixes stripped; keys.keycode is truth)")
    print(f"  Canonical mismatch vs keys.keycode: {len(kb['barcode_mismatches'])}")
    for row in kb["barcode_mismatches"][:limit_detail]:
        print(
            f"    location_id={row['location_id']} barcode={row['barcode']} "
            f"monthly={row['monthly_keys_field']!r} canonical={row['monthly_canonical_keycode']!r} keys_tbl={row['keys_table_keycode']!r}"
        )
    print(f"  Resolved by legacy suffix only (raw differed, canonical matched): {len(kb['barcode_legacy_suffix_only_ok'])}")
    print(f"  Monthly row has barcode but no keys.id row: {len(kb['barcode_missing_key_record'])}")
    print(f"  Monthly barcode not parseable as integer: {len(kb['barcode_parse_failures'])}")
    skipped_no = kb["barcode_skipped_monthly_no_key"]
    print(f"  Monthly KEYS is no-key sentinel (barcode keycode compare skipped): {len(skipped_no)}")

    ak = _check_keys_address_keycode(locations, keys_by_keycode_cf)
    print("\n[KEYS via address + keycode (no barcode on monthly row)]")
    print("  (KEYS column '-', 'No keys', empty, etc. = no key; not matched to keys.keycode.)")

    print(f"  KEYCODE on monthly not found in keys table: {len(ak['address_keycode_unknown_keycode'])}")
    for lid, kc in ak["address_keycode_unknown_keycode"][:limit_detail]:
        print(f"    location_id={lid} KEYS column={kc!r}")

    addr_mm = ak["address_keycode_address_mismatch"]
    print(f"  Key found but monthly address not on key_addresses: {len(addr_mm)}")
    for row in addr_mm[:limit_detail]:
        print(f"    --- location_id={row['location_id']} key_id={row['key_id']} keycode={row['keycode']!r} ---")
        print(f"        monthly KEYS column: {row['monthly_keys_column']!r}")
        print(f"        monthly address (library): {row['monthly_address']!r}")
        if row.get("monthly_display_address"):
            print(f"        monthly display_address: {row['monthly_display_address']!r}")
        if row.get("monthly_label"):
            print(f"        monthly label: {row['monthly_label']!r}")
        if row.get("monthly_property_management_company"):
            print(f"        monthly PM company: {row['monthly_property_management_company']!r}")
        print(f"        monthly address (normalized compare): {row['monthly_address_normalized']!r}")
        print(f"        key_addresses on key record ({len(row['key_addresses_on_file'])}):")
        for i, a in enumerate(row["key_addresses_on_file"], 1):
            print(f"          [{i}] {a!r}")
        print(f"        key_addresses normalized: {row['key_addresses_normalized']!r}")

    st = _check_service_trade_linkage(locations, monthly_routes, snapshots)
    print("\n[SERVICE TRADE linkage]")
    print(
        "  Snapshot rows use ServiceTrade *route* clock-in location ids"
        " (see MonthlyRouteSnapshot); compare to MonthlyRoute.service_trade_route_location_id."
    )
    print(
        "  Optional real-building ST ids: MonthlyLocation.service_trade_site_location_id"
        " (separate backfill)."
    )
    for k, v in st.items():
        print(f"  {k}: {v}")

    print("\n[ORM scaffolding]")
    mr_count = MonthlyRoute.query.count()
    print(f"  monthly_route rows: {mr_count}")
    fk_set = sum(1 for loc in locations if loc.monthly_route_id is not None)
    print(f"  monthly_location.monthly_route_id non-null: {fk_set}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only monthly migration checks.")
    parser.add_argument(
        "--limit-detail",
        type=int,
        default=25,
        help="Max sample rows to print per error category (default 25).",
    )
    args = parser.parse_args(argv)

    app = create_app()
    with app.app_context():
        run_report(limit_detail=args.limit_detail)
    return 0


if __name__ == "__main__":
    sys.exit(main())
