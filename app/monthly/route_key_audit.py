"""
Route key audit: monthly stops vs route-bag inventory (``Key.route``) and sign-out status.
"""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import aliased, joinedload

from app.db_models import Key, KeyStatus, MonthlyLocation, MonthlyRoute, db
from app.monthly.key_serialize import serialize_linked_key_summary
from app.monthly.monthly_keys_keycode import monthly_keys_field_indicates_no_key
from app.routes.keys import is_route_bag_keycode


def _norm_route(value: str | None) -> str:
    return (value or "").strip().casefold()


def _latest_status_by_key_id() -> dict[int, KeyStatus]:
    KS = KeyStatus
    latest = (
        db.session.query(
            KS.key_id.label("key_id"),
            func.max(KS.inserted_at).label("max_inserted_at"),
        )
        .group_by(KS.key_id)
        .subquery()
    )
    ks_latest = aliased(KS)
    rows = (
        db.session.query(ks_latest)
        .join(
            latest,
            (ks_latest.key_id == latest.c.key_id)
            & (ks_latest.inserted_at == latest.c.max_inserted_at),
        )
        .all()
    )
    return {int(r.key_id): r for r in rows}


def _key_availability(
    key: Key,
    latest: KeyStatus | None,
) -> str:
    """``available`` | ``unavailable`` | ``unknown``."""
    if latest is None:
        return "available"
    st = (latest.status or "").strip().casefold()
    if st not in ("signed out", "out"):
        return "available"
    if latest.is_on_monthly is True:
        return "available"
    return "unavailable"


def _loc_audit_row(loc: MonthlyLocation, *, issue: str, detail: str | None = None) -> dict[str, object]:
    lk = loc.linked_key
    return {
        "location_id": int(loc.id),
        "label": (loc.label or "").strip() or None,
        "address": (loc.display_address or loc.address or "").strip() or None,
        "keys_text": (loc.keys or "").strip() or None,
        "key_id": int(loc.key_id) if loc.key_id is not None else None,
        "linked_key": serialize_linked_key_summary(lk),
        "issue": issue,
        "detail": detail,
    }


def _key_audit_row(key: Key, *, issue: str, detail: str | None = None) -> dict[str, object]:
    addr = key.addresses[0].address if key.addresses else None
    return {
        "key_id": int(key.id),
        "keycode": key.keycode,
        "barcode": int(key.barcode) if key.barcode is not None else None,
        "route": key.route,
        "address": addr,
        "issue": issue,
        "detail": detail,
    }


def build_route_key_audit(route: MonthlyRoute) -> dict[str, object]:
    bag_code = f"R{route.route_number}"
    bag_cf = _norm_route(bag_code)

    locs = (
        MonthlyLocation.query.options(joinedload(MonthlyLocation.linked_key))
        .filter(
            MonthlyLocation.monthly_route_id == route.id,
            MonthlyLocation.status_normalized == "active",
        )
        .order_by(MonthlyLocation.route_stop_order.asc().nulls_last(), MonthlyLocation.id.asc())
        .all()
    )

    stops_requiring_key = [
        loc for loc in locs if not monthly_keys_field_indicates_no_key(loc.keys)
    ]
    linked_stops = [loc for loc in stops_requiring_key if loc.key_id is not None]
    unlinked = [loc for loc in stops_requiring_key if loc.key_id is None]

    bag_keys = (
        Key.query.options(joinedload(Key.addresses))
        .filter(func.lower(func.trim(Key.route)) == bag_cf)
        .all()
    )
    bag_key_ids = {int(k.id) for k in bag_keys if not is_route_bag_keycode(k.keycode or "")}
    expected_key_ids = {int(loc.key_id) for loc in linked_stops if loc.key_id is not None}

    latest_by_key = _latest_status_by_key_id()

    wrong_route: list[dict[str, object]] = []
    missing_from_bag: list[dict[str, object]] = []
    unavailable: list[dict[str, object]] = []
    available: list[dict[str, object]] = []

    for loc in linked_stops:
        kid = int(loc.key_id)
        key = loc.linked_key
        if key is None:
            continue
        key_route_cf = _norm_route(key.route)
        if key_route_cf != bag_cf:
            wrong_route.append(
                _loc_audit_row(
                    loc,
                    issue="wrong_route",
                    detail=f"Key.route is {key.route!r}; expected {bag_code}",
                )
            )
        if kid not in bag_key_ids:
            missing_from_bag.append(
                _loc_audit_row(
                    loc,
                    issue="missing_from_bag",
                    detail=f"Key id {kid} not assigned to {bag_code} in keys table",
                )
            )
        avail = _key_availability(key, latest_by_key.get(kid))
        if avail == "unavailable":
            ks = latest_by_key.get(kid)
            unavailable.append(
                _loc_audit_row(
                    loc,
                    issue="unavailable",
                    detail=(
                        f"Signed out to {ks.key_location!r}"
                        if ks is not None
                        else "Signed out"
                    ),
                )
            )
        elif avail == "available":
            available.append(_loc_audit_row(loc, issue="available"))

    extra_in_bag: list[dict[str, object]] = []
    for key in bag_keys:
        if is_route_bag_keycode(key.keycode or ""):
            continue
        if int(key.id) not in expected_key_ids:
            extra_in_bag.append(
                _key_audit_row(
                    key,
                    issue="extra_in_bag",
                    detail=f"On {bag_code} but not linked from any active stop",
                )
            )

    issue_count = len(unlinked) + len(wrong_route) + len(unavailable) + len(missing_from_bag)

    return {
        "route_id": int(route.id),
        "route_number": int(route.route_number),
        "bag_code": bag_code,
        "counts": {
            "stops_on_route": len(locs),
            "stops_requiring_key": len(stops_requiring_key),
            "linked": len(linked_stops),
            "unlinked": len(unlinked),
            "wrong_route": len(wrong_route),
            "missing_from_bag": len(missing_from_bag),
            "unavailable": len(unavailable),
            "available": len(available),
            "extra_in_bag": len(extra_in_bag),
            "issues": issue_count,
        },
        "unlinked": [_loc_audit_row(loc, issue="unlinked") for loc in unlinked],
        "wrong_route": wrong_route,
        "missing_from_bag": missing_from_bag,
        "unavailable": unavailable,
        "available": available,
        "extra_in_bag": extra_in_bag,
    }
