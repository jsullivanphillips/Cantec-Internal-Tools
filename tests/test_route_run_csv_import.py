"""Endpoint tests for the route-detail "Upload run from CSV" button.

Exercises ``POST /api/monthly_routes/routes/<id>/runs/import_csv`` with the
two header variants the example sheets use (``Address`` + ``Tech Comments &
Notes`` vs. ``Location Details`` + ``Technician Notes & Comments``), plus
the route-mismatch (400) and completed-run CSV block (409) paths.
"""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, timezone

import pytest

from app import create_app
from app.db_models import (
    Key,
    MonitoringCompany,
    MonthlyRoute,
    MonthlyRouteLocation,
    MonthlyRouteRun,
    MonthlyRouteRunFieldSubmission,
    MonthlyRouteTestHistory,
    MonthlyRouteWorksheetAuditEvent,
    MonthlySite,
    MonthlyStopClockEvent,
    MonthlyTestingSite,
    MonthlyTestingSiteDeficiency,
    MonthlyTestingSiteMonth,
    db,
)


@pytest.fixture(autouse=True)
def pin_pacific_current_month_for_csv_tests(monkeypatch):
    """April 2026 CSV fixtures match the pinned current month unless a test overrides."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 4, 1))


@pytest.fixture
def import_client(monkeypatch):
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
                MonthlyRouteRunFieldSubmission.__table__,
                MonthlyRouteTestHistory.__table__,
                MonthlyRouteWorksheetAuditEvent.__table__,
                MonthlySite.__table__,
                MonthlyTestingSite.__table__,
                MonthlyTestingSiteMonth.__table__,
                MonthlyStopClockEvent.__table__,
                MonthlyTestingSiteDeficiency.__table__,
            ],
        )
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["username"] = "office.staff"
                sess["authenticated"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(
            db.engine,
            tables=[
                MonthlyTestingSiteMonth.__table__,
                MonthlyTestingSiteDeficiency.__table__,
                MonthlyStopClockEvent.__table__,
                MonthlyTestingSite.__table__,
                MonthlySite.__table__,
                MonthlyRouteWorksheetAuditEvent.__table__,
                MonthlyRouteRunFieldSubmission.__table__,
                MonthlyRouteTestHistory.__table__,
                MonthlyRouteRun.__table__,
                MonthlyRouteLocation.__table__,
                MonitoringCompany.__table__,
                Key.__table__,
                MonthlyRoute.__table__,
            ],
        )


def _seed_route8_with_two_stops() -> tuple[int, int, int]:
    route = MonthlyRoute(id=8, route_number=8, weekday_iso=3, week_occurrence=1)
    # Two stops on R8 that the CSV preamble below will reference.
    loc1 = MonthlyRouteLocation(
        id=801,
        address="800 Johnson Street",
        address_normalized="800 johnson street",
        property_management_company="Invermay",
        property_management_company_normalized="invermay",
        building="TDMC Holdings",
        building_normalized="tdmc holdings",
        status_normalized="active",
        status_raw="Active",
        monthly_route_id=8,
        annual_month="July",
    )
    loc2 = MonthlyRouteLocation(
        id=802,
        address="1461 Blanshard Street",
        address_normalized="1461 blanshard street",
        property_management_company="Singleton Maintenance Solutions",
        property_management_company_normalized="singleton maintenance solutions",
        building="Congregation Emanu-El",
        building_normalized="congregation emanu-el",
        status_normalized="active",
        status_raw="Active",
        monthly_route_id=8,
        annual_month="January",
    )
    db.session.add_all([route, loc1, loc2])
    db.session.commit()
    return int(route.id), int(loc1.id), int(loc2.id)


def _build_csv(*, address_header: str, tech_notes_header: str) -> bytes:
    """Two-stop R8 / April 2026 sheet matching the seeded locations.

    The preamble follows the production layout (``ROUTE:`` and ``DATE:`` rows
    in column B, route number text in column E). The data header row uses the
    ``address_header`` / ``tech_notes_header`` variants under test.
    """
    rows = [
        ",,,,,,,,,,,",
        "MONTHLY BELL TESTING,,,,,,,,,,,",
        ",,,,,,,,,,,",
        ",ROUTE:,1st Thurs,,Route 8,Downtown 1,,,,,,",
        ",DATE:,April,,2026,,,,,,,",
        ",,,,,,,,,,,",
        f"#,{address_header},Annual,Ring,Key #,FACP,Monitoring,Testing Procedures,{tech_notes_header},Time In:,Time Out:",
        '1,"800 Johnson Street\nName:TDMC Holdings\nManagement: Invermay",July,R1,TH008,EDWARDS 6632,Telus,Test bells,Site contact Allison,8:30am,9:15am',
        '2,"1461 Blanshard Street\nName: Congregation Emanu-El\nManagement: Singleton Maintenance Solutions",January,R1,LD 1641,Edwards Quickstart,Telus,Bypass before bells,No daycare,,',
    ]
    return ("\r\n".join(rows) + "\r\n").encode("utf-8")


def _post_csv(
    client,
    route_id: int,
    csv_bytes: bytes,
    *,
    filename: str = "R8.csv",
    sync_stop_order: bool = False,
):
    data: dict[str, object] = {"file": (io.BytesIO(csv_bytes), filename)}
    if sync_stop_order:
        data["sync_stop_order"] = "1"
    return client.post(
        f"/api/monthly_routes/routes/{route_id}/runs/import_csv",
        data=data,
        content_type="multipart/form-data",
    )


def test_import_sync_stop_order_reorders_route_and_history(import_client):
    from app.monthly.route_inspection_csv_import import run_route_inspection_csv_import
    from app.monthly.runs import get_or_create_monthly_route_run

    client, app = import_client
    with app.app_context():
        route_id, loc1, loc2 = _seed_route8_with_two_stops()
        loc1_row = db.session.get(MonthlyRouteLocation, loc1)
        loc2_row = db.session.get(MonthlyRouteLocation, loc2)
        loc1_row.route_stop_order = 99
        loc2_row.route_stop_order = 1
        db.session.commit()
        route = db.session.get(MonthlyRoute, route_id)
        month_first = date(2026, 4, 1)
        run = get_or_create_monthly_route_run(route_id, month_first, source="csv_import")
        csv_bytes = _build_csv(
            address_header="Address",
            tech_notes_header="Tech Comments & Notes",
        )
        result = run_route_inspection_csv_import(
            csv_bytes=csv_bytes,
            run=run,
            route=route,
            month_date=month_first,
            sync_stop_order=True,
        )
        db.session.commit()
        assert result.stop_order_applied == 2
        loc1_after = db.session.get(MonthlyRouteLocation, loc1)
        loc2_after = db.session.get(MonthlyRouteLocation, loc2)
        assert loc1_after.route_stop_order == 0
        assert loc2_after.route_stop_order == 1
        h1 = MonthlyRouteTestHistory.query.filter_by(
            location_id=loc1, month_date=month_first
        ).one()
        h2 = MonthlyRouteTestHistory.query.filter_by(
            location_id=loc2, month_date=month_first
        ).one()
        assert h1.session_route_stop_order == 0
        assert h2.session_route_stop_order == 1


def test_import_without_sync_stop_order_leaves_route_stop_order(import_client):
    from app.monthly.route_inspection_csv_import import run_route_inspection_csv_import
    from app.monthly.runs import get_or_create_monthly_route_run

    client, app = import_client
    with app.app_context():
        route_id, loc1, loc2 = _seed_route8_with_two_stops()
        loc1_row = db.session.get(MonthlyRouteLocation, loc1)
        loc2_row = db.session.get(MonthlyRouteLocation, loc2)
        loc1_row.route_stop_order = 99
        loc2_row.route_stop_order = 1
        db.session.commit()
        route = db.session.get(MonthlyRoute, route_id)
        month_first = date(2026, 4, 1)
        run = get_or_create_monthly_route_run(route_id, month_first, source="csv_import")
        result = run_route_inspection_csv_import(
            csv_bytes=_build_csv(
                address_header="Address",
                tech_notes_header="Tech Comments & Notes",
            ),
            run=run,
            route=route,
            month_date=month_first,
            sync_stop_order=False,
        )
        db.session.commit()
        assert result.stop_order_applied == 0
        assert db.session.get(MonthlyRouteLocation, loc1).route_stop_order == 99
        assert db.session.get(MonthlyRouteLocation, loc2).route_stop_order == 1


def test_import_without_sync_stop_order_applies_csv_session_order_to_run_review(import_client):
    """CSV # drives run-month order even when library route_stop_order is left unchanged."""
    from app.monthly.monthly_sites_sync import sync_testing_sites_from_legacy
    from app.monthly.runs import get_or_create_monthly_route_run
    from app.monthly.worksheet_stops import ensure_worksheet_stops_for_route_month, worksheet_stops_for_route_month

    client, app = import_client
    with app.app_context():
        route_id, loc1, loc2 = _seed_route8_with_two_stops()
        loc1_row = db.session.get(MonthlyRouteLocation, loc1)
        loc2_row = db.session.get(MonthlyRouteLocation, loc2)
        # Library order opposite of CSV (#1 Johnson, #2 Blanshard).
        loc1_row.route_stop_order = 99
        loc2_row.route_stop_order = 1
        db.session.commit()
        sync_testing_sites_from_legacy(loc1_row)
        sync_testing_sites_from_legacy(loc2_row)
        month_first = date(2026, 4, 1)
        run = get_or_create_monthly_route_run(route_id, month_first, source="csv_import")
        ensure_worksheet_stops_for_route_month(route_id, month_first, run)
        ts1 = MonthlyTestingSite.query.filter_by(monthly_site_id=MonthlySite.query.filter_by(
            legacy_monthly_route_location_id=loc1
        ).one().id).one()
        ts2 = MonthlyTestingSite.query.filter_by(monthly_site_id=MonthlySite.query.filter_by(
            legacy_monthly_route_location_id=loc2
        ).one().id).one()
        mtsm1 = MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=int(ts1.id),
            month_date=month_first,
        ).one()
        mtsm2 = MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=int(ts2.id),
            month_date=month_first,
        ).one()
        mtsm1.result_status = "tested"
        mtsm1.session_route_stop_order = None
        mtsm2.session_route_stop_order = None
        ts1_id = int(ts1.id)
        ts2_id = int(ts2.id)
        db.session.commit()

    res = _post_csv(
        client,
        route_id,
        _build_csv(address_header="Address", tech_notes_header="Tech Comments & Notes"),
        sync_stop_order=False,
    )
    assert res.status_code == 200, res.get_data(as_text=True)
    body = res.get_json()
    assert body["session_stop_order_applied"] >= 2

    with app.app_context():
        assert db.session.get(MonthlyRouteLocation, loc1).route_stop_order == 99
        assert db.session.get(MonthlyRouteLocation, loc2).route_stop_order == 1
        h1 = MonthlyRouteTestHistory.query.filter_by(location_id=loc1, month_date=month_first).one()
        h2 = MonthlyRouteTestHistory.query.filter_by(location_id=loc2, month_date=month_first).one()
        assert h1.session_route_stop_order == 0
        assert h2.session_route_stop_order == 1
        mtsm1 = MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=ts1_id,
            month_date=month_first,
        ).one()
        mtsm2 = MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=ts2_id,
            month_date=month_first,
        ).one()
        assert mtsm1.session_route_stop_order == 0
        assert mtsm2.session_route_stop_order == 1
        stops = worksheet_stops_for_route_month(route_id, month_first, include_portal_extras=False)
        assert [int(s["location_id"]) for s in stops] == [loc1, loc2]
        assert [int(s["stop_number"]) for s in stops] == [1, 2]

        from app.monthly.run_details_review import run_details_base_payload_extras

        _counts, _billing, _meta, locations, _summary = run_details_base_payload_extras(
            route_id,
            month_first,
        )
        assert [int(row["location_id"]) for row in locations] == [loc1, loc2]
        assert [int(row["first_stop_number"]) for row in locations] == [1, 2]


