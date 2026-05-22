from datetime import date, datetime, timezone
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


@pytest.fixture
def hybrid_portal_staff_client(monkeypatch):
    """Staff session and PIN portal unlocked (common when testing ``/tech/`` while logged into office)."""
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
                sess["username"] = "staff.one"
                sess["authenticated"] = True
                sess["tech_portal_unlocked"] = True
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


@pytest.fixture
def portal_only_client(monkeypatch):
    """PIN portal session without ``authenticated`` (lazy worksheet run creation)."""
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
                sess["tech_portal_unlocked"] = True
                sess.pop("authenticated", None)
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


def test_worksheet_reset_run_clears_non_annual_preserves_annual(worksheet_client):
    client, app = worksheet_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc_a = MonthlyRouteLocation(
            id=101,
            address="111 Oak St",
            address_normalized="111 oak st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
        )
        loc_b = MonthlyRouteLocation(
            id=102,
            address="222 Elm St",
            address_normalized="222 elm st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
        )
        run = MonthlyRouteRun(
            id=9001,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            started_at=datetime(2026, 5, 2, 10, 0, 0, tzinfo=PACIFIC_TZ),
            status="open",
            source="technician_app",
        )
        h_clear = MonthlyRouteTestHistory(
            id=8001,
            location_id=101,
            month_date=date(2026, 5, 1),
            result_status="tested",
            sheet_time_in_raw="8am",
            sheet_time_out_raw="9am",
            test_monthly_route_id=1,
        )
        h_annual = MonthlyRouteTestHistory(
            id=8002,
            location_id=102,
            month_date=date(2026, 5, 1),
            result_status="skipped",
            skip_reason="annual",
            test_monthly_route_id=1,
        )
        db.session.add_all([route, loc_a, loc_b, run, h_clear, h_annual])
        db.session.commit()

    res = client.post("/api/monthly_routes/routes/1/worksheet/reset_run?month=2026-05-01", json={})
    assert res.status_code == 200, res.get_data(as_text=True)
    body = res.get_json()
    assert body["ok"] is True
    assert body["cleared_rows"] == 1
    assert body["preserved_annual_skip_rows"] == 1
    assert body["worksheet"]["run"] is not None
    assert body["worksheet"]["run"]["started_at"] is None
    rows_by_loc = {int(r["location_id"]): r for r in body["worksheet"]["rows"]}
    assert rows_by_loc[101]["time_in"] is None
    assert rows_by_loc[101]["time_out"] is None
    assert rows_by_loc[102]["result_status"] == "skipped"
    assert (rows_by_loc[102]["skip_reason"] or "").strip().lower() == "annual"

    with app.app_context():
        r1 = db.session.get(MonthlyRouteTestHistory, 8001)
        assert r1 is not None
        assert r1.result_status is None
        assert r1.sheet_time_in_raw is None
        assert r1.sheet_time_out_raw is None
        r2 = db.session.get(MonthlyRouteTestHistory, 8002)
        assert r2 is not None
        assert r2.result_status == "skipped"
        assert (r2.skip_reason or "").strip().lower() == "annual"
        run_after = db.session.get(MonthlyRouteRun, 9001)
        assert run_after is not None
        assert run_after.started_at is None


def test_worksheet_reset_run_rejects_completed(worksheet_client):
    client, app = worksheet_client
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
        )
        run = MonthlyRouteRun(
            id=9101,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            status="completed",
            completed_at=datetime.now(PACIFIC_TZ),
            source="technician_app",
        )
        hist = MonthlyRouteTestHistory(
            id=9201,
            location_id=101,
            month_date=date(2026, 5, 1),
            result_status="tested",
            sheet_time_in_raw="7am",
            test_monthly_route_id=1,
        )
        db.session.add_all([route, loc, run, hist])
        db.session.commit()

    res = client.post("/api/monthly_routes/routes/1/worksheet/reset_run?month=2026-05-01", json={})
    assert res.status_code == 409


