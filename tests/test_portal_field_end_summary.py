"""Portal PATCH field_end_summary after field end."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import MonthlyRoute, MonthlyRouteRun, db
from app.routes import monthly_routes as mr_mod
from app.routes.monthly_routes import _serialize_run
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location
from tests.run_workflow_helpers import portal_start_run, seed_prepared_started_run

PACIFIC = ZoneInfo("America/Vancouver")
JUNE = date(2026, 6, 1)


@pytest.fixture
def summary_app(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: JUNE)
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=WORKSHEET_TABLES)
        yield app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(WORKSHEET_TABLES)))


@pytest.fixture
def portal_client(summary_app):
    with summary_app.test_client() as client:
        with client.session_transaction() as sess:
            sess["tech_portal_unlocked"] = True
            sess["username"] = "tech1"
            sess["authenticated"] = True
        yield client


def _seed_route(*, route_id: int = 1, location_id: int = 101) -> int:
    route = MonthlyRoute(id=route_id, route_number=2, weekday_iso=0, week_occurrence=1)
    loc = make_location(
        id=location_id,
        address="123 Test St",
        monthly_route_id=route_id,
        route_stop_order=0,
    )
    db.session.add_all([route, loc])
    db.session.commit()
    return route_id


def _end_field_run(client, route_id: int = 1) -> None:
    res = client.post(f"/api/technician_portal/routes/{route_id}/runs/end")
    assert res.status_code == 200, res.get_json()


def test_patch_field_end_summary_when_field_ended(portal_client, summary_app):
    with summary_app.app_context():
        _seed_route()
    portal_start_run(portal_client, month_first=JUNE.isoformat())
    _end_field_run(portal_client)

    patch = portal_client.patch(
        "/api/technician_portal/routes/1/runs/field_end_summary",
        json={"field_end_summary": "Ran <b>smooth</b> overall."},
    )
    assert patch.status_code == 200
    body = patch.get_json()
    assert "smooth" in (body["run"]["field_end_summary"] or "")

    with summary_app.app_context():
        run = MonthlyRouteRun.query.filter_by(monthly_route_id=1, month_date=JUNE).one()
        assert run.field_end_summary is not None
        assert "smooth" in run.field_end_summary


def test_patch_rejects_when_field_not_ended(portal_client, summary_app):
    with summary_app.app_context():
        _seed_route()
    portal_start_run(portal_client, month_first=JUNE.isoformat())

    patch = portal_client.patch(
        "/api/technician_portal/routes/1/runs/field_end_summary",
        json={"field_end_summary": "Too early"},
    )
    assert patch.status_code == 409
    assert patch.get_json().get("code") == "field_not_ended"


def test_patch_empty_clears_summary(portal_client, summary_app):
    with summary_app.app_context():
        _seed_route()
        seed_prepared_started_run(1, JUNE, run_id=5001, field_ended=True)
        run = MonthlyRouteRun.query.get(5001)
        run.field_end_summary = "Old note"
        db.session.commit()

    patch = portal_client.patch(
        "/api/technician_portal/routes/1/runs/field_end_summary",
        json={"field_end_summary": "   "},
    )
    assert patch.status_code == 200
    assert patch.get_json()["run"]["field_end_summary"] is None

    with summary_app.app_context():
        run = MonthlyRouteRun.query.get(5001)
        assert run.field_end_summary is None


def test_serialize_run_includes_field_end_summary(summary_app):
    with summary_app.app_context():
        _seed_route()
        run = MonthlyRouteRun(
            id=5001,
            monthly_route_id=1,
            month_date=JUNE,
            opened_at=datetime.now(PACIFIC),
            started_at=datetime.now(PACIFIC),
            field_ended_at=datetime.now(PACIFIC),
            field_end_summary="<b>Done</b>",
            status="open",
            source="technician_app",
        )
        db.session.add(run)
        db.session.commit()

        payload = _serialize_run(run)
    assert payload is not None
    assert "Done" in (payload["field_end_summary"] or "")


def test_reopen_field_preserves_summary(portal_client, summary_app):
    with summary_app.app_context():
        _seed_route()
    portal_start_run(portal_client, month_first=JUNE.isoformat())
    _end_field_run(portal_client)
    portal_client.patch(
        "/api/technician_portal/routes/1/runs/field_end_summary",
        json={"field_end_summary": "Keep this"},
    )
    reopen = portal_client.post("/api/technician_portal/routes/1/runs/reopen_field")
    assert reopen.status_code == 200
    assert reopen.get_json()["run"]["field_end_summary"] == "Keep this"

    with summary_app.app_context():
        run = MonthlyRouteRun.query.filter_by(monthly_route_id=1, month_date=JUNE).one()
        assert run.field_end_summary == "Keep this"


def test_reset_run_clears_field_end_summary(portal_client, summary_app):
    with summary_app.app_context():
        _seed_route()
        seed_prepared_started_run(1, JUNE, run_id=5001, field_ended=True)
        run = MonthlyRouteRun.query.get(5001)
        run.field_end_summary = "Clear me"
        db.session.commit()

    with portal_client.session_transaction() as sess:
        sess["username"] = "office_tester"
        sess["authenticated"] = True

    reset = portal_client.post(
        f"/api/monthly_routes/routes/1/worksheet/reset_run?month={JUNE.isoformat()}",
        json={},
    )
    assert reset.status_code == 200

    with summary_app.app_context():
        run = MonthlyRouteRun.query.get(5001)
        assert run.field_end_summary is None