def test_import_creates_run_and_snapshots(import_client):
    client, app = import_client
    with app.app_context():
        route_id, loc1, loc2 = _seed_route8_with_two_stops()

    csv_bytes = _build_csv(
        address_header="Address",
        tech_notes_header="Tech Comments & Notes",
    )

    res = _post_csv(client, route_id, csv_bytes)

    assert res.status_code == 200, res.get_data(as_text=True)
    body = res.get_json()
    assert body["ok"] is True
    assert body["route"]["route_number"] == 8
    assert body["month_date"] == "2026-04-01"
    assert body["run"] is not None
    assert body["run"]["source"] == "csv_import"
    assert body["run"]["status"] == "open"
    assert body["locations_updated"] == 2
    assert body["history_upserts"] == 2
    assert body["rows_without_history_signal"] == 1

    with app.app_context():
        run = MonthlyRouteRun.query.filter_by(
            monthly_route_id=route_id, month_date=date(2026, 4, 1)
        ).one()
        rows = (
            MonthlyRouteTestHistory.query.filter_by(month_date=date(2026, 4, 1))
            .order_by(MonthlyRouteTestHistory.location_id.asc())
            .all()
        )
        assert len(rows) == 2
        by_loc = {int(r.location_id): r for r in rows}
        h1 = by_loc[loc1]
        assert int(h1.run_id or 0) == int(run.id)
        assert h1.facp == "EDWARDS 6632"
        assert h1.ring == "R1"
        assert h1.key_number == "TH008"
        assert h1.annual_month == "July"
        assert h1.testing_procedures == "Test bells"
        assert h1.inspection_tech_notes == "Site contact Allison"
        assert h1.result_status == "tested"
        assert h1.sheet_time_in_raw == "8:30am"
        h2 = by_loc[loc2]
        assert h2.result_status is None
        assert h2.facp == "Edwards Quickstart"
        assert h2.sheet_time_in_raw is None
        # Library "current" mirror should also be updated to match.
        loc_after = db.session.get(MonthlyRouteLocation, loc1)
        assert loc_after.facp_detail == "EDWARDS 6632"
        assert loc_after.ring_detail == "R1"
        # loc2 is touched; history now carries snapshots even without times
        loc2_after = db.session.get(MonthlyRouteLocation, loc2)
        assert loc2_after.facp_detail == "Edwards Quickstart"


