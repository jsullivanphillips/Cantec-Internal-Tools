"""Portal worksheet stops for prior months (legacy history fallback)."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import (
    Key,
    MonitoringCompany,
    MonthlyRoute,
    MonthlyRouteLocation,
    MonthlyRouteRun,
    MonthlyRouteTestHistory,
    MonthlySite,
    MonthlyTestingSite,
    MonthlyTestingSiteMonth,
    db,
)

PACIFIC_TZ = ZoneInfo("America/Vancouver")


@pytest.fixture
def stops_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    tables = [
        Key.__table__,
        MonitoringCompany.__table__,
        MonthlyRoute.__table__,
        MonthlyRouteLocation.__table__,
        MonthlyRouteRun.__table__,
        MonthlyRouteTestHistory.__table__,
        MonthlySite.__table__,
        MonthlyTestingSite.__table__,
        MonthlyTestingSiteMonth.__table__,
    ]

    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["tech_portal_unlocked"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


def test_prior_month_worksheet_stops_from_history(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc = MonthlyRouteLocation(
            id=101,
            address="123 Test St",
            address_normalized="123 test st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            route_stop_order=0,
        )
        run = MonthlyRouteRun(
            id=5001,
            monthly_route_id=1,
            month_date=date(2026, 4, 1),
            opened_at=datetime(2026, 4, 2, 8, 0, tzinfo=PACIFIC_TZ),
            started_at=datetime(2026, 4, 2, 9, 0, tzinfo=PACIFIC_TZ),
            completed_at=datetime(2026, 4, 2, 17, 0, tzinfo=PACIFIC_TZ),
            status="completed",
            source="technician_app",
        )
        hist = MonthlyRouteTestHistory(
            id=8001,
            location_id=101,
            month_date=date(2026, 4, 1),
            result_status="tested",
            sheet_time_in_raw="8:15",
            sheet_time_out_raw="9:00",
            test_monthly_route_id=1,
        )
        db.session.add_all([route, loc, run, hist])
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/1/worksheet?month=2026-04-01&tech_portal=1")
    assert res.status_code == 200
    body = res.get_json()
    assert body["run"] is not None
    assert body["run"]["is_historical"] is True
    stops = body.get("stops") or []
    assert len(stops) == 1
    assert stops[0]["display_address"] == "123 Test St"
    assert stops[0]["result_status"] == "tested"
    assert stops[0]["time_in"] == "8:15"
    assert stops[0]["time_out"] == "9:00"
