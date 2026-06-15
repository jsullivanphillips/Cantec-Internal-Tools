"""Monthlies dashboard: active library sites missing ServiceTrade link or price."""

from __future__ import annotations

from sqlalchemy.orm import joinedload

from app.db_models import MonthlyLocation
from app.monthly.technician_demo_route import is_technician_demo_library_location


def _issue_sort_key(loc: MonthlyLocation) -> tuple[int, str, int]:
    mr = loc.monthly_route
    route_num = int(mr.route_number) if mr is not None else 999_999
    addr = (loc.address or "").casefold()
    return (route_num, addr, int(loc.id))


def _serialize_issue_location(loc: MonthlyLocation) -> dict[str, object]:
    from app.routes.monthly_routes import _serialize_monthly_route_entity

    mr = loc.monthly_route
    st_site_id = loc.service_trade_site_location_id
    return {
        "id": int(loc.id),
        "label": loc.label,
        "address": loc.address,
        "display_address": loc.display_address,
        "property_management_company": loc.property_management_company,
        "test_day": loc.test_day,
        "monthly_route_id": loc.monthly_route_id,
        "monthly_route": _serialize_monthly_route_entity(mr),
        "status_normalized": loc.status_normalized,
        "price_per_month": float(loc.price_per_month) if loc.price_per_month is not None else None,
        "service_trade_site_location_id": (
            int(st_site_id) if st_site_id is not None else None
        ),
    }


def list_dashboard_library_issues() -> dict[str, object]:
    """Active library sites missing ST link and/or price, excluding R99 demo stops."""
    rows = (
        MonthlyLocation.query.options(joinedload(MonthlyLocation.monthly_route))
        .filter(MonthlyLocation.status_normalized == "active")
        .all()
    )

    eligible = [loc for loc in rows if not is_technician_demo_library_location(loc)]

    missing_st: list[MonthlyLocation] = []
    missing_price: list[MonthlyLocation] = []

    for loc in eligible:
        if loc.service_trade_site_location_id is None:
            missing_st.append(loc)
        if loc.price_per_month is None:
            missing_price.append(loc)

    missing_st.sort(key=_issue_sort_key)
    missing_price.sort(key=_issue_sort_key)

    st_payload = [_serialize_issue_location(loc) for loc in missing_st]
    price_payload = [_serialize_issue_location(loc) for loc in missing_price]

    return {
        "missing_service_trade_link": st_payload,
        "missing_price": price_payload,
        "counts": {
            "missing_service_trade_link": len(st_payload),
            "missing_price": len(price_payload),
        },
    }