def test_import_handles_location_details_header_variant(import_client):
    """Modern technician sheets use ``Location Details`` and ``Technician Notes & Comments``."""
    client, app = import_client
    with app.app_context():
        route_id, _loc1, _loc2 = _seed_route8_with_two_stops()

    csv_bytes = _build_csv(
        address_header="Location Details",
        tech_notes_header="Technician Notes & Comments",
    )

    res = _post_csv(client, route_id, csv_bytes)

    assert res.status_code == 200, res.get_data(as_text=True)
    body = res.get_json()
    assert body["locations_updated"] == 2
    assert body["history_upserts"] == 2


def test_import_rejects_completed_run_409(import_client):
    """Runs marked completed cannot be replaced by CSV until staff reopens."""
    client, app = import_client
    with app.app_context():
        route_id, _, _ = _seed_route8_with_two_stops()
        db.session.add(
            MonthlyRouteRun(
                id=7200,
                monthly_route_id=route_id,
                month_date=date(2026, 4, 1),
                status="completed",
                completed_at=datetime(2026, 4, 15, 12, 0, tzinfo=timezone.utc),
                source="technician_app",
            )
        )
        db.session.commit()

    csv_bytes = _build_csv(
        address_header="Address",
        tech_notes_header="Tech Comments & Notes",
    )
    res = _post_csv(client, route_id, csv_bytes)
    assert res.status_code == 409, res.get_data(as_text=True)
    body = res.get_json()
    assert body.get("code") == "run_completed_csv_blocked"
    assert body.get("month_date") == "2026-04-01"


