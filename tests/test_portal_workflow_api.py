"""Portal workflow API: clock events, test outcomes, billing, deficiencies, per-stop reset."""

from __future__ import annotations

from datetime import date

import pytest

from app import create_app
from app.db_models import (
    MonthlyLocationDeficiency,
    MonthlyLocationMonth,
    MonthlyRouteRun,
    MonthlyRouteWorksheetAuditEvent,
    db,
)
from app.monthly.portal_workflow import get_location_billing_status
from tests.monthly_location_helpers import WORKSHEET_TABLES, seed_route_with_two_stops


@pytest.fixture
def portal_client(monkeypatch):
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
                sess["portal_tech_id"] = "1001"
                sess["portal_tech_name"] = "Test Tech"
                sess["username"] = "office_tester"
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(WORKSHEET_TABLES)))


def _seed_route_with_two_stops() -> tuple[int, int, int, int]:
    route_id, primary_id, secondary_id = seed_route_with_two_stops()
    return route_id, primary_id, primary_id, secondary_id


def _start_run(client, route_id: int = 1) -> None:
    from tests.run_workflow_helpers import portal_start_run

    portal_start_run(client, route_id)


def test_technician_session_and_list(portal_client):
    client, _app = portal_client
    res = client.get("/api/technician_portal/session/technician")
    assert res.status_code == 200
    body = res.get_json()
    assert body["technician"]["name"] == "Test Tech"

    techs = client.get("/api/technician_portal/technicians")
    assert techs.status_code == 200
    assert isinstance(techs.get_json().get("technicians"), list)


def test_clock_in_conflict_and_workflow(portal_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = portal_client
    with app.app_context():
        route_id, _loc_id, stop_a, stop_b = _seed_route_with_two_stops()

    _start_run(client)
    month = "2026-05-01"

    cin_a = client.post(
        f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_a}/clock_events/clock_in"
        f"?month={month}&tech_portal=1",
        json={"time_in": "9:00 AM", "stop_number": 1},
    )
    assert cin_a.status_code == 200
    assert cin_a.get_json()["stop"]["stop_number"] == 1

    cancel_a = client.post(
        f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_a}/clock_events/cancel_clock_in"
        f"?month={month}&tech_portal=1",
        json={},
    )
    assert cancel_a.status_code == 200
    stop_a_payload = cancel_a.get_json()["stop"]
    assert not stop_a_payload.get("clock_events") or all(
        ev.get("time_out") for ev in stop_a_payload.get("clock_events", [])
    )

    cin_a_again = client.post(
        f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_a}/clock_events/clock_in"
        f"?month={month}&tech_portal=1",
        json={"time_in": "9:00 AM"},
    )
    assert cin_a_again.status_code == 200

    cin_b = client.post(
        f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_b}/clock_events/clock_in"
        f"?month={month}&tech_portal=1",
        json={"time_in": "9:05 AM"},
    )
    assert cin_b.status_code == 409
    assert cin_b.get_json().get("code") == "open_clock_in_conflict"

    put_skip_b = client.put(
        f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_b}/test_outcome"
        f"?month={month}&tech_portal=1",
        json={
            "test_outcome": "skipped",
            "skip_category": "access_issues",
            "skip_note": "Gate locked",
        },
    )
    assert put_skip_b.status_code == 200

    cout_a = client.post(
        f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_a}/clock_events/clock_out"
        f"?month={month}&tech_portal=1",
        json={"time_out": "9:30 AM"},
    )
    assert cout_a.status_code == 200

    put_good = client.put(
        f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_a}/test_outcome"
        f"?month={month}&tech_portal=1",
        json={"test_outcome": "all_good", "stop_number": 1},
    )
    assert put_good.status_code == 200
    assert put_good.get_json()["stop"]["stop_number"] == 1

    with app.app_context():
        assert get_location_billing_status(101, date(2026, 5, 1)) == "bill"


def test_transition_clock_between_stops(portal_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = portal_client
    with app.app_context():
        route_id, _loc_id, stop_a, stop_b = _seed_route_with_two_stops()

    _start_run(client)
    month = "2026-05-01"

    cin_a = client.post(
        f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_a}/clock_events/clock_in"
        f"?month={month}&tech_portal=1",
        json={"time_in": "9:00 AM"},
    )
    assert cin_a.status_code == 200

    transition = client.post(
        f"/api/monthly_routes/routes/{route_id}/worksheet/transition_clock"
        f"?month={month}&tech_portal=1",
        json={
            "from_testing_site_id": stop_a,
            "to_testing_site_id": stop_b,
            "time_out": "9:30 AM",
            "time_in": "9:35 AM",
        },
    )
    assert transition.status_code == 200
    body = transition.get_json()
    from_stop = body["from_stop"]
    to_stop = body["to_stop"]
    from_events = from_stop.get("clock_events") or []
    to_events = to_stop.get("clock_events") or []
    assert from_events
    assert all(ev.get("time_out") for ev in from_events)
    assert any(not ev.get("time_out") for ev in to_events)

    repeat = client.post(
        f"/api/monthly_routes/routes/{route_id}/worksheet/transition_clock"
        f"?month={month}&tech_portal=1",
        json={
            "from_testing_site_id": stop_a,
            "to_testing_site_id": stop_b,
            "time_out": "10:00 AM",
            "time_in": "10:05 AM",
        },
    )
    assert repeat.status_code == 200


