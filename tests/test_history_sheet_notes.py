"""Testing procedures / tech notes: run history vs library latest-run display."""

from datetime import date

import pytest

from app import create_app
from app.db_models import (
    Key,
    MonitoringCompany,
    MonthlyLocation,
    MonthlyLocationComment,
    MonthlyLocationMonth,
    MonthlyRoute,
    MonthlyRouteRun,
    MonthlyRouteWorksheetAuditEvent,
    db,
)
from app.monthly.history_sheet_notes import (
    is_latest_history_month_for_location,
    latest_run_notes_for_location,
)
from app.monthly.route_inspection_csv_import import run_route_inspection_csv_import
from app.monthly.runs import get_or_create_monthly_route_run
from tests.monthly_location_helpers import make_location


@pytest.fixture
def notes_client(monkeypatch, tmp_path):
    db_file = tmp_path / "history_notes.db"
    uri = f"sqlite:///{db_file.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", uri)
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = uri
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(
            db.engine,
            tables=[
                MonthlyRoute.__table__,
                Key.__table__,
                MonitoringCompany.__table__,
                MonthlyLocation.__table__,
                MonthlyRouteRun.__table__,
                MonthlyLocationMonth.__table__,
                MonthlyRouteWorksheetAuditEvent.__table__,
                MonthlyLocationComment.__table__,
            ],
        )
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["username"] = "staff"
                sess["authenticated"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(
            db.engine,
            tables=[
                MonthlyLocationComment.__table__,
                MonthlyRouteWorksheetAuditEvent.__table__,
                MonthlyLocationMonth.__table__,
                MonthlyRouteRun.__table__,
                MonthlyLocation.__table__,
                MonitoringCompany.__table__,
                Key.__table__,
                MonthlyRoute.__table__,
            ],
        )


def _seed_loc() -> tuple[MonthlyRoute, MonthlyLocation]:
    route = MonthlyRoute(id=8, route_number=8, weekday_iso=3, week_occurrence=1)
    loc = make_location(
        id=801,
        address="800 Johnson Street",
        label="TDMC Holdings",
        property_management_company="Invermay",
        property_management_company_normalized="invermay",
        monthly_route_id=8,
        testing_procedures="Library current procedures",
        inspection_tech_notes="Library current notes",
    )
    db.session.add_all([route, loc])
    db.session.commit()
    return route, loc


def test_latest_run_notes_prefers_newer_history_month(notes_client):
    _client, app = notes_client
    with app.app_context():
        _route, loc = _seed_loc()
        db.session.add_all(
            [
                MonthlyLocationMonth(
                    id=9001,
                    monthly_location_id=loc.id,
                    month_date=date(2026, 4, 1),
                    result_status="tested",
                    testing_procedures="April procedures",
                    inspection_tech_notes="April notes",
                    test_monthly_route_id=8,
                ),
                MonthlyLocationMonth(
                    id=9002,
                    monthly_location_id=loc.id,
                    month_date=date(2026, 5, 1),
                    result_status="tested",
                    testing_procedures="May procedures",
                    inspection_tech_notes="May notes",
                    test_monthly_route_id=8,
                ),
            ]
        )
        db.session.commit()
        tp, tn = latest_run_notes_for_location(int(loc.id))
        assert tp == "May procedures"
        assert tn == "May notes"


def test_csv_import_does_not_overwrite_library_notes_for_older_month(notes_client):
    _client, app = notes_client
    with app.app_context():
        route, loc = _seed_loc()
        db.session.add(
            MonthlyLocationMonth(
                id=9002,
                monthly_location_id=loc.id,
                month_date=date(2026, 5, 1),
                result_status="tested",
                testing_procedures="May procedures",
                inspection_tech_notes="May notes",
                test_monthly_route_id=8,
            )
        )
        db.session.commit()

        csv_rows = [
            ",,,,,,,,,,,",
            "MONTHLY BELL TESTING,,,,,,,,,,,",
            ",,,,,,,,,,,",
            ",ROUTE:,1st Thurs,,Route 8,Downtown 1,,,,,,",
            ",DATE:,April,,2026,,,,,,,",
            ",,,,,,,,,,,",
            "#,Address,Annual,Ring,Key #,FACP,Monitoring,Testing Procedures,Tech Comments & Notes,Time In:,Time Out:",
            '1,"800 Johnson Street\nName:TDMC Holdings\nManagement: Invermay",July,R1,TH008,EDWARDS 6632,Telus,April proc only,April note only,,',
        ]
        csv_bytes = ("\r\n".join(csv_rows) + "\r\n").encode("utf-8")
        run = get_or_create_monthly_route_run(int(route.id), date(2026, 4, 1), source="csv_import")
        run_route_inspection_csv_import(
            csv_bytes=csv_bytes,
            run=run,
            route=route,
            month_date=date(2026, 4, 1),
            dry_run=False,
        )

        hist_april = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=loc.id, month_date=date(2026, 4, 1)
        ).one()
        assert hist_april.testing_procedures == "April proc only"
        assert hist_april.inspection_tech_notes == "April note only"

        loc_after = db.session.get(MonthlyLocation, loc.id)
        assert loc_after.testing_procedures == "Library current procedures"
        assert loc_after.inspection_tech_notes == "Library current notes"

        assert is_latest_history_month_for_location(int(loc.id), date(2026, 4, 1)) is False


