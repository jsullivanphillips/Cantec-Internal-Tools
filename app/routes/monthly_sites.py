"""V2 monthly site API (dual schema): ``MonthlySite`` / ``MonthlyTestingSite`` layered on legacy ``MonthlyRouteLocation``."""

from __future__ import annotations

from decimal import Decimal

from flask import Blueprint, jsonify, request
from sqlalchemy import func
from sqlalchemy.orm import joinedload, selectinload

from app.db_models import (
    Key,
    MonitoringCompany,
    MonthlyRouteLocation,
    MonthlySite,
    MonthlyTestingSite,
    MonthlyTestingSiteMonth,
    db,
)
from app.monthly.key_resolve import sync_key_fk_for_testing_site
from app.monthly.monthly_sites_sync import (
    ensure_monthly_site_for_location,
    rollup_price_per_month,
    _next_sqlite_bigint_id,
)

monthly_sites_bp = Blueprint("monthly_sites", __name__)

def _testing_site_eager_options():
    return (
        joinedload(MonthlyTestingSite.linked_key),
        joinedload(MonthlyTestingSite.monitoring_company),
    )


_LIBRARY_LIST_LOCATION_LOAD = (
    joinedload(MonthlyRouteLocation.monthly_site).selectinload(MonthlySite.testing_sites).options(
        *_testing_site_eager_options()
    ),
    joinedload(MonthlyRouteLocation.linked_key),
)

_LIBRARY_DETAIL_LOCATION_LOAD = (
    joinedload(MonthlyRouteLocation.monthly_site).selectinload(MonthlySite.testing_sites).options(
        *_testing_site_eager_options()
    ),
)


def _unwrap_flask_handler_result(result: object) -> tuple[object, int]:
    """View functions called directly return ``(Response, status)``, not a bare Response."""
    if isinstance(result, tuple) and len(result) >= 2:
        return result[0], int(result[1])
    return result, int(getattr(result, "status_code", 200))


def _serialize_linked_key(key: Key | None) -> dict[str, object] | None:
    if key is None:
        return None
    bc = key.barcode
    return {
        "id": int(key.id),
        "keycode": key.keycode,
        "barcode": int(bc) if bc is not None else None,
    }


def _serialize_monitoring_company(mc: MonitoringCompany | None) -> dict[str, object] | None:
    if mc is None:
        return None
    return {"id": int(mc.id), "name": (mc.name or "").strip() or None}


def _effective_panel(ts: MonthlyTestingSite) -> str | None:
    raw = (ts.panel or ts.facp_detail or "").strip()
    return raw or None


def _latest_run_comment_for_testing_site(testing_site_id: int) -> tuple[str | None, str | None]:
    row = (
        MonthlyTestingSiteMonth.query.filter(
            MonthlyTestingSiteMonth.monthly_testing_site_id == testing_site_id,
            MonthlyTestingSiteMonth.run_comments.isnot(None),
            func.trim(MonthlyTestingSiteMonth.run_comments) != "",
        )
        .order_by(
            MonthlyTestingSiteMonth.month_date.desc(),
            MonthlyTestingSiteMonth.updated_at.desc(),
            MonthlyTestingSiteMonth.id.desc(),
        )
        .first()
    )
    if row is None:
        return None, None
    return (row.run_comments or "").strip() or None, row.month_date.isoformat()


def _serialize_testing_site(ts: MonthlyTestingSite) -> dict[str, object]:
    latest_run_comment, latest_run_comment_month = _latest_run_comment_for_testing_site(int(ts.id))
    return {
        "id": int(ts.id),
        "monthly_site_id": int(ts.monthly_site_id),
        "sort_order": int(ts.sort_order),
        "label": ts.label,
        "price_per_month": float(ts.price_per_month) if ts.price_per_month is not None else None,
        "ring": ts.ring_detail,
        "ring_detail": ts.ring_detail,
        "keys": ts.keys,
        "key_id": ts.key_id,
        "key": _serialize_linked_key(ts.linked_key),
        "barcode": ts.barcode,
        "annual_month": ts.annual_month,
        "property_management_company": ts.property_management_company,
        "building_name": ts.building_name,
        "panel": _effective_panel(ts),
        "panel_location": ts.panel_location,
        "door_code": ts.door_code,
        "facp_detail": ts.facp_detail,
        "monitoring_company_id": ts.monitoring_company_id,
        "monitoring_company": _serialize_monitoring_company(ts.monitoring_company),
        "monitoring_notes": ts.monitoring_notes,
        "testing_procedures": ts.testing_procedures,
        "inspection_tech_notes": ts.inspection_tech_notes,
        "latest_run_comment": latest_run_comment,
        "latest_run_comment_month": latest_run_comment_month,
    }