def test_get_routes_overview_returns_route_links_payload(worksheet_client):
    client, app = worksheet_client
    with app.app_context():
        route = MonthlyRoute(id=31, route_number=31, weekday_iso=0, week_occurrence=1)
        loc = MonthlyRouteLocation(
            id=3101,
            address="310 Test St",
            address_normalized="310 test st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=31,
        )
        db.session.add_all(
            [
                route,
                loc,
                MonthlyRouteTestHistory(
                    id=31001,
                    location_id=3101,
                    month_date=date(2026, 1, 1),
                    result_status="skipped",
                    skip_reason="no access",
                    test_monthly_route_id=31,
                ),
                MonthlyRouteTestHistory(
                    id=31002,
                    location_id=3101,
                    month_date=date(2025, 12, 1),
                    result_status="tested",
                    test_monthly_route_id=31,
                ),
            ]
        )
        db.session.commit()

    res = client.get("/api/monthly_routes/routes")
    assert res.status_code == 200
    body = res.get_json()
    row = next((r for r in (body.get("routes") or []) if r["route"]["id"] == 31), None)
    assert row is not None
    assert row["route"]["label"].startswith("R31")
    assert "last_tested_month" not in row
    assert "skipped_non_annual_count" not in row
    assert "next_test_date" not in row


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


