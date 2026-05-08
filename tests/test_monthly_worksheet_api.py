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
    MonthlyRouteWorksheetAuditEvent,
    db,
)

PACIFIC_TZ = ZoneInfo("America/Vancouver")


def _current_pacific_month_first() -> date:
    now = datetime.now(PACIFIC_TZ)
    return date(now.year, now.month, 1)


def _months_before(month_first: date, n: int) -> date:
    y, m = month_first.year, month_first.month - n
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, 1)


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
                MonthlyRouteRun.__table__,
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
                MonthlyRouteRun.__table__,
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


def test_get_worksheet_orders_by_session_route_stop_order(worksheet_client):
    """Per-run ``session_route_stop_order`` (CSV ``#``) overrides library ``route_stop_order`` for sort."""
    client, app = worksheet_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc_a = MonthlyRouteLocation(
            id=101,
            address="AAA First St",
            address_normalized="aaa first st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            route_stop_order=0,
        )
        loc_b = MonthlyRouteLocation(
            id=102,
            address="BBB Second St",
            address_normalized="bbb second st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
            route_stop_order=1,
        )
        db.session.add_all(
            [
                route,
                loc_a,
                loc_b,
                MonthlyRouteTestHistory(
                    id=5001,
                    location_id=101,
                    month_date=date(2026, 5, 1),
                    result_status=None,
                    test_monthly_route_id=1,
                    session_route_stop_order=1,
                ),
                MonthlyRouteTestHistory(
                    id=5002,
                    location_id=102,
                    month_date=date(2026, 5, 1),
                    result_status=None,
                    test_monthly_route_id=1,
                    session_route_stop_order=0,
                ),
            ]
        )
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/1/worksheet?month=2026-05-01")
    assert res.status_code == 200
    body = res.get_json()
    assert [r["location_id"] for r in body["rows"]] == [102, 101]
    assert body["rows"][0]["session_route_stop_order"] == 0
    assert body["rows"][1]["session_route_stop_order"] == 1


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


def _seed_route_for_month(route_id: int, month_first: date, *, status: str = "open") -> int:
    route = MonthlyRoute(
        id=route_id, route_number=route_id + 100, weekday_iso=0, week_occurrence=1
    )
    loc = MonthlyRouteLocation(
        id=route_id * 100 + 1,
        address=f"{route_id} Hist St",
        address_normalized=f"{route_id} hist st",
        property_management_company="Acme",
        property_management_company_normalized="acme",
        building=None,
        building_normalized="",
        status_normalized="active",
        status_raw="Active",
        monthly_route_id=route_id,
    )
    run = MonthlyRouteRun(
        id=route_id * 1000 + 1,
        monthly_route_id=route_id,
        month_date=month_first,
        status=status,
    )
    db.session.add_all([route, loc, run])
    db.session.commit()
    return int(loc.id)


def test_worksheet_run_is_historical_for_past_month(worksheet_client):
    """Months strictly before the current Pacific month flip the run to historical."""
    client, app = worksheet_client
    past = _months_before(_current_pacific_month_first(), 2)
    with app.app_context():
        _seed_route_for_month(7, past, status="open")

    res = client.get(f"/api/monthly_routes/routes/7/worksheet?month={past.isoformat()}")
    assert res.status_code == 200
    body = res.get_json()
    assert body["run"] is not None
    assert body["run"]["is_historical"] is True


def test_worksheet_run_is_historical_when_completed(worksheet_client):
    """``status='completed'`` flips a current-month run to historical immediately."""
    client, app = worksheet_client
    current = _current_pacific_month_first()
    with app.app_context():
        _seed_route_for_month(8, current, status="completed")

    res = client.get(
        f"/api/monthly_routes/routes/8/worksheet?month={current.isoformat()}"
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["run"] is not None
    assert body["run"]["is_historical"] is True


def test_worksheet_run_not_historical_for_open_current_month(worksheet_client):
    """Current Pacific month + open status → the worksheet stays in edit mode."""
    client, app = worksheet_client
    current = _current_pacific_month_first()
    with app.app_context():
        _seed_route_for_month(9, current, status="open")

    res = client.get(
        f"/api/monthly_routes/routes/9/worksheet?month={current.isoformat()}"
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["run"] is not None
    assert body["run"]["is_historical"] is False
