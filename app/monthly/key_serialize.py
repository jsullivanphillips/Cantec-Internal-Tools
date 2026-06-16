"""Shared serialization for ``keys`` rows linked from monthly locations."""

from __future__ import annotations

from app.db_models import Key


def serialize_linked_key_summary(key: Key | None) -> dict[str, object] | None:
    if key is None:
        return None
    bc = key.barcode
    return {
        "id": int(key.id),
        "keycode": key.keycode,
        "barcode": int(bc) if bc is not None else None,
    }


def linked_key_fields_for_location(loc) -> dict[str, object]:
    """``key_id`` + ``linked_key`` payload fields for worksheet/library rows."""
    lk = getattr(loc, "linked_key", None)
    kid = getattr(loc, "key_id", None)
    return {
        "key_id": int(kid) if kid is not None else None,
        "linked_key": serialize_linked_key_summary(lk),
    }