def test_import_allows_started_open_run(import_client):
    """Started field run with status still open must remain replaceable via CSV."""
    client, app = import_client
    with app.app_context():
        route_id, _, _ = _seed_route8_with_two_stops()
        db.session.add(
            MonthlyRouteRun(
                id=7201,
                monthly_route_id=route_id,
                month_date=date(2026, 4, 1),
                started_at=datetime(2026, 4, 10, 8, 0, tzinfo=timezone.utc),
                status="open",
                source="technician_app",
            )
        )
        db.session.commit()

    csv_bytes = _build_csv(
        address_header="Address",
        tech_notes_header="Tech Comments & Notes",
    )
    res = _post_csv(client, route_id, csv_bytes)
    assert res.status_code == 200, res.get_data(as_text=True)


def test_import_csv_allowed_after_staff_reopen(import_client):
    client, app = import_client
    with app.app_context():
        route_id, _, _ = _seed_route8_with_two_stops()
        db.session.add(
            MonthlyRouteRun(
                id=7202,
                monthly_route_id=route_id,
                month_date=date(2026, 4, 1),
                status="completed",
                completed_at=datetime(2026, 4, 15, 12, 0, tzinfo=timezone.utc),
                source="technician_app",
            )
        )
        db.session.commit()

    csv_bytes = _build_csv(
        address_header="Address",
        tech_notes_header="Tech Comments & Notes",
    )
    assert _post_csv(client, route_id, csv_bytes).status_code == 409

    reopen = client.post(
        f"/api/monthly_routes/routes/{route_id}/runs/reopen",
        json={"month_date": "2026-04-01"},
        content_type="application/json",
    )
    assert reopen.status_code == 200, reopen.get_data(as_text=True)

    res2 = _post_csv(client, route_id, csv_bytes)
    assert res2.status_code == 200, res2.get_data(as_text=True)


def test_historical_csv_import_closes_run(import_client, monkeypatch):
    """Prior-month CSV upload marks paperwork completed without manual office close."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = import_client
    with app.app_context():
        route_id, _, _ = _seed_route8_with_two_stops()

    csv_bytes = _build_csv(
        address_header="Address",
        tech_notes_header="Tech Comments & Notes",
    )
    res = _post_csv(client, route_id, csv_bytes)
    assert res.status_code == 200, res.get_data(as_text=True)
    body = res.get_json()
    assert body.get("historical_run_closed") is True
    run = body["run"]
    assert run.get("completed_at") is not None
    assert run.get("workflow_stage") == "completed"
    assert run.get("office_review_completed_at") is not None
    assert run.get("field_ended_at") is not None


def test_csv_import_syncs_tested_outcome_after_run_prepared(import_client):
    """Prepared worksheet rows must pick up CSV sheet times as tested."""
    client, app = import_client
    with app.app_context():
        route_id, loc1, _loc2 = _seed_route8_with_two_stops()

    prep = client.post(
        f"/api/monthly_routes/routes/{route_id}/runs/prepare",
        json={"month_date": "2026-04-01"},
        content_type="application/json",
    )
    assert prep.status_code == 200, prep.get_data(as_text=True)

    csv_bytes = _build_csv(
        address_header="Address",
        tech_notes_header="Tech Comments & Notes",
    )
    res = _post_csv(client, route_id, csv_bytes)
    assert res.status_code == 200, res.get_data(as_text=True)

    with app.app_context():
        mtsm_rows = MonthlyTestingSiteMonth.query.filter_by(month_date=date(2026, 4, 1)).all()
        assert len(mtsm_rows) >= 1
        by_loc: dict[int, MonthlyTestingSiteMonth] = {}
        for row in mtsm_rows:
            ts = db.session.get(MonthlyTestingSite, int(row.monthly_testing_site_id))
            site = db.session.get(MonthlySite, int(ts.monthly_site_id))
            by_loc[int(site.legacy_monthly_route_location_id)] = row
        row_loc1 = by_loc[loc1]
        assert row_loc1.result_status == "tested"
        assert row_loc1.sheet_time_in_raw == "8:30am"
        assert row_loc1.sheet_time_out_raw == "9:15am"


def test_historical_csv_field_submission_includes_tested_times(import_client, monkeypatch):
    """Exact-history snapshot should show tested + clock times after historical CSV import."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = import_client
    with app.app_context():
        route_id, loc1, _loc2 = _seed_route8_with_two_stops()

    prep = client.post(
        f"/api/monthly_routes/routes/{route_id}/runs/prepare",
        json={"month_date": "2026-04-01"},
        content_type="application/json",
    )
    assert prep.status_code == 200, prep.get_data(as_text=True)

    csv_bytes = _build_csv(
        address_header="Address",
        tech_notes_header="Tech Comments & Notes",
    )
    res = _post_csv(client, route_id, csv_bytes)
    assert res.status_code == 200, res.get_data(as_text=True)

    hist_res = client.get(
        f"/api/monthly_routes/routes/{route_id}/run_details/field_submission?month=2026-04-01"
    )
    assert hist_res.status_code == 200, hist_res.get_data(as_text=True)
    payload = hist_res.get_json()
    stops = payload.get("stops") or []
    loc1_stop = next(s for s in stops if int(s.get("location_id") or 0) == loc1)
    assert loc1_stop.get("result_status") == "tested"
    assert loc1_stop.get("time_in") == "8:30am"
    assert loc1_stop.get("time_out") == "9:15am"