def test_billing_unset_when_all_skipped(portal_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = portal_client
    with app.app_context():
        route_id, loc_id, stop_a, stop_b = _seed_route_with_two_stops()

    _start_run(client)
    month = "2026-05-01"
    for stop_id in (stop_a, stop_b):
        res = client.put(
            f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_id}/test_outcome"
            f"?month={month}&tech_portal=1",
            json={
                "test_outcome": "skipped",
                "skip_category": "testing_not_required",
                "skip_note": "Annual",
            },
        )
        assert res.status_code == 200

    with app.app_context():
        assert get_location_billing_status(loc_id, date(2026, 5, 1)) == "unset"


def test_reset_clears_outcome_and_legacy_result_status(portal_client, monkeypatch):
    """Per-stop reset must clear dual-written result_status, not only test_outcome."""
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = portal_client
    with app.app_context():
        route_id, _loc_id, stop_a, _stop_b = _seed_route_with_two_stops()

    _start_run(client)
    month = "2026-05-01"
    base = f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_a}"

    assert (
        client.post(f"{base}/clock_events/clock_in?month={month}&tech_portal=1", json={"time_in": "9:00 AM"}).status_code
        == 200
    )
    assert (
        client.put(
            f"{base}/test_outcome?month={month}&tech_portal=1",
            json={"test_outcome": "all_good"},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"{base}/clock_events/clock_out?month={month}&tech_portal=1",
            json={"time_out": "9:30 AM"},
        ).status_code
        == 200
    )

    reset = client.post(f"{base}/reset?month={month}&tech_portal=1")
    assert reset.status_code == 200
    stop = reset.get_json()["stop"]
    assert not (stop.get("test_outcome") or "").strip()
    assert not (stop.get("result_status") or "").strip()
    assert not stop.get("clock_events")
    assert stop.get("has_run_changes") is False
    assert stop.get("is_legacy_outcome") is False

    with app.app_context():
        mlm = MonthlyLocationMonth.query.filter_by(monthly_location_id=stop_a).one()
        assert mlm.test_outcome is None
        assert mlm.result_status is None


def test_deficiency_verify_and_reset(portal_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = portal_client
    with app.app_context():
        route_id, _loc_id, stop_a, _stop_b = _seed_route_with_two_stops()

    _start_run(client)
    month = "2026-05-01"

    created = client.post(
        f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_a}/deficiencies"
        f"?month={month}&tech_portal=1",
        json={
            "title": "Bell offline",
            "severity": "inoperable",
            "status": "new",
            "description": "No sound",
        },
    )
    assert created.status_code == 201
    def_id = created.get_json()["deficiency"]["id"]

    verified = client.post(
        f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_a}/deficiencies/{def_id}/verify"
        f"?month={month}&tech_portal=1",
        json={},
    )
    assert verified.status_code == 200
    notes = verified.get_json()["deficiency"]["verification_notes"]
    assert notes and "Verified by" in notes

    reset = client.post(
        f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_a}/reset"
        f"?month={month}&tech_portal=1",
    )
    assert reset.status_code == 200

    with app.app_context():
        assert MonthlyLocationDeficiency.query.filter_by(id=int(def_id)).count() == 0
        audit = MonthlyRouteWorksheetAuditEvent.query.filter_by(field_name="stop_reset").count()
        assert audit == 1


