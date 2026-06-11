"""Monthly route run workflow: prepare, field end, office review, complete."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import (
    MonthlyLocation,
    MonthlyLocationMonth,
    MonthlyRouteRun,
    db,
)
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location, seed_route_with_one_stop
from tests.run_workflow_helpers import office_prepare_run, portal_start_run, seed_prepared_started_run

PACIFIC_TZ = ZoneInfo("America/Vancouver")


@pytest.fixture
def workflow_client(monkeypatch):
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
                sess["username"] = "office_tester"
                sess["authenticated"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(WORKSHEET_TABLES)))


def _seed_route() -> int:
    _, location_id = seed_route_with_one_stop()
    return location_id


def test_office_unprepare_before_field_start(workflow_client):
    client, app = workflow_client
    with app.app_context():
        _seed_route()
    office_prepare_run(client)
    with app.app_context():
        run = MonthlyRouteRun.query.filter_by(monthly_route_id=1, month_date=date(2026, 5, 1)).one()
        assert run.prepared_at is not None

    unprepare = client.post(
        "/api/monthly_routes/routes/1/runs/unprepare",
        json={"month_date": "2026-05-01"},
    )
    assert unprepare.status_code == 200
    body = unprepare.get_json()["run"]
    assert body.get("prepared_at") is None
    assert body.get("workflow_stage") == "draft"

    blocked = client.post("/api/technician_portal/routes/1/runs")
    assert blocked.status_code == 409
    assert blocked.get_json().get("code") == "run_not_prepared"


def test_office_unprepare_rejected_after_field_start(workflow_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = workflow_client
    with app.app_context():
        _seed_route()
    portal_start_run(client)

    res = client.post(
        "/api/monthly_routes/routes/1/runs/unprepare",
        json={"month_date": "2026-05-01"},
    )
    assert res.status_code == 409
    assert res.get_json().get("code") == "run_field_started"


def test_portal_start_blocked_without_prepare(workflow_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = workflow_client
    with app.app_context():
        _seed_route()

    res = client.post("/api/technician_portal/routes/1/runs")
    assert res.status_code == 409
    assert res.get_json().get("code") == "run_not_prepared"


def test_prepare_future_month_blocked_until_current_closed(workflow_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = workflow_client
    with app.app_context():
        _seed_route()
        seed_prepared_started_run(1, date(2026, 6, 1), field_ended=True)

    res = client.post(
        "/api/monthly_routes/routes/1/runs/prepare",
        json={"month_date": "2026-07-01"},
    )
    assert res.status_code == 409
    assert res.get_json().get("code") == "current_month_not_closed"


def test_prepare_future_month_allowed_when_current_closed(workflow_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = workflow_client
    with app.app_context():
        _seed_route()
        seed_prepared_started_run(
            1,
            date(2026, 6, 1),
            field_ended=True,
            review_complete=True,
            completed=True,
        )

    res = client.post(
        "/api/monthly_routes/routes/1/runs/prepare",
        json={"month_date": "2026-07-01"},
    )
    assert res.status_code == 200
    assert res.get_json()["run"]["workflow_stage"] == "prepared"


def test_field_end_and_reopen_field(workflow_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = workflow_client
    with app.app_context():
        _seed_route()
    portal_start_run(client)

    end = client.post("/api/technician_portal/routes/1/runs/end")
    assert end.status_code == 200
    assert end.get_json()["run"]["field_ended_at"] is not None
    assert end.get_json()["run"]["workflow_stage"] == "awaiting_office_review"

    reopen = client.post("/api/technician_portal/routes/1/runs/reopen_field")
    assert reopen.status_code == 200
    body = reopen.get_json()["run"]
    assert body.get("field_ended_at") is None
    assert body.get("workflow_stage") == "field_in_progress"


def test_office_complete_requires_review(workflow_client):
    client, app = workflow_client
    with app.app_context():
        _seed_route()
        seed_prepared_started_run(1, date(2026, 5, 1), field_ended=True)

    complete = client.post(
        "/api/monthly_routes/routes/1/runs/complete",
        json={"month_date": "2026-05-01"},
    )
    assert complete.status_code == 409
    assert complete.get_json().get("code") == "office_review_required"


def test_office_workflow_happy_path(workflow_client):
    client, app = workflow_client
    with app.app_context():
        _seed_route()
        seed_prepared_started_run(1, date(2026, 5, 1), field_ended=True)

    review = client.post(
        "/api/monthly_routes/routes/1/runs/review_complete",
        json={"month_date": "2026-05-01"},
    )
    assert review.status_code == 200
    assert review.get_json()["run"]["office_review_completed_at"] is not None

    complete = client.post(
        "/api/monthly_routes/routes/1/runs/complete",
        json={"month_date": "2026-05-01"},
    )
    assert complete.status_code == 200
    assert complete.get_json()["run"]["workflow_stage"] == "completed"


def test_office_outcome_patch_after_field_end(workflow_client):
    client, app = workflow_client
    with app.app_context():
        location_id = _seed_route()
        run = seed_prepared_started_run(1, date(2026, 5, 1), field_ended=True)
        db.session.add(
            MonthlyLocationMonth(
                id=9001,
                monthly_location_id=location_id,
                month_date=date(2026, 5, 1),
                test_monthly_route_id=1,
                run_id=int(run.id),
            )
        )
        db.session.commit()

    patch = client.patch(
        f"/api/monthly_routes/routes/1/worksheet/rows/{location_id}?month=2026-05-01",
        json={"changes": {"result_status": "tested"}},
    )
    assert patch.status_code == 200


def test_office_test_outcome_set_and_clear(workflow_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = workflow_client
    with app.app_context():
        from app.monthly.worksheet_locations import ensure_worksheet_stops_for_route_month

        location_id = _seed_route()
        run = seed_prepared_started_run(1, date(2026, 5, 1), field_ended=True)
        ensure_worksheet_stops_for_route_month(1, date(2026, 5, 1), run)
        db.session.commit()

    put_good = client.put(
        f"/api/monthly_routes/routes/1/worksheet/locations/{location_id}/test_outcome?month=2026-05-01",
        json={"test_outcome": "all_good"},
    )
    assert put_good.status_code == 200
    assert put_good.get_json()["stop"]["test_outcome"] == "all_good"

    cleared = client.put(
        f"/api/monthly_routes/routes/1/worksheet/locations/{location_id}/test_outcome?month=2026-05-01",
        json={"clear": True},
    )
    assert cleared.status_code == 200
    assert not cleared.get_json()["stop"].get("test_outcome")

    with app.app_context():
        run = MonthlyRouteRun.query.filter_by(monthly_route_id=1, month_date=date(2026, 5, 1)).one()
        run.field_ended_at = None
        run.started_at = None
        db.session.commit()

    blocked = client.put(
        f"/api/monthly_routes/routes/1/worksheet/locations/{location_id}/test_outcome?month=2026-05-01",
        json={"test_outcome": "failed"},
    )
    assert blocked.status_code == 409
    assert blocked.get_json().get("code") == "office_outcome_before_field_end"


def test_review_complete_ignores_cancelled_location_billing(workflow_client, monkeypatch):
    """Cancelled library stops hidden from run review must not block review complete."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = workflow_client
    with app.app_context():
        location_id = _seed_route()
        cancelled = make_location(
            id=102,
            address="999 Cancelled Ave",
            label="999 Cancelled Ave",
            status_normalized="cancelled",
            status_raw="Cancelled",
            monthly_route_id=1,
            route_stop_order=2,
        )
        db.session.add(cancelled)
        now = datetime(2026, 6, 10, 12, 0, tzinfo=PACIFIC_TZ)
        run = MonthlyRouteRun(
            id=9101,
            monthly_route_id=1,
            month_date=date(2026, 6, 1),
            opened_at=now,
            prepared_at=now,
            started_at=now,
            field_ended_at=now,
            status="open",
        )
        db.session.add(run)
        db.session.add_all(
            [
                MonthlyLocationMonth(
                    id=9102,
                    monthly_location_id=location_id,
                    month_date=date(2026, 6, 1),
                    test_monthly_route_id=1,
                    run_id=int(run.id),
                    test_outcome="all_good",
                    result_status="tested",
                    billing_status="bill",
                ),
                MonthlyLocationMonth(
                    id=9103,
                    monthly_location_id=102,
                    month_date=date(2026, 6, 1),
                    test_monthly_route_id=1,
                    run_id=int(run.id),
                    billing_status="unset",
                ),
            ]
        )
        db.session.commit()

    review = client.post(
        "/api/monthly_routes/routes/1/runs/review_complete",
        json={"month_date": "2026-06-01"},
    )
    assert review.status_code == 200, review.get_data(as_text=True)
    assert review.get_json()["run"]["office_review_completed_at"] is not None

    with app.app_context():
        hidden = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=102,
            month_date=date(2026, 6, 1),
        ).one()
        assert hidden.billing_status == "unset"


