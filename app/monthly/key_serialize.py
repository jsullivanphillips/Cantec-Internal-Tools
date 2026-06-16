"""Shared serialization for ``keys`` rows linked from monthly locations."""

from __future__ import annotations

from app.db_models import Key


def compute_key_ui_fields(key: Key) -> dict[str, object]:
    """Mirror ``_serialize_key_for_spa`` UI flags for linked-key summaries."""
    cs = key.current_status
    status_text = (cs.status if cs else "Unknown") or ""
    st = status_text.lower()
    current_loc = (cs.key_location if cs else "") or ""
    home_loc = (key.home_location or "") or ""
    is_out = st in ("signed out", "out")
    is_in = (not is_out) and (
        st in ("returned", "in", "available")
        or (bool(home_loc) and bool(current_loc) and home_loc.lower() == current_loc.lower())
    )
    return {
        "status_text": status_text,
        "is_out": is_out,
        "is_in": is_in,
        "current_loc": current_loc,
        "home_loc": home_loc,
    }


def serialize_linked_key_summary(key: Key | None, *, include_status: bool = False) -> dict[str, object] | None:
    if key is None:
        return None
    bc = key.barcode
    payload: dict[str, object] = {
        "id": int(key.id),
        "keycode": key.keycode,
        "barcode": int(bc) if bc is not None else None,
    }
    if include_status:
        payload["ui"] = compute_key_ui_fields(key)
    return payload


def linked_key_fields_for_location(loc, *, include_status: bool = False) -> dict[str, object]:
    """``key_id`` + ``linked_key`` payload fields for worksheet/library rows."""
    lk = getattr(loc, "linked_key", None)
    kid = getattr(loc, "key_id", None)
    return {
        "key_id": int(kid) if kid is not None else None,
        "linked_key": serialize_linked_key_summary(lk, include_status=include_status),
    }