def test_historical_csv_reimport_after_reopen_closes_again(import_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = import_client
    with app.app_context():
        route_id, _, _ = _seed_route8_with_two_stops()
        db.session.add(
            MonthlyRouteRun(
                id=7203,
                monthly_route_id=route_id,
                month_date=date(2026, 4, 1),
                status="completed",
                completed_at=datetime(2026, 4, 15, 12, 0, tzinfo=timezone.utc),
                source="csv_import",
            )
        )
        db.session.commit()

    csv_bytes = _build_csv(
        address_header="Address",
        tech_notes_header="Tech Comments & Notes",
    )
    assert _post_csv(client, route_id, csv_bytes).status_code == 409

    reopen = client.post(
        f"/api/monthly_routes/routes/{route_id}/runs/reopen",
        json={"month_date": "2026-04-01"},
        content_type="application/json",
    )
    assert reopen.status_code == 200, reopen.get_data(as_text=True)

    res2 = _post_csv(client, route_id, csv_bytes)
    assert res2.status_code == 200, res2.get_data(as_text=True)
    body = res2.get_json()
    assert body.get("historical_run_closed") is True
    run = body["run"]
    assert run.get("completed_at") is not None
    assert run.get("workflow_stage") == "completed"


def test_import_second_csv_same_month_is_idempotent(import_client):
    """Re-upload on the route page should still succeed (importer merges with existing rows)."""
    client, app = import_client
    with app.app_context():
        route_id, _, _ = _seed_route8_with_two_stops()

    csv_bytes = _build_csv(
        address_header="Address",
        tech_notes_header="Tech Comments & Notes",
    )
    assert _post_csv(client, route_id, csv_bytes).status_code == 200
    res2 = _post_csv(client, route_id, csv_bytes)
    assert res2.status_code == 200, res2.get_data(as_text=True)
    assert res2.get_json()["ok"] is True


def test_import_preserves_existing_tested_row_and_overwrites_snapshots(import_client):
    """Tech-portal-set ``result_status`` / times survive CSV upload; FACP/ring/etc still update."""
    client, app = import_client
    with app.app_context():
        route_id, loc1, _ = _seed_route8_with_two_stops()
        db.session.add_all(
            [
                MonthlyRouteRun(
                    id=7001,
                    monthly_route_id=route_id,
                    month_date=date(2026, 4, 1),
                    status="open",
                    source="technician_app",
                ),
                MonthlyRouteTestHistory(
                    id=9002,
                    location_id=loc1,
                    month_date=date(2026, 4, 1),
                    result_status="tested",
                    skip_reason=None,
                    sheet_time_in_raw="7:55am",
                    sheet_time_out_raw="8:40am",
                    source_value_raw="7:55am | 8:40am",
                    test_monthly_route_id=route_id,
                    run_id=7001,
                ),
            ]
        )
        db.session.commit()

    res = _post_csv(
        client,
        route_id,
        _build_csv(
            address_header="Address",
            tech_notes_header="Tech Comments & Notes",
        ),
    )
    assert res.status_code == 200, res.get_data(as_text=True)
    body = res.get_json()
    assert body["existing_status_preserved"] >= 1

    with app.app_context():
        h = db.session.get(MonthlyRouteTestHistory, 9002)
        assert h is not None
        # Tech-set status / times preserved.
        assert h.result_status == "tested"
        assert h.skip_reason is None
        assert h.sheet_time_in_raw == "7:55am"
        assert h.sheet_time_out_raw == "8:40am"
        assert h.source_value_raw == "7:55am | 8:40am"
        # CSV-only snapshot fields applied.
        assert h.facp == "EDWARDS 6632"
        assert h.ring == "R1"
        assert h.key_number == "TH008"
        assert h.annual_month == "July"
        assert h.testing_procedures == "Test bells"
        assert h.inspection_tech_notes == "Site contact Allison"


def test_import_uses_csv_status_when_existing_row_unset(import_client):
    """When an existing history row has no ``result_status``, CSV's tested/skipped wins."""
    client, app = import_client
    with app.app_context():
        route_id, loc1, _ = _seed_route8_with_two_stops()
        db.session.add_all(
            [
                MonthlyRouteRun(
                    id=7100,
                    monthly_route_id=route_id,
                    month_date=date(2026, 4, 1),
                    status="open",
                    source="technician_app",
                ),
                MonthlyRouteTestHistory(
                    id=9100,
                    location_id=loc1,
                    month_date=date(2026, 4, 1),
                    result_status=None,
                    test_monthly_route_id=route_id,
                    run_id=7100,
                ),
            ]
        )
        db.session.commit()

    res = _post_csv(
        client,
        route_id,
        _build_csv(
            address_header="Address",
            tech_notes_header="Tech Comments & Notes",
        ),
    )
    assert res.status_code == 200, res.get_data(as_text=True)
    body = res.get_json()
    assert body["existing_status_preserved"] == 0

    with app.app_context():
        h = db.session.get(MonthlyRouteTestHistory, 9100)
        assert h is not None
        # CSV-derived classification applied (loc1 has 8:30am / 9:15am in the test sheet).
        assert h.result_status == "tested"
        assert h.sheet_time_in_raw == "8:30am"
        assert h.sheet_time_out_raw == "9:15am"
        assert h.facp == "EDWARDS 6632"


def test_import_rejects_route_mismatch(import_client):
    """Uploading an R6 sheet on the R8 page must 400 and not touch the DB."""
    client, app = import_client
    with app.app_context():
        route_id, _, _ = _seed_route8_with_two_stops()

    bad_csv = _build_csv(
        address_header="Address",
        tech_notes_header="Tech Comments & Notes",
    ).replace(b"Route 8", b"Route 6", 1)

    res = _post_csv(client, route_id, bad_csv)

    assert res.status_code == 400
    body = res.get_json()
    assert body["csv_route_number"] == 6
    assert body["page_route_number"] == 8

    with app.app_context():
        assert (
            MonthlyRouteRun.query.filter_by(monthly_route_id=route_id).count() == 0
        ), "no run row should be created on mismatch"
        assert (
            MonthlyRouteTestHistory.query.filter_by(
                test_monthly_route_id=route_id
            ).count()
            == 0
        )


def _build_csv_one_data_row_trailing_empty_addresses(*, n_trailing: int) -> bytes:
    """Single matched stop then rows with ``#`` but no site block (Excel tail)."""
    buf = io.StringIO()
    for ln in (
        ",,,,,,,,,,,",
        "MONTHLY BELL TESTING,,,,,,,,,,,",
        ",,,,,,,,,,,",
        ",ROUTE:,1st Thurs,,Route 8,Downtown 1,,,,,,",
        ",DATE:,April,,2026,,,,,,,",
        ",,,,,,,,,,,",
    ):
        buf.write(ln + "\r\n")
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(
        [
            "#",
            "Address",
            "Annual",
            "Ring",
            "Key #",
            "FACP",
            "Monitoring",
            "Testing Procedures",
            "Tech Comments & Notes",
            "Time In:",
            "Time Out:",
        ]
    )
    w.writerow(
        [
            "1",
            "800 Johnson Street\nName:TDMC Holdings\nManagement: Invermay",
            "_",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
        ]
    )
    for i in range(2, 2 + n_trailing):
        w.writerow([str(i), ""] + [""] * 9)

    return buf.getvalue().encode("utf-8")


def test_import_drops_trailing_blank_rows_after_ten(import_client):
    client, app = import_client
    with app.app_context():
        route_id, _, _ = _seed_route8_with_two_stops()

    res = _post_csv(
        client, route_id, _build_csv_one_data_row_trailing_empty_addresses(n_trailing=10)
    )
    assert res.status_code == 200
    missing = [i for i in res.get_json()["issues"] if i["kind"] == "missing_address"]
    assert missing == []


def test_import_reports_trailing_blank_rows_fewer_than_ten(import_client):
    client, app = import_client
    with app.app_context():
        route_id, _, _ = _seed_route8_with_two_stops()

    res = _post_csv(
        client, route_id, _build_csv_one_data_row_trailing_empty_addresses(n_trailing=9)
    )
    assert res.status_code == 200
    missing = [i for i in res.get_json()["issues"] if i["kind"] == "missing_address"]
    assert len(missing) == 9


def test_import_rejects_missing_file(import_client):
    client, app = import_client
    with app.app_context():
        route_id, _, _ = _seed_route8_with_two_stops()

    res = client.post(
        f"/api/monthly_routes/routes/{route_id}/runs/import_csv",
        data={},
        content_type="multipart/form-data",
    )
    assert res.status_code == 400
    body = res.get_json()
    assert "file" in body["error"].lower()


def _seed_route15_one_stop() -> tuple[int, int]:
    route = MonthlyRoute(id=15, route_number=15, weekday_iso=3, week_occurrence=1)
    loc = MonthlyRouteLocation(
        id=1501,
        address="2028 Richmond",
        address_normalized="2028 richmond",
        property_management_company="Brown Bros.",
        property_management_company_normalized="brown bros.",
        building="Richmond Medical",
        building_normalized="richmond medical",
        status_normalized="active",
        status_raw="Active",
        monthly_route_id=15,
    )
    db.session.add_all([route, loc])
    db.session.commit()
    return int(route.id), int(loc.id)


def _build_csv_r15_multiline_site_sheet() -> bytes:
    """R15-style export: ``Site Details``, ``Month``, ``Access Information``, etc."""
    buf = io.StringIO()
    for ln in (
        ",,,,,,,,,,,",
        "MONTHLY BELL TESTING,,,,,,,,,,,",
        ",,,,,,,,,,,",
        ",ROUTE:,1st Thurs,,Route 15,Downtown 1,,,,,,",
        ",DATE:,December,,2026,,,,,,,",
        ",,,,,,,,,,,",
    ):
        buf.write(ln + "\r\n")
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(
        [
            "#",
            "Site Details",
            "Month",
            "Status",
            "Access Information",
            "FACP",
            "Monitoring",
            "Testing Procedures",
            "Technicians Notes and Comments",
            "Time In",
            "Time Out",
        ]
    )
    w.writerow(
        [
            "1",
            "Address: 2028 Richmond\nName: Richmond Medical\nManagement: Brown Bros.",
            "December",
            "N/A",
            "w/ Parking Attendant",
            "PANEL: EDWARDS 6500\nLOCATION: Electrical room",
            "COMPANY: Bullet\nSIGNALS: A T\nACCT: # 19-6103",
            "RING BELLS BY 7:45AM",
            "Mike (Parking Attendant) 250-217-9695",
            "7:08",
            "7:21",
        ]
    )
    return buf.getvalue().encode("utf-8")


def test_parse_csv_row_fields_extracts_monitoring_password():
    from app.monthly.route_inspection_csv_import import _parse_csv_row_fields

    parsed = _parse_csv_row_fields(
        {
            "Monitoring": "ACCT: 123\nPASS: secret99\nSIGNALS: fire only",
        },
        stop_order=1,
    )
    assert parsed.monitoring_account_number == "123"
    assert parsed.monitoring_password == "secret99"
    assert parsed.cleaned_monitoring_notes is not None
    assert "SIGNALS: fire only" in parsed.cleaned_monitoring_notes
    assert "PASS" not in (parsed.cleaned_monitoring_notes or "")


@pytest.mark.parametrize(
    "facp_cell,expected_panel,expected_location",
    [
        (
            "PANEL: PACPRO P24A\nLOCATION: Basement North East Electrical Room in laundry room.",
            "PACPRO P24A",
            "Basement North East Electrical Room in laundry room.",
        ),
        (
            "PANEL:  Bell Battery System. \nLOCATION: Lower level west hallway, on wall. ",
            "Bell Battery System.",
            "Lower level west hallway, on wall.",
        ),
        (
            "PANEL: PAC PRO 906D\nLOCATION: in basement electrical room; from main floor turn left, at bottom of stairs",
            "PAC PRO 906D",
            "in basement electrical room; from main floor turn left, at bottom of stairs",
        ),
        ("PANEL: EDWARDS 6500\nLOCATION: Electrical room", "EDWARDS 6500", "Electrical room"),
        ("EDWARDS 6632", "EDWARDS 6632", None),
    ],
)
def test_parse_facp_panel_fields(facp_cell, expected_panel, expected_location):
    from app.monthly.route_inspection_csv_import import parse_facp_panel_fields

    panel, location = parse_facp_panel_fields(facp_cell)
    assert panel == expected_panel
    assert location == expected_location


def test_import_r15_style_headers_multiline_snapshots(import_client):
    """Technician sheets that use ``Site Details`` / ``Month`` / un-suffixed times still import."""
    client, app = import_client
    with app.app_context():
        route_id, loc_id = _seed_route15_one_stop()

    res = _post_csv(client, route_id, _build_csv_r15_multiline_site_sheet())
    assert res.status_code == 200, res.get_data(as_text=True)

    with app.app_context():
        h = MonthlyRouteTestHistory.query.filter_by(
            location_id=loc_id, month_date=date(2026, 12, 1)
        ).one()
        assert h.facp == "EDWARDS 6500"
        assert "SIGNALS: A T" in (h.monitoring_notes or "")
        assert h.ring == "w/ Parking Attendant"
        assert h.annual_month == "December"
        assert h.testing_procedures == "RING BELLS BY 7:45AM"
        assert h.inspection_tech_notes is not None and "Mike" in h.inspection_tech_notes
        assert h.sheet_time_in_raw == "7:08"
        assert h.sheet_time_out_raw == "7:21"
        assert h.result_status == "tested"


def test_import_r15_panel_fields_on_v2_testing_site(import_client):
    """``PANEL:`` / ``LOCATION:`` in the FACP column map to v2 ``panel`` + ``panel_location``."""
    from app.db_models import MonthlySite, MonthlyTestingSite

    client, app = import_client
    with app.app_context():
        db.metadata.create_all(
            db.engine,
            tables=[MonthlySite.__table__, MonthlyTestingSite.__table__],
        )
        route_id, loc_id = _seed_route15_one_stop()

    res = _post_csv(client, route_id, _build_csv_r15_multiline_site_sheet())
    assert res.status_code == 200, res.get_data(as_text=True)

    with app.app_context():
        loc = db.session.get(MonthlyRouteLocation, loc_id)
        assert loc is not None
        assert loc.facp_detail == "EDWARDS 6500"
        site = MonthlySite.query.filter_by(legacy_monthly_route_location_id=loc_id).one()
        ts = MonthlyTestingSite.query.filter_by(monthly_site_id=int(site.id)).one()
        assert ts.panel == "EDWARDS 6500"
        assert ts.facp_detail == "EDWARDS 6500"
        assert ts.panel_location == "Electrical room"


def _seed_route1_dual_address_billing() -> tuple[int, int, int, int]:
    route = MonthlyRoute(id=1, route_number=1, weekday_iso=0, week_occurrence=1)
    loc = MonthlyRouteLocation(
        id=101,
        address="2471 Sidney Ave",
        address_normalized="2471 sidney ave",
        property_management_company="Example PMC",
        property_management_company_normalized="example pmc",
        building="Main",
        building_normalized="main",
        status_normalized="active",
        status_raw="Active",
        monthly_route_id=1,
    )
    site = MonthlySite(id=501, legacy_monthly_route_location_id=101)
    ts_primary = MonthlyTestingSite(
        id=1001,
        monthly_site_id=501,
        sort_order=0,
        label="2471 Sidney Ave",
    )
    ts_secondary = MonthlyTestingSite(
        id=1002,
        monthly_site_id=501,
        sort_order=1,
        label="9838 Second Street",
    )
    db.session.add_all([route, loc, site, ts_primary, ts_secondary])
    db.session.commit()
    return int(route.id), int(loc.id), int(ts_primary.id), int(ts_secondary.id)


def _build_csv_route1_dual_address() -> bytes:
    rows = [
        ",,,,,,,,,,,",
        "MONTHLY BELL TESTING,,,,,,,,,,,",
        ",ROUTE:,1st Monday,,Route 1,,,,,,,",
        ",DATE:,April,,2026,,,,,,,",
        ",,,,,,,,,,,",
        "#,Address,Annual,Ring,Key #,FACP,Monitoring,Testing Procedures,Tech Comments & Notes,Time In:,Time Out:",
        '1,"2471 Sidney Ave\nName: Main\nManagement: Example PMC",Jan,R1,KEY-A,PANEL-A,Telus,Proc A,Note A,8:00am,8:30am',
        '2,"9838 Second Street",Feb,R2,KEY-B,PANEL-B,Telus,Proc B,Note B,9:00am,9:30am',
    ]
    return ("\r\n".join(rows) + "\r\n").encode("utf-8")


def test_import_matches_secondary_testing_site_by_label_street(import_client):
    client, app = import_client
    with app.app_context():
        route_id, loc_id, _primary_ts_id, secondary_ts_id = _seed_route1_dual_address_billing()

    res = _post_csv(client, route_id, _build_csv_route1_dual_address())
    assert res.status_code == 200, res.get_data(as_text=True)
    body = res.get_json()
    assert body["testing_site_matches"] == 1
    assert body["stop_month_upserts"] == 1
    assert body["history_upserts"] == 1

    with app.app_context():
        hist = MonthlyRouteTestHistory.query.filter_by(
            location_id=loc_id,
            month_date=date(2026, 4, 1),
        ).one()
        assert hist.result_status == "tested"
        assert hist.key_number == "KEY-A"
        assert hist.facp == "PANEL-A"

        secondary_mtsm = MonthlyTestingSiteMonth.query.filter_by(
            monthly_testing_site_id=secondary_ts_id,
            month_date=date(2026, 4, 1),
        ).one()
        assert secondary_mtsm.result_status == "tested"
        assert secondary_mtsm.key_number == "KEY-B"
        assert secondary_mtsm.panel == "PANEL-B"
        assert secondary_mtsm.session_route_stop_order == 1


def _seed_route2_with_off_route_testing_site_label() -> tuple[int, int]:
    route1 = MonthlyRoute(id=1, route_number=1, weekday_iso=0, week_occurrence=1)
    route2 = MonthlyRoute(id=2, route_number=2, weekday_iso=1, week_occurrence=1)
    loc_on_r2 = MonthlyRouteLocation(
        id=201,
        address="2471 Sidney Ave",
        address_normalized="2471 sidney ave",
        property_management_company_normalized="",
        building_normalized="",
        status_normalized="active",
        status_raw="Active",
        monthly_route_id=2,
    )
    site = MonthlySite(id=601, legacy_monthly_route_location_id=201)
    ts = MonthlyTestingSite(
        id=2001,
        monthly_site_id=601,
        sort_order=0,
        label="9838 Second Street",
    )
    db.session.add_all([route1, route2, loc_on_r2, site, ts])
    db.session.commit()
    return int(route1.id), int(route2.id)


def test_import_testing_site_fallback_scoped_to_route(import_client):
    client, app = import_client
    with app.app_context():
        route1_id, _route2_id = _seed_route2_with_off_route_testing_site_label()

    res = _post_csv(client, route1_id, _build_csv_route1_dual_address())
    assert res.status_code == 200, res.get_data(as_text=True)
    body = res.get_json()
    assert body["testing_site_matches"] == 0
    kinds = [issue["kind"] for issue in body["issues"]]
    assert "unmatched" in kinds


def _seed_route1_ambiguous_testing_site_labels() -> int:
    route = MonthlyRoute(id=1, route_number=1, weekday_iso=0, week_occurrence=1)
    loc1 = MonthlyRouteLocation(
        id=301,
        address="100 Alpha St",
        address_normalized="100 alpha st",
        property_management_company_normalized="",
        building_normalized="",
        status_normalized="active",
        status_raw="Active",
        monthly_route_id=1,
    )
    loc2 = MonthlyRouteLocation(
        id=302,
        address="200 Beta St",
        address_normalized="200 beta st",
        property_management_company_normalized="",
        building_normalized="",
        status_normalized="active",
        status_raw="Active",
        monthly_route_id=1,
    )
    site1 = MonthlySite(id=701, legacy_monthly_route_location_id=301)
    site2 = MonthlySite(id=702, legacy_monthly_route_location_id=302)
    ts1 = MonthlyTestingSite(id=3001, monthly_site_id=701, sort_order=0, label="9838 Second Street")
    ts2 = MonthlyTestingSite(id=3002, monthly_site_id=702, sort_order=0, label="9838 Second Street")
    db.session.add_all([route, loc1, loc2, site1, site2, ts1, ts2])
    db.session.commit()
    return int(route.id)


def test_import_testing_site_ambiguous_when_two_labels_collide(import_client):
    client, app = import_client
    with app.app_context():
        route_id = _seed_route1_ambiguous_testing_site_labels()

    rows = [
        ",,,,,,,,,,,",
        "MONTHLY BELL TESTING,,,,,,,,,,,",
        ",ROUTE:,1st Monday,,Route 1,,,,,,,",
        ",DATE:,April,,2026,,,,,,,",
        ",,,,,,,,,,,",
        "#,Address,Annual,Ring,Key #,FACP,Monitoring,Testing Procedures,Tech Comments & Notes,Time In:,Time Out:",
        '1,"9838 Second Street",Jan,R1,KEY-A,PANEL-A,Telus,Proc,Note,8:00am,8:30am',
    ]
    csv_bytes = ("\r\n".join(rows) + "\r\n").encode("utf-8")
    res = _post_csv(client, route_id, csv_bytes)
    assert res.status_code == 200, res.get_data(as_text=True)
    body = res.get_json()
    assert body["testing_site_matches"] == 0
    assert any(issue["kind"] == "testing_site_ambiguous" for issue in body["issues"])
