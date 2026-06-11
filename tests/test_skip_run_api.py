"""POST /api/monthly_routes/routes/<id>/runs/skip — office bulk skip for empty months."""

from __future__ import annotations

from datetime import date
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import (
    MonthlyLocationMonth,
    MonthlyRouteRun,
    db,
)
from tests.monthly_location_helpers import WORKSHEET_TABLES, seed_route_with_two_stops

PACIFIC_TZ = ZoneInfo("America/Vancouver")


@pytest.fixture
def skip_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=WORKSHEET_TABLES)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["username"] = "office.staff"
                sess["authenticated"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(WORKSHEET_TABLES)))


def test_skip_empty_month_creates_skipped_run(skip_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = skip_client
    with app.app_context():
        route_id, loc1, loc2 = seed_route_with_two_stops(route_id=8, primary_id=801, secondary_id=802)

    res = client.post(f"/api/monthly_routes/routes/{route_id}/runs/skip?month=2026-07-01")
    assert res.status_code == 200, res.get_data(as_text=True)
    body = res.get_json()
    assert body["ok"] is True
    assert body["locations_skipped"] == 2
    run = body["run"]
    assert run["source"] == "office_skip"
    assert run["workflow_stage"] == "skipped"
    assert run["workflow_stage_label"] == "Skipped"
    assert run["stops_on_route_count"] == 2
    assert run["stops_tested_count"] == 0

    with app.app_context():
        month_first = date(2026, 7, 1)
        run_row = MonthlyRouteRun.query.filter_by(
            monthly_route_id=route_id,
            month_date=month_first,
        ).one()
        assert run_row.status == "completed"
        assert run_row.source == "office_skip"
        for loc_id in (loc1, loc2):
            mlm = MonthlyLocationMonth.query.filter_by(
                monthly_location_id=loc_id,
                month_date=month_first,
            ).one()
            assert mlm.result_status == "skipped"
            assert mlm.skip_reason == "month_skipped"
            assert mlm.billing_status == "do_not_bill"
            assert mlm.test_monthly_route_id == route_id


def test_skip_blocked_when_run_exists(skip_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = skip_client
    with app.app_context():
        route_id, _, _ = seed_route_with_two_stops(route_id=8, primary_id=801, secondary_id=802)
        db.session.add(
            MonthlyRouteRun(
                id=9001,
                monthly_route_id=route_id,
                month_date=date(2026, 4, 1),
                status="open",
                source="technician_app",
            )
        )
        db.session.commit()

    res = client.post(f"/api/monthly_routes/routes/{route_id}/runs/skip?month=2026-04-01")
    assert res.status_code == 409
    assert res.get_json()["code"] == "run_exists"


def test_skip_blocked_when_history_exists_without_run(skip_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = skip_client
    with app.app_context():
        route_id, loc1, _ = seed_route_with_two_stops(route_id=8, primary_id=801, secondary_id=802)
        db.session.add(
            MonthlyLocationMonth(
                id=8001,
                monthly_location_id=loc1,
                month_date=date(2026, 4, 1),
                result_status="tested",
                test_monthly_route_id=route_id,
            )
        )
        db.session.commit()

    res = client.post(f"/api/monthly_routes/routes/{route_id}/runs/skip?month=2026-04-01")
    assert res.status_code == 409
    assert res.get_json()["code"] == "history_exists"


def test_skip_appears_in_runs_by_month(skip_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = skip_client
    with app.app_context():
        route_id, _, _ = seed_route_with_two_stops(route_id=8, primary_id=801, secondary_id=802)

    assert client.post(
        f"/api/monthly_routes/routes/{route_id}/runs/skip?month=2026-03-01"
    ).status_code == 200

    with app.app_context():
        runs = mr_mod._runs_by_month_for_route(route_id)
    assert "2026-03-01" in runs
    row = runs["2026-03-01"]
    assert row["workflow_stage"] == "skipped"
    assert row["workflow_stage_label"] == "Skipped"
    assert row["stops_tested_count"] == 0
    assert row["stops_on_route_count"] == 2


def test_skip_blocked_beyond_current_plus_one(skip_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = skip_client
    with app.app_context():
        route_id, _, _ = seed_route_with_two_stops(route_id=8, primary_id=801, secondary_id=802)

    res = client.post(f"/api/monthly_routes/routes/{route_id}/runs/skip?month=2026-08-01")
    assert res.status_code == 409
    assert res.get_json()["code"] == "month_out_of_range"
