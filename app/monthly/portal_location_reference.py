"""Read-only monthly location payloads for the technician portal."""

from __future__ import annotations

from sqlalchemy import func, or_
from sqlalchemy.orm import joinedload

from app.db_models import MonthlyLocation, MonthlyRoute
from app.monthly.history_sheet_notes import (
    apply_latest_run_notes_to_location_payload,
    latest_history_row_for_location,
)
from app.monthly.service_trade_site_match import service_trade_site_location_url


def _route_label_for_portal(mr: MonthlyRoute | None, test_day: str | None) -> str | None:
    if mr is not None:
        wd_names = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
        wd = (
            wd_names[mr.weekday_iso]
            if isinstance(mr.weekday_iso, int) and 0 <= mr.weekday_iso <= 6
            else "?"
        )
        occ = int(mr.week_occurrence) if mr.week_occurrence is not None else 0
        nth_suffix = "th"
        if not (11 <= (occ % 100) <= 13):
            nth_suffix = {1: "st", 2: "nd", 3: "rd"}.get(occ % 10, "th")
        nth = f"{occ}{nth_suffix}" if occ >= 1 else str(occ)
        return f"R{mr.route_number} · {nth} {wd}"
    td = (test_day or "").strip()
    return td or None


def _active_location_search_filter(q: str):
    needle = q.strip().casefold()
    if not needle:
        return None
    return or_(
        func.lower(func.coalesce(MonthlyLocation.address, "")).contains(needle),
        func.lower(func.coalesce(MonthlyLocation.label, "")).contains(needle),
        func.lower(func.coalesce(MonthlyLocation.label_normalized, "")).contains(needle),
        func.lower(func.coalesce(MonthlyLocation.building_name, "")).contains(needle),
        func.lower(func.coalesce(MonthlyLocation.test_day, "")).contains(needle),
        func.lower(func.coalesce(MonthlyLocation.property_management_company, "")).contains(needle),
        func.lower(func.coalesce(MonthlyLocation.keys, "")).contains(needle),
        func.lower(func.coalesce(MonthlyLocation.annual_month, "")).contains(needle),
    )


def search_active_locations_for_portal(q: str, *, limit: int = 8) -> list[MonthlyLocation]:
    needle = q.strip()
    if len(needle) < 2:
        return []
    search_filter = _active_location_search_filter(needle)
    if search_filter is None:
        return []
    return (
        MonthlyLocation.query.options(joinedload(MonthlyLocation.monthly_route))
        .filter(MonthlyLocation.status_normalized == "active")
        .filter(search_filter)
        .order_by(MonthlyLocation.label.asc(), MonthlyLocation.address.asc())
        .limit(limit)
        .all()
    )


def get_portal_location_reference(location_id: int) -> MonthlyLocation | None:
    return (
        MonthlyLocation.query.options(
            joinedload(MonthlyLocation.monthly_route),
            joinedload(MonthlyLocation.monitoring_company),
            joinedload(MonthlyLocation.linked_key),
        )
        .filter_by(id=int(location_id))
        .one_or_none()
    )


def serialize_portal_location_suggest(loc: MonthlyLocation) -> dict[str, object]:
    address = (loc.display_address or loc.address or "").strip()
    return {
        "id": int(loc.id),
        "label": (loc.label or "").strip() or address,
        "address": address,
        "route_label": _route_label_for_portal(loc.monthly_route, loc.test_day),
        "monthly_route_id": int(loc.monthly_route_id) if loc.monthly_route_id is not None else None,
    }


def serialize_portal_location_reference(loc: MonthlyLocation) -> dict[str, object]:
    from app.routes.monthly_routes import _serialize_linked_key, _serialize_monthly_route_entity
    from app.monthly.monitoring_companies import serialize_monitoring_company

    mr = loc.monthly_route
    address = (loc.display_address or loc.address or "").strip()
    mc = loc.monitoring_company
    mc_record = serialize_monitoring_company(mc)
    company_name = (mc.name or "").strip() if mc is not None else ""
    payload: dict[str, object] = {
        "id": int(loc.id),
        "label": (loc.label or "").strip() or address,
        "address": loc.address,
        "display_address": loc.display_address,
        "building_name": loc.building_name,
        "property_management_company": loc.property_management_company,
        "status_normalized": loc.status_normalized,
        "keys": loc.keys,
        "key_id": loc.key_id,
        "key": _serialize_linked_key(loc.linked_key, include_status=True),
        "test_day": loc.test_day,
        "annual_month": loc.annual_month,
        "latitude": loc.latitude,
        "longitude": loc.longitude,
        "monthly_route_id": loc.monthly_route_id,
        "route_stop_order": loc.route_stop_order,
        "monthly_route": _serialize_monthly_route_entity(mr) if mr is not None else None,
        "route_label": _route_label_for_portal(mr, loc.test_day),
        "notes": loc.notes,
        "ring_detail": loc.ring_detail,
        "facp_detail": loc.facp_detail,
        "panel": loc.panel or loc.facp_detail,
        "panel_location": loc.panel_location,
        "door_code": loc.door_code,
        "access_instructions": loc.access_instructions,
        "monitoring_company_id": loc.monitoring_company_id,
        "monitoring_company": company_name or None,
        "monitoring_company_record": mc_record,
        "monitoring_account_number": loc.monitoring_account_number,
        "monitoring_password": loc.monitoring_password,
        "monitoring_notes": loc.monitoring_notes,
        "testing_procedures": loc.testing_procedures,
        "inspection_tech_notes": loc.inspection_tech_notes,
    }
    st_site_id = loc.service_trade_site_location_id
    payload["service_trade_site_location_id"] = int(st_site_id) if st_site_id is not None else None
    payload["service_trade_site_location_url"] = (
        service_trade_site_location_url(int(st_site_id)) if st_site_id is not None else None
    )
    apply_latest_run_notes_to_location_payload(payload, int(loc.id))

    latest = latest_history_row_for_location(int(loc.id))
    if latest is not None:
        comment = (latest.run_comments or "").strip()
        if comment:
            payload["latest_run_comment"] = comment
            payload["latest_run_comment_month"] = latest.month_date.isoformat()

    return payload
