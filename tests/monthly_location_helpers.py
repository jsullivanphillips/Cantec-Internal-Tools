"""Shared flat ``MonthlyLocation`` / ``MonthlyLocationMonth`` test fixtures."""

from __future__ import annotations

from datetime import date

from app.db_models import (
    Key,
    MonitoringCompany,
    MonthlyLocation,
    MonthlyLocationComment,
    MonthlyLocationDeficiency,
    MonthlyLocationMonth,
    MonthlyRoute,
    MonthlyRouteRun,
    MonthlyRouteWorksheetAuditEvent,
    MonthlyStopClockEvent,
    db,
)

WORKSHEET_TABLES = [
    Key.__table__,
    MonitoringCompany.__table__,
    MonthlyRoute.__table__,
    MonthlyLocation.__table__,
    MonthlyLocationComment.__table__,
    MonthlyRouteRun.__table__,
    MonthlyLocationMonth.__table__,
    MonthlyRouteWorksheetAuditEvent.__table__,
    MonthlyStopClockEvent.__table__,
    MonthlyLocationDeficiency.__table__,
]


def make_location(
    *,
    id: int,
    address: str,
    label: str | None = None,
    address_normalized: str | None = None,
    label_normalized: str | None = None,
    property_management_company: str = "",
    property_management_company_normalized: str = "",
    status_normalized: str = "active",
    status_raw: str = "Active",
    monthly_route_id: int | None = None,
    route_stop_order: int | None = None,
    **extra,
) -> MonthlyLocation:
    resolved_label = label if label is not None else address
    return MonthlyLocation(
        id=id,
        address=address,
        address_normalized=address_normalized or address.casefold(),
        label=resolved_label,
        label_normalized=label_normalized or resolved_label.casefold(),
        property_management_company=property_management_company or None,
        property_management_company_normalized=property_management_company_normalized or "",
        status_normalized=status_normalized,
        status_raw=status_raw,
        monthly_route_id=monthly_route_id,
        route_stop_order=route_stop_order,
        **extra,
    )


def seed_route_with_one_stop(
    *,
    route_id: int = 1,
    location_id: int = 101,
    route_number: int = 2,
) -> tuple[int, int]:
    route = MonthlyRoute(
        id=route_id,
        route_number=route_number,
        weekday_iso=0,
        week_occurrence=1,
    )
    loc = make_location(
        id=location_id,
        address="123 Test St",
        label="123 Test St",
        property_management_company="Acme",
        property_management_company_normalized="acme",
        monthly_route_id=route_id,
        route_stop_order=0,
    )
    db.session.add_all([route, loc])
    db.session.commit()
    return route_id, location_id


def seed_route_with_two_stops(
    *,
    route_id: int = 1,
    primary_id: int = 101,
    secondary_id: int = 9002,
    route_number: int | None = None,
) -> tuple[int, int, int]:
    """Route with two flat library locations (primary + secondary stop)."""
    route = MonthlyRoute(
        id=route_id,
        route_number=route_number if route_number is not None else route_id,
        weekday_iso=0,
        week_occurrence=1,
    )
    loc_primary = make_location(
        id=primary_id,
        address="123 Test St",
        label="Tower A",
        property_management_company="Acme",
        property_management_company_normalized="acme",
        monthly_route_id=route_id,
        route_stop_order=0,
        keys="KEY-A",
        ring_detail="R-1",
        latitude=48.4284,
        longitude=-123.3656,
    )
    loc_secondary = make_location(
        id=secondary_id,
        address="123 Test St",
        label="Annex panel",
        property_management_company="Acme",
        property_management_company_normalized="acme",
        monthly_route_id=route_id,
        route_stop_order=1,
        keys="KEY-A",
        ring_detail="R-1B",
    )
    db.session.add_all([route, loc_primary, loc_secondary])
    db.session.commit()
    return route_id, primary_id, secondary_id


def make_location_month(
    *,
    id: int,
    location_id: int,
    month_date: date,
    route_id: int,
    run_id: int | None = None,
    **fields,
) -> MonthlyLocationMonth:
    row = MonthlyLocationMonth(
        id=id,
        monthly_location_id=location_id,
        month_date=month_date,
        test_monthly_route_id=route_id,
        run_id=run_id,
        **fields,
    )
    return row
