"""
Resolve ``MonthlyLocation.key_id`` from spreadsheet-style ``barcode`` and ``keys`` text.

Does not modify ``keys`` / ``key_status``. Barcode match wins when unambiguous; otherwise
canonical KEYS text is matched to ``keys.keycode`` (case- and space-normalized).
"""

from __future__ import annotations

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


def keycode_cf_to_key_id_map() -> dict[str, int]:
    """All keys keyed by normalized keycode (for batch uploads). First row wins on duplicate norms."""
    rows = db.session.execute(select(Key.id, Key.keycode)).all()
    out: dict[str, int] = {}
    for kid, kcode in rows:
        cf = _norm_keycode_cf(kcode)
        if not cf or cf in out:
            continue
        out[cf] = int(kid)
    return out


def resolve_key_id_for_monthly_fields(
    barcode: str | None,
    keys: str | None,
    *,
    keycode_cf_index: dict[str, int] | None = None,
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
        kid = keycode_cf_index.get(mk)
        return kid

    matched: list[int] = []
    for kid, kcode in db.session.execute(select(Key.id, Key.keycode)).all():
        if _norm_keycode_cf(kcode) == mk:
            matched.append(int(kid))
    if len(matched) == 1:
        return matched[0]
    return None


def sync_key_fk_for_location(loc: MonthlyLocation) -> None:
    """Set ``loc.key_id`` from current ``barcode`` / ``keys`` (clears FK when unresolved)."""
    loc.key_id = resolve_key_id_for_monthly_fields(loc.barcode, loc.keys)
