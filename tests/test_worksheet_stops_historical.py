"""Portal worksheet stops for prior months (legacy history fallback)."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import (
    MonthlyLocationMonth,
    MonthlyRoute,
    MonthlyRouteRun,
    db,
)
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location

PACIFIC_TZ = ZoneInfo("America/Vancouver")


@pytest.fixture
def stops_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=WORKSHEET_TABLES)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["tech_portal_unlocked"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(WORKSHEET_TABLES)))


def test_prior_month_worksheet_stops_from_history(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc = make_location(
            id=101,
            address="123 Test St",
            label="123 Test St",
            property_management_company="Acme",
            property_management_company_normalized="acme",
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
        mlm = MonthlyLocationMonth(
            id=8001,
            monthly_location_id=101,
            month_date=date(2026, 4, 1),
            result_status="tested",
            sheet_time_in_raw="8:15",
            sheet_time_out_raw="9:00",
            test_monthly_route_id=1,
        )
        db.session.add_all([route, loc, run, mlm])
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


def test_prior_month_stops_exclude_library_only_sites(stops_client, monkeypatch):
    """Prior-month snapshots list attributed history only, not every live library stop."""
    from app.monthly.worksheet_locations import ensure_worksheet_stops_for_route_month, worksheet_stops_for_route_month
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = stops_client
    with app.app_context():
        route = MonthlyRoute(id=8, route_number=8, weekday_iso=3, week_occurrence=1)
        loc_on_sheet = make_location(
            id=801,
            address="800 Johnson Street",
            label="TDMC",
            property_management_company="Invermay",
            property_management_company_normalized="invermay",
            monthly_route_id=8,
            route_stop_order=0,
        )
        loc_library_only = make_location(
            id=899,
            address="999 Library Only Street",
            label="999 Library Only Street",
            property_management_company="Extra",
            property_management_company_normalized="extra",
            monthly_route_id=8,
            route_stop_order=1,
        )
        run = MonthlyRouteRun(
            id=7001,
            monthly_route_id=8,
            month_date=date(2026, 4, 1),
            status="completed",
            source="csv_import",
            field_ended_at=datetime(2026, 4, 15, 12, 0, tzinfo=PACIFIC_TZ),
        )
        mlm = MonthlyLocationMonth(
            id=9001,
            monthly_location_id=801,
            month_date=date(2026, 4, 1),
            result_status="tested",
            test_monthly_route_id=8,
            session_route_stop_order=0,
        )
        db.session.add_all([route, loc_on_sheet, loc_library_only, run, mlm])
        db.session.commit()
        ensure_worksheet_stops_for_route_month(8, date(2026, 4, 1), run)
        db.session.commit()

        stops = worksheet_stops_for_route_month(8, date(2026, 4, 1), include_portal_extras=False)
        assert [int(s["location_id"]) for s in stops] == [801]

    res = client.get("/api/monthly_routes/routes/8/worksheet?month=2026-04-01&tech_portal=1")
    assert res.status_code == 200
    body = res.get_json()
    stop_ids = [int(s["location_id"]) for s in (body.get("stops") or [])]
    assert stop_ids == [801]


def test_prior_month_stops_keep_csv_site_removed_from_library(stops_client, monkeypatch):
    """CSV snapshot sites remain even when the location is no longer on the route library."""
    from app.monthly.worksheet_locations import worksheet_stops_for_route_month
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = stops_client
    with app.app_context():
        route = MonthlyRoute(id=8, route_number=8, weekday_iso=3, week_occurrence=1)
        loc_off_route = make_location(
            id=850,
            address="850 Off Route Street",
            label="850 Off Route Street",
            property_management_company="Former",
            property_management_company_normalized="former",
            monthly_route_id=99,
            route_stop_order=0,
        )
        run = MonthlyRouteRun(
            id=7002,
            monthly_route_id=8,
            month_date=date(2026, 4, 1),
            status="completed",
            source="csv_import",
        )
        mlm = MonthlyLocationMonth(
            id=9002,
            monthly_location_id=850,
            month_date=date(2026, 4, 1),
            result_status="skipped",
            skip_reason="annual",
            test_monthly_route_id=8,
            session_route_stop_order=0,
        )
        db.session.add_all([route, loc_off_route, run, mlm])
        db.session.commit()

        stops = worksheet_stops_for_route_month(8, date(2026, 4, 1), include_portal_extras=False)
        assert [int(s["location_id"]) for s in stops] == [850]
        assert stops[0]["result_status"] == "skipped"

    res = client.get("/api/monthly_routes/routes/8/worksheet?month=2026-04-01&tech_portal=1")
    assert res.status_code == 200
    body = res.get_json()
    assert len(body.get("rows") or []) == 1
    assert int(body["rows"][0]["location_id"]) == 850
    stop_ids = [int(s["location_id"]) for s in (body.get("stops") or [])]
    assert stop_ids == [850]


def test_office_test_outcome_on_relocated_historical_stop(stops_client, monkeypatch):
    """Office may set outcomes on CSV snapshot stops that left the route library."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = stops_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=1, weekday_iso=0, week_occurrence=1)
        loc_relocated = make_location(
            id=850,
            address="1465 Fort Street",
            label="1465 Fort Street",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            monthly_route_id=13,
            route_stop_order=0,
        )
        now = datetime.now(PACIFIC_TZ)
        run = MonthlyRouteRun(
            id=7003,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            opened_at=now,
            prepared_at=now,
            started_at=now,
            field_ended_at=now,
            status="open",
            source="csv_import",
        )
        mlm = MonthlyLocationMonth(
            id=9003,
            monthly_location_id=850,
            month_date=date(2026, 5, 1),
            test_monthly_route_id=1,
            run_id=int(run.id),
            session_route_stop_order=3,
        )
        db.session.add_all([route, loc_relocated, run, mlm])
        db.session.commit()

    with client.session_transaction() as sess:
        sess["username"] = "office_tester"
        sess["authenticated"] = True

    res = client.put(
        "/api/monthly_routes/routes/1/worksheet/locations/850/test_outcome?month=2026-05-01",
        json={
            "test_outcome": "skipped",
            "skip_category": "other",
            "skip_note": "Panel replacement in progress",
        },
    )
    assert res.status_code == 200, res.get_data(as_text=True)
    stop = res.get_json()["stop"]
    assert stop["test_outcome"] == "skipped"
    assert stop["skip_category"] == "other"