def _load_locations_by_ids(location_ids: list[int]) -> dict[int, MonthlyRouteLocation]:
    if not location_ids:
        return {}
    rows = (
        MonthlyRouteLocation.query.options(*_LIBRARY_LIST_LOCATION_LOAD)
        .filter(MonthlyRouteLocation.id.in_(location_ids))
        .all()
    )
    return {int(row.id): row for row in rows}


def _augment_library_location_row_list(
    row: dict[str, object],
    loc_by_id: dict[int, MonthlyRouteLocation],
) -> dict[str, object]:
    """Lightweight list augmentation: key rollup only (no sync, no testing_sites payload)."""
    lid = row.get("id")
    if not isinstance(lid, int):
        return row
    loc = loc_by_id.get(lid)
    if loc is None:
        return row

    ms = loc.monthly_site
    if ms is None or not ms.testing_sites:
        row["monthly_site_id"] = int(ms.id) if ms is not None else None
        row["rollup_price_per_month"] = None
        return row

    sites_sorted = sorted(ms.testing_sites, key=lambda t: int(t.sort_order))
    rollup = rollup_price_per_month(ms)
    row["monthly_site_id"] = int(ms.id)
    row["rollup_price_per_month"] = float(rollup) if rollup is not None else None
    primary = sites_sorted[0]
    row["key_id"] = primary.key_id
    row["keys"] = primary.keys
    row["key"] = _serialize_linked_key(primary.linked_key)
    return row


def _augment_library_location_row_detail(row: dict[str, object], loc: MonthlyRouteLocation) -> dict[str, object]:
    """Full detail augmentation including testing_sites (read-only; no sync on GET)."""
    ms = loc.monthly_site
    if ms is None or not ms.testing_sites:
        row["monthly_site_id"] = int(ms.id) if ms is not None else None
        row["rollup_price_per_month"] = None
        row["testing_sites"] = []
        from app.monthly.history_sheet_notes import apply_latest_run_notes_to_location_payload

        apply_latest_run_notes_to_location_payload(row, int(loc.id))
        return row

    sites_sorted = sorted(ms.testing_sites, key=lambda t: int(t.sort_order))
    rollup = rollup_price_per_month(ms)
    row["monthly_site_id"] = int(ms.id)
    row["rollup_price_per_month"] = float(rollup) if rollup is not None else None

    row["testing_sites"] = [_serialize_testing_site(ts) for ts in sites_sorted]

    primary = sites_sorted[0]
    row["key_id"] = primary.key_id
    row["keys"] = primary.keys
    row["key"] = _serialize_linked_key(primary.linked_key)
    row["testing_procedures"] = primary.testing_procedures
    row["inspection_tech_notes"] = primary.inspection_tech_notes
    return row


@monthly_sites_bp.get("/api/monthly_sites/library")
def monthly_sites_library():
    from app.routes.monthly_routes import monthly_routes_library

    raw = monthly_routes_library(list_view=True)
    resp, status = _unwrap_flask_handler_result(raw)
    if status != 200:
        return raw
    data = resp.get_json(silent=True)
    if not isinstance(data, dict):
        return raw

    location_ids = [lid for row in data.get("locations", []) if isinstance((lid := row.get("id")), int)]
    loc_by_id = _load_locations_by_ids(location_ids)
    data["locations"] = [
        _augment_library_location_row_list(dict(r), loc_by_id) for r in data.get("locations", [])
    ]
    return jsonify(data)


@monthly_sites_bp.get("/api/monthly_sites/library/<int:location_id>")
def monthly_sites_library_detail(location_id: int):
    from app.routes.monthly_routes import get_monthly_route_location

    raw = get_monthly_route_location(location_id)
    resp, status = _unwrap_flask_handler_result(raw)
    if status != 200:
        return raw
    body = resp.get_json(silent=True)
    if not isinstance(body, dict) or "location" not in body:
        return raw

    loc = (
        MonthlyRouteLocation.query.options(*_LIBRARY_DETAIL_LOCATION_LOAD)
        .filter_by(id=location_id)
        .one_or_none()
    )
    loc_dict = dict(body["location"])
    body["location"] = _augment_library_location_row_detail(loc_dict, loc) if loc is not None else loc_dict
    return jsonify(body)


