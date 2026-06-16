"""
Resolve ``MonthlyLocation.key_id`` from spreadsheet-style ``barcode`` and ``keys`` text.

Does not modify ``keys`` / ``key_status``. Barcode match wins when unambiguous; otherwise
canonical KEYS text is matched to ``keys.keycode`` (case-normalized, whitespace collapsed,
with space-stripped fallback e.g. ``HJ8801`` ↔ ``HJ 8801``).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from sqlalchemy import select

from app.db_models import Key, MonthlyLocation, db
from app.monthly.monthly_keys_keycode import (
    canonical_keycode_from_monthly_keys_field,
    monthly_keys_field_indicates_no_key,
)


def _norm_space(value: str | None) -> str:
    return " ".join((value or "").strip().split())


def _norm_keycode_cf(value: str | None) -> str:
    return _norm_space(value).casefold()


def _compact_keycode_cf(value: str | None) -> str:
    return _norm_keycode_cf(value).replace(" ", "")


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


@dataclass(frozen=True)
class KeycodeLookupIndex:
    """Exact and space-stripped keycode maps for batch resolution."""

    exact: dict[str, int]
    compact: dict[str, int]

    def resolve(self, keycode_cf: str) -> int | None:
        if not keycode_cf:
            return None
        kid = self.exact.get(keycode_cf)
        if kid is not None:
            return kid
        compact = keycode_cf.replace(" ", "")
        if not compact:
            return None
        return self.compact.get(compact)


def build_keycode_lookup_index() -> KeycodeLookupIndex:
    """Build exact + unambiguous compact keycode indexes from ``keys``."""
    rows = db.session.execute(select(Key.id, Key.keycode)).all()
    exact: dict[str, int] = {}
    compact_lists: dict[str, list[int]] = defaultdict(list)
    for kid, kcode in rows:
        cf = _norm_keycode_cf(kcode)
        if cf and cf not in exact:
            exact[cf] = int(kid)
        compact = _compact_keycode_cf(kcode)
        if compact:
            compact_lists[compact].append(int(kid))
    compact = {k: ids[0] for k, ids in compact_lists.items() if len(ids) == 1}
    return KeycodeLookupIndex(exact=exact, compact=compact)


def keycode_cf_to_key_id_map() -> KeycodeLookupIndex:
    """Keycode lookup index for batch uploads and backfill scripts."""
    return build_keycode_lookup_index()


def resolve_key_id_for_monthly_fields(
    barcode: str | None,
    keys: str | None,
    *,
    keycode_cf_index: KeycodeLookupIndex | None = None,
) -> int | None:
    """
    Return ``keys.id`` when exactly one row matches via barcode or canonical keycode.

    Ambiguous barcode (multiple ``Key`` rows with same ``barcode``) falls through to
    keycode resolution.

    Pass ``keycode_cf_index`` from :func:`keycode_cf_to_key_id_map` to avoid scanning
    the keys table on every call (e.g. sheet upload).
    """
    bc = _barcode_int(barcode)
    if bc is not None:
        rows = db.session.execute(select(Key.id).where(Key.barcode == bc).limit(3)).scalars().all()
        if len(rows) == 1:
            return int(rows[0])

    if monthly_keys_field_indicates_no_key(keys):
        return None

    mk = _monthly_keys_canonical_cf(keys)
    if not mk:
        return None

    if keycode_cf_index is not None:
        return keycode_cf_index.resolve(mk)

    matched_exact: list[int] = []
    matched_compact: list[int] = []
    compact_mk = mk.replace(" ", "")
    for kid, kcode in db.session.execute(select(Key.id, Key.keycode)).all():
        if _norm_keycode_cf(kcode) == mk:
            matched_exact.append(int(kid))
        elif compact_mk and _compact_keycode_cf(kcode) == compact_mk:
            matched_compact.append(int(kid))
    if len(matched_exact) == 1:
        return matched_exact[0]
    if len(matched_compact) == 1:
        return matched_compact[0]
    return None


def sync_key_fk_for_location(loc: MonthlyLocation) -> None:
    """Set ``loc.key_id`` from current ``barcode`` / ``keys`` (clears FK when unresolved)."""
    loc.key_id = resolve_key_id_for_monthly_fields(loc.barcode, loc.keys)