def test_worksheet_payload_includes_portal_fields(portal_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = portal_client
    with app.app_context():
        route_id, _loc_id, stop_a, _stop_b = _seed_route_with_two_stops()

    _start_run(client)
    res = client.get(
        f"/api/monthly_routes/routes/{route_id}/worksheet?month=2026-05-01&tech_portal=1"
    )
    assert res.status_code == 200
    stops = res.get_json().get("stops") or []
    assert len(stops) == 2
    stop = next(s for s in stops if int(s["testing_site_id"]) == stop_a)
    assert "clock_events" in stop
    assert "deficiencies" in stop
    assert "billing_status" in stop
    assert "portal_read_only" in stop
    assert stop["latitude"] == 48.4284
    assert stop["longitude"] == -123.3656


def test_test_outcome_validation_rules(portal_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = portal_client
    with app.app_context():
        route_id, _loc_id, stop_a, _stop_b = _seed_route_with_two_stops()

    _start_run(client)
    month = "2026-05-01"
    base = f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_a}/test_outcome?month={month}&tech_portal=1"

    all_good_first = client.put(base, json={"test_outcome": "all_good"})
    assert all_good_first.status_code == 200

    created = client.post(
        f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_a}/deficiencies"
        f"?month={month}&tech_portal=1",
        json={
            "title": "Smoke head",
            "severity": "deficient",
            "status": "new",
            "description": "Missing",
        },
    )
    assert created.status_code == 201
    def_id = created.get_json()["deficiency"]["id"]
    stop_after_create = created.get_json()["stop"]
    assert stop_after_create.get("test_outcome") == "passed_with_problems"

    blocked = client.put(base, json={"test_outcome": "all_good"})
    assert blocked.status_code == 400
    assert blocked.get_json().get("code") == "deficiencies_block_all_good"

    pwp_same_run = client.put(base, json={"test_outcome": "passed_with_problems"})
    assert pwp_same_run.status_code == 200

    failed_same_run = client.put(base, json={"test_outcome": "failed"})
    assert failed_same_run.status_code == 200

    reset = client.post(
        f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_a}/reset"
        f"?month={month}&tech_portal=1",
    )
    assert reset.status_code == 200

    with app.app_context():
        prior = MonthlyLocationDeficiency(
            id=5001,
            monthly_location_id=stop_a,
            created_run_id=None,
            title="Carry-over bell",
            severity="deficient",
            status="new",
            description="From a prior visit",
        )
        db.session.add(prior)
        db.session.commit()
        prior_id = int(prior.id)

    pwp_prior = client.put(base, json={"test_outcome": "passed_with_problems"})
    assert pwp_prior.status_code == 400
    assert pwp_prior.get_json().get("code") == "unverified_deficiencies"

    failed_prior = client.put(base, json={"test_outcome": "failed"})
    assert failed_prior.status_code == 400
    assert failed_prior.get_json().get("code") == "unverified_deficiencies"

    verified = client.post(
        f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_a}/deficiencies/{prior_id}/verify"
        f"?month={month}&tech_portal=1",
        json={},
    )
    assert verified.status_code == 200

    pwp_ok = client.put(base, json={"test_outcome": "passed_with_problems"})
    assert pwp_ok.status_code == 200

    reset = client.post(
        f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_a}/reset"
        f"?month={month}&tech_portal=1",
    )
    assert reset.status_code == 200

    with app.app_context():
        MonthlyLocationDeficiency.query.filter_by(monthly_location_id=stop_a).delete()
        db.session.commit()

    pwp_zero = client.put(base, json={"test_outcome": "passed_with_problems"})
    assert pwp_zero.status_code == 400
    assert pwp_zero.get_json().get("code") == "confirmed_no_deficiencies_required"

    pwp_confirmed = client.put(
        base,
        json={"test_outcome": "passed_with_problems", "confirmed_no_deficiencies": True},
    )
    assert pwp_confirmed.status_code == 200

    created = client.post(
        f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_a}/deficiencies"
        f"?month={month}&tech_portal=1",
        json={"title": "Bell not sounding", "severity": "deficient", "status": "new"},
    )
    assert created.status_code == 201
    stop_payload = created.get_json().get("stop") or {}
    assert stop_payload.get("confirmed_no_deficiencies") is False

    all_good_blocked = client.put(base, json={"test_outcome": "all_good"})
    assert all_good_blocked.status_code == 400


def test_csv_import_run_is_portal_read_only(portal_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = portal_client
    with app.app_context():
        route_id, _loc_id, stop_a, _stop_b = _seed_route_with_two_stops()
        run = MonthlyRouteRun(
            id=50,
            monthly_route_id=route_id,
            month_date=date(2026, 5, 1),
            status="completed",
            source="csv_import",
        )
        db.session.add(run)
        db.session.commit()

    blocked = client.post(
        f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_a}/clock_events/clock_in"
        f"?month=2026-05-01&tech_portal=1",
        json={"time_in": "8:00 AM"},
    )
    assert blocked.status_code == 409
    assert blocked.get_json().get("code") == "portal_read_only"


def test_test_outcome_annual_skip_category(portal_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = portal_client
    with app.app_context():
        route_id, _loc_id, stop_a, _stop_b = _seed_route_with_two_stops()

    _start_run(client)
    month = "2026-05-01"
    base = f"/api/monthly_routes/routes/{route_id}/worksheet/locations/{stop_a}/test_outcome?month={month}"

    res = client.put(
        base,
        json={"test_outcome": "skipped", "skip_category": "annual"},
    )
    assert res.status_code == 200
    stop = res.get_json()["stop"]
    assert stop["test_outcome"] == "skipped"
    assert stop["skip_category"] == "annual"
    assert stop["skip_reason"] == "annual"