@monthly_sites_bp.post("/api/monthly_sites/library")
def monthly_sites_create():
    from app.routes.monthly_routes import create_monthly_route_location

    raw = create_monthly_route_location()
    resp, status = _unwrap_flask_handler_result(raw)
    if status != 201:
        return raw
    data = resp.get_json(silent=True)
    if not isinstance(data, dict) or "location" not in data:
        return raw

    lid = data["location"].get("id")
    loc = (
        MonthlyRouteLocation.query.options(*_LIBRARY_DETAIL_LOCATION_LOAD).filter_by(id=lid).one_or_none()
        if isinstance(lid, int)
        else None
    )
    loc_dict = dict(data["location"])
    data["location"] = _augment_library_location_row_detail(loc_dict, loc) if loc is not None else loc_dict
    return jsonify(data), 201


@monthly_sites_bp.patch("/api/monthly_sites/library/<int:location_id>")
def monthly_sites_patch_location(location_id: int):
    from app.routes.monthly_routes import update_monthly_route_location

    raw = update_monthly_route_location(location_id)
    resp, status = _unwrap_flask_handler_result(raw)
    if status != 200:
        return raw
    body = resp.get_json(silent=True)
    if not isinstance(body, dict) or "location" not in body:
        return raw
    loc = (
        MonthlyRouteLocation.query.options(*_LIBRARY_DETAIL_LOCATION_LOAD)
        .filter_by(id=location_id)
        .one_or_none()
    )
    loc_dict = dict(body["location"])
    body["location"] = _augment_library_location_row_detail(loc_dict, loc) if loc is not None else loc_dict
    return jsonify(body)


@monthly_sites_bp.delete("/api/monthly_sites/library/<int:location_id>")
def monthly_sites_delete_location(location_id: int):
    from app.routes.monthly_routes import delete_monthly_route_location

    ms = MonthlySite.query.filter_by(legacy_monthly_route_location_id=location_id).one_or_none()
    if ms is not None:
        db.session.delete(ms)
        db.session.flush()
    return delete_monthly_route_location(location_id)


@monthly_sites_bp.patch("/api/monthly_sites/library/<int:location_id>/placement")
def monthly_sites_placement(location_id: int):
    from app.routes.monthly_routes import update_monthly_route_placement

    return update_monthly_route_placement(location_id)


@monthly_sites_bp.patch("/api/monthly_sites/library/<int:location_id>/assign_route")
def monthly_sites_assign_route(location_id: int):
    from app.routes.monthly_routes import assign_monthly_route_location

    return assign_monthly_route_location(location_id)


@monthly_sites_bp.get("/api/monthly_sites/geocode_candidates")
def monthly_sites_geocode():
    from app.routes.monthly_routes import monthly_routes_geocode_candidates

    return monthly_routes_geocode_candidates()