def test_patch_worksheet_row_clear_skipped_resets_outcome(worksheet_client):
    client, app = worksheet_client
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
        )
        hist = MonthlyRouteTestHistory(
            id=5001,
            location_id=101,
            month_date=date(2026, 5, 1),
            result_status="skipped",
            skip_reason="Gate locked",
            sheet_time_in_raw="note",
            sheet_time_out_raw="10:00",
            test_monthly_route_id=1,
        )
        db.session.add_all([route, loc, hist])
        db.session.commit()

    res = client.patch(
        "/api/monthly_routes/routes/1/worksheet/rows/101?month=2026-05-01",
        json={"changes": {"result_status": None}},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["ok"] is True
    row = body["row"]
    assert row["result_status"] is None
    assert row["skip_reason"] is None
    assert row["time_in"] is None
    assert row["time_out"] is None


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


def test_patch_worksheet_row_monitoring_writes_monitoring_notes(worksheet_client):
    client, app = worksheet_client
    with app.app_context():
        _seed_basic_route_data()

    res = client.patch(
        "/api/monthly_routes/routes/1/worksheet/rows/101?month=2026-05-01",
        json={"changes": {"monitoring": "Central station updated"}},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["ok"] is True
    assert body["row"]["monitoring"] == "Central station updated"

    with app.app_context():
        row = MonthlyRouteTestHistory.query.filter_by(location_id=101).one()
        assert (row.monitoring_notes or "").strip() == "Central station updated"


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


def test_patch_worksheet_row_outcome_rejected_when_run_completed(worksheet_client):
    """Completed/closed runs cannot change tested/skipped via PATCH until reopened."""
    client, app = worksheet_client
    current = _current_pacific_month_first()
    with app.app_context():
        loc_id = _seed_route_for_month(11, current, status="completed")
        hist = MonthlyRouteTestHistory(
            id=119999,
            location_id=loc_id,
            month_date=current,
            result_status=None,
            test_monthly_route_id=11,
        )
        db.session.add(hist)
        db.session.commit()

    month_q = current.isoformat()
    res = client.patch(
        f"/api/monthly_routes/routes/11/worksheet/rows/{loc_id}?month={month_q}",
        json={"changes": {"result_status": "tested"}},
    )
    assert res.status_code == 409
    assert res.get_json().get("code") == "run_completed_outcome_locked"

    res_skip_key = client.patch(
        f"/api/monthly_routes/routes/11/worksheet/rows/{loc_id}?month={month_q}",
        json={"changes": {"skip_reason": "annual"}},
    )
    assert res_skip_key.status_code == 409

    res_facp = client.patch(
        f"/api/monthly_routes/routes/11/worksheet/rows/{loc_id}?month={month_q}",
        json={"changes": {"facp": "Panel OK"}},
    )
    assert res_facp.status_code == 200
    assert res_facp.get_json()["row"]["facp"] == "Panel OK"


def test_patch_outcome_rejected_office_when_field_run_active(worksheet_client):
    """Authenticated office PATCH cannot change outcomes while technicians have started the run."""
    client, app = worksheet_client
    current = _current_pacific_month_first()
    with app.app_context():
        loc_id = _seed_route_for_month(12, current, status="open")
        run = MonthlyRouteRun.query.filter_by(monthly_route_id=12, month_date=current).one()
        run.started_at = datetime.now(timezone.utc)
        db.session.add(
            MonthlyRouteTestHistory(
                id=129999,
                location_id=loc_id,
                month_date=current,
                result_status=None,
                test_monthly_route_id=12,
            )
        )
        db.session.commit()

    month_q = current.isoformat()
    res = client.patch(
        f"/api/monthly_routes/routes/12/worksheet/rows/{loc_id}?month={month_q}",
        json={"changes": {"result_status": "tested"}},
    )
    assert res.status_code == 409
    assert res.get_json().get("code") == "run_active_office_outcome_locked"


def test_patch_outcome_allowed_tech_portal_query_when_field_run_active(worksheet_client):
    """Staff session acting as technician worksheet (``tech_portal=1``) may PATCH outcomes during active run."""
    client, app = worksheet_client
    current = _current_pacific_month_first()
    with app.app_context():
        loc_id = _seed_route_for_month(13, current, status="open")
        run = MonthlyRouteRun.query.filter_by(monthly_route_id=13, month_date=current).one()
        run.started_at = datetime.now(timezone.utc)
        db.session.add(
            MonthlyRouteTestHistory(
                id=139999,
                location_id=loc_id,
                month_date=current,
                result_status=None,
                test_monthly_route_id=13,
            )
        )
        db.session.commit()

    month_q = current.isoformat()
    res = client.patch(
        f"/api/monthly_routes/routes/13/worksheet/rows/{loc_id}?month={month_q}&tech_portal=1",
        json={"changes": {"result_status": "tested"}},
    )
    assert res.status_code == 200
    assert res.get_json()["row"]["result_status"] == "tested"


def test_patch_outcome_allowed_portal_only_when_field_run_active(portal_only_client):
    """PIN-only portal session is not treated as office staff; outcomes PATCH succeeds during active run."""
    client, app = portal_only_client
    current = _current_pacific_month_first()
    with app.app_context():
        loc_id = _seed_route_for_month(14, current, status="open")
        run = MonthlyRouteRun.query.filter_by(monthly_route_id=14, month_date=current).one()
        run.started_at = datetime.now(timezone.utc)
        db.session.add(
            MonthlyRouteTestHistory(
                id=149999,
                location_id=loc_id,
                month_date=current,
                result_status=None,
                test_monthly_route_id=14,
            )
        )
        db.session.commit()

    month_q = current.isoformat()
    res = client.patch(
        f"/api/monthly_routes/routes/14/worksheet/rows/{loc_id}?month={month_q}",
        json={"changes": {"result_status": "tested"}},
    )
    assert res.status_code == 200


def test_get_worksheet_hydrates_missing_snapshot_fields_from_prior_run(worksheet_client):
    client, app = worksheet_client
    with app.app_context():
        route = MonthlyRoute(id=21, route_number=21, weekday_iso=0, week_occurrence=1)
        loc = MonthlyRouteLocation(
            id=2101,
            address="210 Seed St",
            address_normalized="210 seed st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=21,
        )
        db.session.add_all(
            [
                route,
                loc,
                MonthlyRouteTestHistory(
                    id=21001,
                    location_id=2101,
                    month_date=date(2026, 4, 1),
                    result_status="tested",
                    test_monthly_route_id=21,
                    testing_procedures="Prev Proc",
                    inspection_tech_notes="Prev Note",
                ),
                # Existing current-month row (e.g. legacy/import) with missing snapshots.
                MonthlyRouteTestHistory(
                    id=21002,
                    location_id=2101,
                    month_date=date(2026, 5, 1),
                    result_status=None,
                    test_monthly_route_id=21,
                    testing_procedures=None,
                    inspection_tech_notes=None,
                ),
            ]
        )
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/21/worksheet?month=2026-05-01")
    assert res.status_code == 200
    body = res.get_json()
    assert len(body["rows"]) == 1
    assert body["rows"][0]["testing_procedures"] == "Prev Proc"
    assert body["rows"][0]["inspection_tech_notes"] == "Prev Note"


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


def test_staff_worksheet_auto_creates_run_when_missing(worksheet_client, monkeypatch):
    """Staff GET worksheet materializes ``MonthlyRouteRun`` for the Pacific current month only."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 7, 1))

    client, app = worksheet_client
    with app.app_context():
        route = MonthlyRoute(id=96, route_number=96, weekday_iso=0, week_occurrence=1)
        loc = MonthlyRouteLocation(
            id=9601,
            address="96 Staff Auto Run St",
            address_normalized="96 staff auto run st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=96,
        )
        db.session.add_all([route, loc])
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/96/worksheet?month=2026-07-01")
    assert res.status_code == 200
    body = res.get_json()
    assert body["run"] is not None
    assert len(body["rows"]) == 1


def test_past_month_no_records_returns_empty(worksheet_client, monkeypatch):
    """Non-current month with no run/history returns empty worksheet without DB writes."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = worksheet_client
    with app.app_context():
        route = MonthlyRoute(id=10, route_number=10, weekday_iso=0, week_occurrence=1)
        loc = MonthlyRouteLocation(
            id=1001,
            address="10 Past Empty St",
            address_normalized="10 past empty st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=10,
        )
        db.session.add_all([route, loc])
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/10/worksheet?month=2026-03-01")
    assert res.status_code == 200
    body = res.get_json()
    assert body["run"] is None
    assert body["rows"] == []

    with app.app_context():
        assert MonthlyRouteRun.query.filter_by(monthly_route_id=10, month_date=date(2026, 3, 1)).count() == 0
        assert MonthlyRouteTestHistory.query.filter_by(month_date=date(2026, 3, 1)).count() == 0


def test_past_month_shows_stamped_row_after_site_moved(worksheet_client, monkeypatch):
    """Attributed history remains visible on the old route after reassignment."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = worksheet_client
    march = date(2026, 3, 1)
    with app.app_context():
        route_a = MonthlyRoute(id=20, route_number=20, weekday_iso=0, week_occurrence=1)
        route_b = MonthlyRoute(id=21, route_number=21, weekday_iso=1, week_occurrence=1)
        loc = MonthlyRouteLocation(
            id=2001,
            address="20 Moved Site St",
            address_normalized="20 moved site st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=21,
        )
        run = MonthlyRouteRun(
            id=20001,
            monthly_route_id=20,
            month_date=march,
            status="completed",
            source="technician_app",
        )
        hist = MonthlyRouteTestHistory(
            id=30001,
            location_id=2001,
            month_date=march,
            result_status="tested",
            test_monthly_route_id=20,
            run_id=20001,
        )
        db.session.add_all([route_a, route_b, loc, run, hist])
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/20/worksheet?month=2026-03-01")
    assert res.status_code == 200
    body = res.get_json()
    assert len(body["rows"]) == 1
    assert body["rows"][0]["location_id"] == 2001
    assert body["rows"][0]["result_status"] == "tested"


def test_past_month_does_not_show_site_added_later(worksheet_client, monkeypatch):
    """March worksheet must not materialize a location added to the route after March."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = worksheet_client
    march = date(2026, 3, 1)
    with app.app_context():
        route = MonthlyRoute(id=30, route_number=30, weekday_iso=0, week_occurrence=1)
        loc_a = MonthlyRouteLocation(
            id=3001,
            address="30A March Only St",
            address_normalized="30a march only st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=30,
        )
        loc_b = MonthlyRouteLocation(
            id=3002,
            address="30B Added Later St",
            address_normalized="30b added later st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=30,
        )
        run = MonthlyRouteRun(
            id=30001,
            monthly_route_id=30,
            month_date=march,
            status="completed",
            source="technician_app",
        )
        hist_a = MonthlyRouteTestHistory(
            id=40001,
            location_id=3001,
            month_date=march,
            result_status="tested",
            test_monthly_route_id=30,
            run_id=30001,
        )
        db.session.add_all([route, loc_a, loc_b, run, hist_a])
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/30/worksheet?month=2026-03-01")
    assert res.status_code == 200
    body = res.get_json()
    loc_ids = {r["location_id"] for r in body["rows"]}
    assert loc_ids == {3001}

    with app.app_context():
        assert (
            MonthlyRouteTestHistory.query.filter_by(
                location_id=3002, month_date=march
            ).count()
            == 0
        )


def test_portal_worksheet_preview_without_monthly_route_run(portal_only_client, monkeypatch):
    """Portal GET returns read-only preview rows when no ``MonthlyRouteRun`` exists yet."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = portal_only_client
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
            annual_month="May",
        )
        db.session.add_all([route, loc])
        db.session.commit()

    res = client.get("/api/monthly_routes/routes/1/worksheet?month=2026-05-01")
    assert res.status_code == 200
    body = res.get_json()
    assert body.get("run") is None
    assert len(body.get("rows") or []) == 1
    assert body["rows"][0]["display_address"] == "123 Test St"


def test_portal_post_runs_then_get_worksheet(portal_only_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = portal_only_client
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
            annual_month="May",
        )
        db.session.add_all([route, loc])
        db.session.commit()

    post = client.post("/api/technician_portal/routes/1/runs")
    assert post.status_code == 200
    started = post.get_json()
    assert started["run"]["month_date"] == "2026-05-01"
    assert started["run"]["opened_at"] is not None
    assert started["run"]["started_at"] is not None

    res = client.get("/api/monthly_routes/routes/1/worksheet?month=2026-05-01")
    assert res.status_code == 200
    body = res.get_json()
    assert body["run"] is not None
    assert len(body["rows"]) == 1


def test_portal_reopen_completed_run(portal_only_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = portal_only_client
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
            annual_month="May",
        )
        run = MonthlyRouteRun(
            id=5001,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            opened_at=datetime(2026, 5, 1, 10, 0, tzinfo=PACIFIC_TZ),
            started_at=datetime(2026, 5, 1, 10, 5, tzinfo=PACIFIC_TZ),
            completed_at=datetime(2026, 5, 1, 14, 0, tzinfo=PACIFIC_TZ),
            status="completed",
            source="technician_app",
        )
        db.session.add_all([route, loc, run])
        db.session.commit()

    res = client.post(
        "/api/technician_portal/routes/1/runs/reopen",
        json={"month_date": "2026-05-01"},
        content_type="application/json",
    )
    assert res.status_code == 200, res.get_data(as_text=True)
    body = res.get_json()
    assert body["run"]["status"] == "open"
    assert body["run"]["completed_at"] is None


def test_portal_route_summary(portal_only_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = portal_only_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=16, weekday_iso=0, week_occurrence=1)
        loc = MonthlyRouteLocation(
            id=101,
            address="R16 St",
            address_normalized="r16 st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=1,
        )
        prior = MonthlyRouteRun(
            id=9001,
            monthly_route_id=1,
            month_date=date(2026, 4, 1),
            status="open",
            source="technician_app",
        )
        db.session.add_all([route, loc, prior])
        db.session.commit()

    res = client.get("/api/technician_portal/routes/1/portal_route_summary")
    assert res.status_code == 200
    body = res.get_json()
    assert body["route"]["route_number"] == 16
    assert body["current_month_first"] == "2026-05-01"
    assert body["current_month_run"] is None
    assert len(body["prior_runs"]) == 1
    assert body["prior_runs"][0]["month_date"] == "2026-04-01"


def test_hybrid_staff_portal_uses_tech_portal_param_for_lazy_worksheet(monkeypatch, hybrid_portal_staff_client):
    """``/tech/`` worksheet reads must pass ``tech_portal=1`` or staff GET behaves like staff materialization."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = hybrid_portal_staff_client
    with app.app_context():
        route = MonthlyRoute(id=79, route_number=79, weekday_iso=0, week_occurrence=1)
        loc = MonthlyRouteLocation(
            id=7901,
            address="Hybrid Lazy St",
            address_normalized="hybrid lazy st",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            building=None,
            building_normalized="",
            status_normalized="active",
            status_raw="Active",
            monthly_route_id=79,
            annual_month="May",
        )
        run = MonthlyRouteRun(
            id=79001,
            monthly_route_id=79,
            month_date=date(2026, 5, 1),
            started_at=None,
            status="open",
            source="office_manual",
        )
        db.session.add_all([route, loc, run])
        db.session.commit()

    res_lazy = client.get(
        "/api/monthly_routes/routes/79/worksheet?month=2026-05-01&tech_portal=1",
    )
    assert res_lazy.status_code == 200
    lazy_body = res_lazy.get_json()
    assert lazy_body["run"] is not None
    assert lazy_body["run"]["started_at"] is None
    assert lazy_body["run"]["opened_at"] is not None
    with app.app_context():
        run_row = MonthlyRouteRun.query.filter_by(monthly_route_id=79, month_date=date(2026, 5, 1)).one()
        assert run_row.started_at is None

    res_staff = client.get("/api/monthly_routes/routes/79/worksheet?month=2026-05-01")
    assert res_staff.status_code == 200
    staff_body = res_staff.get_json()
    assert staff_body["run"]["started_at"] is None
    assert staff_body["run"]["opened_at"] is not None

    with app.app_context():
        run_row = MonthlyRouteRun.query.filter_by(monthly_route_id=79, month_date=date(2026, 5, 1)).one()
        run_row.started_at = None
        db.session.commit()

    res_lazy_after = client.get(
        "/api/monthly_routes/routes/79/worksheet?month=2026-05-01&tech_portal=1",
    )
    assert res_lazy_after.get_json()["run"]["started_at"] is None
    with app.app_context():
        run_row = MonthlyRouteRun.query.filter_by(monthly_route_id=79, month_date=date(2026, 5, 1)).one()
        assert run_row.started_at is None


def test_portal_routes_lookup_accepts_r_prefix(portal_only_client):
    client, app = portal_only_client
    with app.app_context():
        route = MonthlyRoute(id=55, route_number=18, weekday_iso=1, week_occurrence=3)
        db.session.add(route)
        db.session.commit()
    res = client.get("/api/technician_portal/routes_lookup?route_number=R18")
    assert res.status_code == 200
    assert res.get_json()["route"]["route_number"] == 18


def test_portal_routes_suggest_orders_exact_first(portal_only_client):
    client, app = portal_only_client
    with app.app_context():
        rows = [
            MonthlyRoute(id=201, route_number=1, weekday_iso=0, week_occurrence=1),
            MonthlyRoute(id=202, route_number=12, weekday_iso=0, week_occurrence=1),
            MonthlyRoute(id=203, route_number=13, weekday_iso=0, week_occurrence=1),
            MonthlyRoute(id=204, route_number=100, weekday_iso=0, week_occurrence=1),
            MonthlyRoute(id=205, route_number=18, weekday_iso=0, week_occurrence=1),
        ]
        db.session.add_all(rows)
        db.session.commit()
    res = client.get("/api/technician_portal/routes_suggest?q=1")
    assert res.status_code == 200
    nums = [r["route_number"] for r in res.get_json()["routes"]]
    assert nums == [1, 12, 13, 18, 100]


def test_portal_routes_suggest_accepts_r_prefix(portal_only_client):
    client, app = portal_only_client
    with app.app_context():
        rows = [
            MonthlyRoute(id=301, route_number=1, weekday_iso=0, week_occurrence=1),
            MonthlyRoute(id=302, route_number=12, weekday_iso=0, week_occurrence=1),
        ]
        db.session.add_all(rows)
        db.session.commit()
    res = client.get("/api/technician_portal/routes_suggest?q=R1")
    assert res.status_code == 200
    assert [r["route_number"] for r in res.get_json()["routes"]][:2] == [1, 12]


def test_portal_routes_suggest_empty_returns_empty(portal_only_client):
    client, app = portal_only_client
    res = client.get("/api/technician_portal/routes_suggest?q=")
    assert res.status_code == 200
    assert res.get_json()["routes"] == []