def test_worksheet_historical_month_shows_history_not_library(notes_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = notes_client
    with app.app_context():
        route = MonthlyRoute(id=8, route_number=8, weekday_iso=3, week_occurrence=1)
        loc = make_location(
            id=801,
            address="800 Johnson Street",
            label="TDMC",
            property_management_company="Invermay",
            property_management_company_normalized="invermay",
            monthly_route_id=8,
            testing_procedures="Only on library",
            inspection_tech_notes="Only on library notes",
        )
        run = MonthlyRouteRun(
            id=7001,
            monthly_route_id=8,
            month_date=date(2026, 4, 1),
            status="completed",
            source="csv_import",
        )
        hist = MonthlyLocationMonth(
            id=9001,
            monthly_location_id=801,
            month_date=date(2026, 4, 1),
            result_status="tested",
            testing_procedures="April on history",
            inspection_tech_notes="April history notes",
            test_monthly_route_id=8,
            run_id=7001,
        )
        db.session.add_all([route, loc, run, hist])
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/8/worksheet?month=2026-04-01")
    assert res.status_code == 200
    body = res.get_json()
    rows = body.get("locations") or body.get("rows") or []
    assert len(rows) == 1
    assert rows[0]["testing_procedures"] == "April on history"
    assert rows[0]["inspection_tech_notes"] == "April history notes"


def test_library_location_shows_latest_run_notes(notes_client):
    client, app = notes_client
    with app.app_context():
        _route, loc = _seed_loc()
        location_id = int(loc.id)
        db.session.add_all(
            [
                MonthlyLocationMonth(
                    id=9001,
                    monthly_location_id=loc.id,
                    month_date=date(2026, 4, 1),
                    result_status="tested",
                    testing_procedures="April procedures",
                    inspection_tech_notes="April notes",
                    test_monthly_route_id=8,
                ),
                MonthlyLocationMonth(
                    id=9002,
                    monthly_location_id=loc.id,
                    month_date=date(2026, 5, 1),
                    result_status="tested",
                    testing_procedures="May procedures",
                    inspection_tech_notes="May notes",
                    test_monthly_route_id=8,
                ),
            ]
        )
        db.session.commit()

    res = client.get(f"/api/monthly_routes/library/{location_id}")
    assert res.status_code == 200
    loc_payload = res.get_json()["location"]
    assert loc_payload["testing_procedures"] == "May procedures"
    assert loc_payload["inspection_tech_notes"] == "May notes"


def test_library_patch_testing_procedures_updates_latest_history_and_response(notes_client):
    client, app = notes_client
    with app.app_context():
        _route, loc = _seed_loc()
        db.session.add(
            MonthlyLocationMonth(
                id=9002,
                monthly_location_id=loc.id,
                month_date=date(2026, 5, 1),
                result_status="tested",
                testing_procedures="May procedures",
                inspection_tech_notes="May notes",
                test_monthly_route_id=8,
            )
        )
        db.session.commit()
        location_id = int(loc.id)

    long_text = ("Ring bells by 7:45. " * 40).strip()
    res = client.patch(
        f"/api/monthly_routes/library/{location_id}",
        json={"testing_procedures": long_text},
    )
    assert res.status_code == 200
    loc_payload = res.get_json()["location"]
    assert loc_payload["testing_procedures"] == long_text

    with app.app_context():
        loc_after = db.session.get(MonthlyLocation, location_id)
        assert loc_after.testing_procedures == long_text
        latest = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=location_id,
            month_date=date(2026, 5, 1),
        ).one()
        assert latest.testing_procedures == long_text