def test_review_complete_after_reopen_resolves_skipped_billing(workflow_client, monkeypatch):
    """Reopened CSV-import edits can mark review complete once billing defaults apply."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = workflow_client
    with app.app_context():
        location_id = _seed_route()
        now = datetime(2026, 6, 10, 12, 0, tzinfo=PACIFIC_TZ)
        run = MonthlyRouteRun(
            id=9101,
            monthly_route_id=1,
            month_date=date(2026, 6, 1),
            opened_at=now,
            prepared_at=now,
            started_at=now,
            field_ended_at=now,
            status="completed",
            completed_at=now,
            source="csv_import",
        )
        db.session.add(run)
        db.session.add(
            MonthlyLocationMonth(
                id=9102,
                monthly_location_id=location_id,
                month_date=date(2026, 6, 1),
                test_monthly_route_id=1,
                run_id=int(run.id),
                test_outcome="skipped",
                skip_category="other",
                result_status="skipped",
                billing_status="unset",
            )
        )
        db.session.commit()

    reopen = client.post(
        "/api/monthly_routes/routes/1/runs/reopen",
        json={"month_date": "2026-06-01"},
    )
    assert reopen.status_code == 200

    review = client.post(
        "/api/monthly_routes/routes/1/runs/review_complete",
        json={"month_date": "2026-06-01"},
    )
    assert review.status_code == 200, review.get_data(as_text=True)
    assert review.get_json()["run"]["office_review_completed_at"] is not None

    with app.app_context():
        row = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=location_id,
            month_date=date(2026, 6, 1),
        ).one()
        assert row.billing_status == "do_not_bill"


def test_csv_import_reopened_allows_office_billing_and_outcome(workflow_client, monkeypatch):
    """CSV-import runs stay portal read-only but office may edit review fields after reopen."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 6, 1))

    client, app = workflow_client
    with app.app_context():
        from app.monthly.worksheet_locations import ensure_worksheet_stops_for_route_month

        location_id = _seed_route()
        now = datetime(2026, 5, 15, 12, 0, tzinfo=PACIFIC_TZ)
        run = MonthlyRouteRun(
            id=9001,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            opened_at=now,
            prepared_at=now,
            started_at=now,
            field_ended_at=now,
            status="completed",
            completed_at=now,
            source="csv_import",
        )
        db.session.add(run)
        db.session.add(
            MonthlyLocationMonth(
                id=5001,
                monthly_location_id=location_id,
                month_date=date(2026, 5, 1),
                test_monthly_route_id=1,
                run_id=int(run.id),
                result_status="tested",
                billing_status="unset",
            )
        )
        db.session.commit()
        ensure_worksheet_stops_for_route_month(1, date(2026, 5, 1), run)
        db.session.commit()

    reopen = client.post(
        "/api/monthly_routes/routes/1/runs/reopen",
        json={"month_date": "2026-05-01"},
    )
    assert reopen.status_code == 200, reopen.get_data(as_text=True)
    assert reopen.get_json()["run"]["completed_at"] is None

    billing = client.patch(
        f"/api/monthly_routes/routes/1/locations/{location_id}/billing_status?month=2026-05-01",
        json={"billing_status": "bill"},
    )
    assert billing.status_code == 200, billing.get_data(as_text=True)
    assert billing.get_json()["billing_status"] == "bill"

    outcome = client.put(
        f"/api/monthly_routes/routes/1/worksheet/locations/{location_id}/test_outcome?month=2026-05-01",
        json={"test_outcome": "all_good"},
    )
    assert outcome.status_code == 200, outcome.get_data(as_text=True)
    assert outcome.get_json()["stop"]["test_outcome"] == "all_good"