def _apply_testing_site_payload(ts: MonthlyTestingSite, payload: dict) -> tuple[dict[str, str], int] | None:
    """Apply PATCH/POST fields to ``ts``. Returns ``(body, status)`` on validation error."""
    if "label" in payload:
        ts.label = (str(payload.get("label")).strip() or None) if payload.get("label") is not None else None
    if "sort_order" in payload:
        try:
            ts.sort_order = int(payload.get("sort_order"))
        except (TypeError, ValueError):
            return ({"error": "sort_order must be an integer"}, 400)
    if "price_per_month" in payload:
        raw = payload.get("price_per_month")
        if raw is None or raw == "":
            ts.price_per_month = None
        else:
            try:
                ts.price_per_month = Decimal(str(raw))
            except Exception:
                return ({"error": "invalid price_per_month"}, 400)
    if "ring_detail" in payload or "ring" in payload:
        raw = payload.get("ring_detail", payload.get("ring"))
        ts.ring_detail = (str(raw).strip() or None) if raw is not None else None
    if "annual_month" in payload:
        raw = payload.get("annual_month")
        ts.annual_month = (str(raw).strip() or None) if raw is not None else None
    if "property_management_company" in payload:
        raw = payload.get("property_management_company")
        ts.property_management_company = (str(raw).strip() or None) if raw is not None else None
    if "building_name" in payload:
        raw = payload.get("building_name")
        ts.building_name = (str(raw).strip() or None) if raw is not None else None
    if "panel_location" in payload:
        raw = payload.get("panel_location")
        ts.panel_location = (str(raw).strip() or None) if raw is not None else None
    if "door_code" in payload:
        raw = payload.get("door_code")
        ts.door_code = (str(raw).strip() or None) if raw is not None else None
    if "panel" in payload:
        raw = payload.get("panel")
        panel_val = (str(raw).strip() or None) if raw is not None else None
        ts.panel = panel_val
        ts.facp_detail = panel_val
    elif "facp_detail" in payload:
        raw = payload.get("facp_detail")
        panel_val = (str(raw).strip() or None) if raw is not None else None
        ts.facp_detail = panel_val
        ts.panel = panel_val
    if "monitoring_company_id" in payload:
        raw_mcid = payload.get("monitoring_company_id")
        if raw_mcid is None:
            ts.monitoring_company_id = None
        else:
            try:
                mcid = int(raw_mcid)
            except (TypeError, ValueError):
                return ({"error": "monitoring_company_id must be an integer or null"}, 400)
            if db.session.get(MonitoringCompany, mcid) is None:
                return ({"error": "monitoring_company_id does not reference an existing monitoring company"}, 400)
            ts.monitoring_company_id = mcid
    if "testing_procedures" in payload:
        v = payload.get("testing_procedures")
        ts.testing_procedures = (str(v).strip() or None) if v is not None else None
    if "inspection_tech_notes" in payload:
        v = payload.get("inspection_tech_notes")
        ts.inspection_tech_notes = (str(v).strip() or None) if v is not None else None
    if "monitoring_notes" in payload:
        v = payload.get("monitoring_notes")
        ts.monitoring_notes = (str(v).strip() or None) if v is not None else None
    if "keys" in payload or "key" in payload:
        raw = payload.get("keys", payload.get("key"))
        ts.keys = (str(raw).strip() or None) if raw is not None else None
    if "barcode" in payload:
        raw = payload.get("barcode")
        ts.barcode = (str(raw).strip() or None) if raw is not None else None
    if "key_id" in payload:
        raw_kid = payload.get("key_id")
        if raw_kid is None:
            ts.key_id = None
        else:
            try:
                kid = int(raw_kid)
            except (TypeError, ValueError):
                return ({"error": "key_id must be an integer or null"}, 400)
            if db.session.get(Key, kid) is None:
                return ({"error": "key_id does not reference an existing key"}, 400)
            ts.key_id = kid
    elif "keys" in payload or "barcode" in payload:
        sync_key_fk_for_testing_site(ts)
    return None


def _push_testing_site_keys_to_legacy_if_needed(ts: MonthlyTestingSite) -> None:
    loc = ts.monthly_site.legacy_location if ts.monthly_site else None
    if loc is not None:
        from app.monthly.monthly_sites_sync import push_testing_site_keys_to_legacy

        push_testing_site_keys_to_legacy(loc)


@monthly_sites_bp.patch("/api/monthly_sites/testing_sites/<int:testing_site_id>")
def monthly_sites_patch_testing_site(testing_site_id: int):
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object payload required"}), 400

    ts = (
        MonthlyTestingSite.query.options(
            joinedload(MonthlyTestingSite.monthly_site).joinedload(MonthlySite.legacy_location)
        )
        .filter_by(id=testing_site_id)
        .one_or_none()
    )
    if ts is None:
        return jsonify({"error": "Testing site not found"}), 404

    err = _apply_testing_site_payload(ts, payload)
    if err is not None:
        return jsonify(err[0]), err[1]

    _push_testing_site_keys_to_legacy_if_needed(ts)
    loc = ts.monthly_site.legacy_location if ts.monthly_site else None
    if loc is not None:
        from app.monthly.monthly_sites_sync import push_primary_testing_site_display_to_legacy

        push_primary_testing_site_display_to_legacy(loc, ts)

    db.session.commit()
    db.session.refresh(ts)
    return jsonify({"testing_site": _serialize_testing_site(ts)})


