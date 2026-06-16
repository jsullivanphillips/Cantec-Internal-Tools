"""
List monthly locations whose Key # looks like a real key but ``key_id`` is unset.

    python -m app.scripts.list_unlinked_monthly_keys
"""

from __future__ import annotations

import sys

from sqlalchemy.orm import joinedload

from app import create_app
from app.db_models import MonthlyLocation
from app.monthly.key_resolve import (
    _norm_keycode_cf,
    keycode_cf_to_key_id_map,
    resolve_key_id_for_monthly_fields,
)
from app.monthly.monthly_keys_keycode import (
    canonical_keycode_from_monthly_keys_field,
    monthly_keys_field_indicates_no_key,
)


def _norm(value: str | None) -> str:
    return " ".join((value or "").strip().split())


def main() -> int:
    app = create_app()
    with app.app_context():
        idx = keycode_cf_to_key_id_map()
        locs = (
            MonthlyLocation.query.options(joinedload(MonthlyLocation.monthly_route))
            .order_by(MonthlyLocation.id.asc())
            .all()
        )
        rows: list[tuple[int, str, str, str, str | None, str, str]] = []
        for loc in locs:
            if monthly_keys_field_indicates_no_key(loc.keys):
                continue
            if loc.key_id is not None:
                continue
            keys_raw = _norm(loc.keys)
            canon = _norm(canonical_keycode_from_monthly_keys_field(loc.keys))
            canon_cf = _norm_keycode_cf(canon) if canon else ""
            in_keys = idx.resolve(canon_cf) is not None if canon_cf else False
            route_num = loc.monthly_route.route_number if loc.monthly_route else None
            rn_s = f"R{route_num}" if route_num is not None else "?"
            addr = _norm(loc.display_address or loc.address) or _norm(loc.label)
            reason = "missing_from_keys_table" if not in_keys else "fk_not_set"
            rows.append((int(loc.id), rn_s, addr[:70], keys_raw, _norm(loc.barcode) or None, canon, reason))

        print(f"Unlinked sites (Key # is a real keycode, key_id is null): {len(rows)}\n")
        print(f"{'ID':>5}  {'Route':>5}  {'Reason':<22}  {'Key #':<22}  Address")
        print("-" * 115)
        for lid, rn_s, addr, keys_raw, _bc, _canon, reason in rows:
            print(f"{lid:>5}  {rn_s:>5}  {reason:<22}  {keys_raw[:22]:<22}  {addr}")

        missing = sum(1 for r in rows if r[6] == "missing_from_keys_table")
        fk = sum(1 for r in rows if r[6] == "fk_not_set")
        print(f"\nSummary: {missing} keycode not in keys table, {fk} key exists but key_id not set")
    return 0


if __name__ == "__main__":
    sys.exit(main())
