from datetime import date

import pytest

from app import create_app
from app.db_models import (
    Key,
    MonitoringCompany,
    MonthlyRoute,
    MonthlyRouteLocation,
    MonthlyRouteTestHistory,
    MonthlyRouteWorksheetAuditEvent,
    db,
)


@pytest.fixture
def worksheet_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(
            db.engine,
            tables=[
                MonthlyRoute.__table__,
                Key.__table__,
                MonitoringCompany.__table__,
                MonthlyRouteLocation.__table__,
                MonthlyRouteTestHistory.__table__,
                MonthlyRouteWorksheetAuditEvent.__table__,
            ],
        )
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["username"] = "tech.one"
                sess["authenticated"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(
            db.engine,
            tables=[
                MonthlyRouteWorksheetAuditEvent.__table__,
                MonthlyRouteTestHistory.__table__,
                MonthlyRouteLocation.__table__,
                MonitoringCompany.__table__,
                Key.__table__,
                MonthlyRoute.__table__,
            ],
        )


def _seed_basic_route_data():
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
        annual_month="May",
    )
    hist = MonthlyRouteTestHistory(
        id=5001,
        location_id=101,
        month_date=date(2026, 5, 1),
        result_status="tested",
        test_monthly_route_id=1,
    )
    db.session.add_all([route, loc, hist])
    db.session.commit()
    return route, loc, hist


def test_get_worksheet_returns_rows(worksheet_client):
    client, app = worksheet_client
    with app.app_context():
        _seed_basic_route_data()

    res = client.get("/api/monthly_routes/routes/1/worksheet?month=2026-05-01")
    assert res.status_code == 200
    body = res.get_json()
    assert body["route"]["id"] == 1
    assert len(body["rows"]) == 1
    assert body["rows"][0]["display_address"] == "123 Test St"


def test_patch_worksheet_row_writes_audit(worksheet_client):
    client, app = worksheet_client
    with app.app_context():
        _, _, hist = _seed_basic_route_data()
        expected = hist.updated_at.isoformat() if hist.updated_at else None

    res = client.patch(
        "/api/monthly_routes/routes/1/worksheet/rows/101?month=2026-05-01",
        json={
            "expected_updated_at": expected,
            "client_mutation_id": "mut-1",
            "changes": {"testing_procedures": "TURN OFF BREAKER", "time_in": "9:48"},
        },
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["ok"] is True
    assert body["row"]["testing_procedures"] == "TURN OFF BREAKER"
    assert body["row"]["time_in"] == "9:48"

    with app.app_context():
        events = MonthlyRouteWorksheetAuditEvent.query.filter_by(location_id=101).all()
        assert len(events) == 2
        assert {e.field_name for e in events} == {"testing_procedures", "time_in"}


def test_patch_worksheet_row_stale_version_client_wins(worksheet_client):
    client, app = worksheet_client
    with app.app_context():
        _, _, hist = _seed_basic_route_data()
        hist.testing_procedures = "server change"
        db.session.commit()
        stale_expected = "2026-01-01T00:00:00+00:00"
        assert hist.updated_at is not None

    res = client.patch(
        "/api/monthly_routes/routes/1/worksheet/rows/101?month=2026-05-01",
        json={
            "expected_updated_at": stale_expected,
            "changes": {"testing_procedures": "client change"},
        },
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["ok"] is True
    assert body["row"]["testing_procedures"] == "client change"