@monthly_sites_bp.post("/api/monthly_sites/library/<int:location_id>/testing_sites")
def monthly_sites_add_testing_site(location_id: int):
    payload = request.get_json(silent=True)
    if payload is not None and not isinstance(payload, dict):
        return jsonify({"error": "JSON object payload required"}), 400
    payload = payload if isinstance(payload, dict) else {}

    loc = db.session.get(MonthlyRouteLocation, location_id)
    if loc is None:
        return jsonify({"error": "Location not found"}), 404
    site = ensure_monthly_site_for_location(loc)
    if site.legacy_monthly_route_location_id != int(loc.id):
        site.legacy_monthly_route_location_id = int(loc.id)

    max_so = (
        db.session.query(func.coalesce(func.max(MonthlyTestingSite.sort_order), -1))
        .filter(MonthlyTestingSite.monthly_site_id == int(site.id))
        .scalar()
    )
    next_order = int(max_so if max_so is not None else -1) + 1
    ts_kw = dict(
        monthly_site_id=int(site.id),
        sort_order=next_order,
        label=None,
        price_per_month=None,
    )
    tid = _next_sqlite_bigint_id(MonthlyTestingSite)
    if tid is not None:
        ts_kw["id"] = tid
    ts = MonthlyTestingSite(**ts_kw)
    db.session.add(ts)
    db.session.flush()

    if payload:
        err = _apply_testing_site_payload(ts, payload)
        if err is not None:
            db.session.rollback()
            return jsonify(err[0]), err[1]
        _push_testing_site_keys_to_legacy_if_needed(ts)

    db.session.commit()
    db.session.refresh(ts)
    return jsonify({"testing_site": _serialize_testing_site(ts)}), 201


@monthly_sites_bp.put("/api/monthly_sites/library/<int:location_id>/testing_sites/order")
def monthly_sites_reorder_testing_sites(location_id: int):
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object payload required"}), 400

    raw_ids = payload.get("ordered_testing_site_ids")
    if not isinstance(raw_ids, list):
        return jsonify({"error": "ordered_testing_site_ids must be a list"}), 400
    try:
        ordered_ids = [int(v) for v in raw_ids]
    except (TypeError, ValueError):
        return jsonify({"error": "ordered_testing_site_ids must contain integers"}), 400

    loc = db.session.get(MonthlyRouteLocation, location_id)
    if loc is None:
        return jsonify({"error": "Location not found"}), 404
    site = ensure_monthly_site_for_location(loc)
    rows = (
        MonthlyTestingSite.query.filter_by(monthly_site_id=int(site.id))
        .order_by(MonthlyTestingSite.sort_order.asc(), MonthlyTestingSite.id.asc())
        .all()
    )
    existing_ids = {int(row.id) for row in rows}
    if len(ordered_ids) != len(existing_ids) or set(ordered_ids) != existing_ids:
        return jsonify(
            {
                "error": "ordered_testing_site_ids must list each testing site for this location exactly once",
            }
        ), 400

    by_id = {int(row.id): row for row in rows}
    offset = len(rows)
    for idx, testing_site_id in enumerate(ordered_ids):
        by_id[testing_site_id].sort_order = offset + idx
    db.session.flush()

    for idx, testing_site_id in enumerate(ordered_ids):
        by_id[testing_site_id].sort_order = idx

    db.session.commit()
    ordered_rows = [by_id[testing_site_id] for testing_site_id in ordered_ids]
    return jsonify({"testing_sites": [_serialize_testing_site(row) for row in ordered_rows]})


@monthly_sites_bp.delete("/api/monthly_sites/testing_sites/<int:testing_site_id>")
def monthly_sites_delete_testing_site(testing_site_id: int):
    ts = db.session.get(MonthlyTestingSite, testing_site_id)
    if ts is None:
        return jsonify({"error": "Testing site not found"}), 404
    site = ts.monthly_site
    sibling_count = MonthlyTestingSite.query.filter_by(monthly_site_id=int(site.id)).count() if site else 0
    if site is not None and sibling_count <= 1:
        return jsonify({"error": "Cannot delete the only testing site for a monthly site"}), 400
    db.session.delete(ts)
    db.session.commit()
    return ("", 204)

