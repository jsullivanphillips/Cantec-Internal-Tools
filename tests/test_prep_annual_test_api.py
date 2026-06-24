"""Office draft prep: force monthly test despite ServiceTrade annual skip."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import MonthlyLocation, MonthlyLocationMonth, MonthlyRouteRun, db
from tests.monthly_location_helpers import WORKSHEET_TABLES
from tests.test_worksheet_stops_api import _seed_route_with_two_stops

PACIFIC_TZ = ZoneInfo("America/Vancouver")


@pytest.fixture
def stops_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    tables = WORKSHEET_TABLES
    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["tech_portal_unlocked"] = True
                sess["username"] = "office_tester"
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


def test_prep_annual_test_sets_override_and_clears(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        _seed_route_with_two_stops()
        ts_id = int(MonthlyLocation.query.order_by(MonthlyLocation.id.asc()).first().id)
        loc = db.session.get(MonthlyLocation, ts_id)
        assert loc is not None
        loc.status_normalized = "active"
        run = MonthlyRouteRun(
            id=5030,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            status="open",
            source="office_manual",
        )
        db.session.add(run)
        db.session.commit()
        from app.monthly.worksheet_locations import ensure_worksheet_stops_for_route_month

        ensure_worksheet_stops_for_route_month(1, date(2026, 5, 1), run)
        db.session.commit()

    with client.session_transaction() as sess:
        sess["authenticated"] = True

    qs = "month=2026-05-01"
    override = client.post(
        f"/api/monthly_routes/routes/1/worksheet/locations/{ts_id}/prep_annual_test?{qs}",
        json={"reason": "Client requested monthly test this cycle"},
    )
    assert override.status_code == 200
    stop = override.get_json()["stop"]
    assert stop["annual_test_override"] is True
    assert "Client requested" in (stop["annual_test_override_reason"] or "")
    assert stop["office_attention"] is True

    with app.app_context():
        mlm = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=ts_id,
            month_date=date(2026, 5, 1),
        ).one()
        assert mlm.annual_test_override is True
        assert mlm.annual_test_override_reason is not None

    cleared = client.delete(
        f"/api/monthly_routes/routes/1/worksheet/locations/{ts_id}/prep_annual_test?{qs}",
    )
    assert cleared.status_code == 200
    cleared_stop = cleared.get_json()["stop"]
    assert cleared_stop["annual_test_override"] is False
    assert cleared_stop["annual_test_override_reason"] in (None, "")


def test_prep_annual_test_no_reason_succeeds(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        _seed_route_with_two_stops()
        ts_id = int(MonthlyLocation.query.order_by(MonthlyLocation.id.asc()).first().id)
        loc = db.session.get(MonthlyLocation, ts_id)
        assert loc is not None
        loc.status_normalized = "active"
        run = MonthlyRouteRun(
            id=5034,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            status="open",
            source="office_manual",
        )
        db.session.add(run)
        db.session.commit()
        from app.monthly.worksheet_locations import ensure_worksheet_stops_for_route_month

        ensure_worksheet_stops_for_route_month(1, date(2026, 5, 1), run)
        db.session.commit()

    with client.session_transaction() as sess:
        sess["authenticated"] = True

    qs = "month=2026-05-01"
    override = client.post(
        f"/api/monthly_routes/routes/1/worksheet/locations/{ts_id}/prep_annual_test?{qs}",
    )
    assert override.status_code == 200
    stop = override.get_json()["stop"]
    assert stop["annual_test_override"] is True
    assert stop["annual_test_override_reason"] in (None, "")
    assert stop["office_attention"] is not True

    with app.app_context():
        mlm = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=ts_id,
            month_date=date(2026, 5, 1),
        ).one()
        assert mlm.annual_test_override is True
        assert mlm.annual_test_override_reason is None


def test_prep_annual_test_blocked_when_prepared(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        _seed_route_with_two_stops()
        ts_id = int(MonthlyLocation.query.order_by(MonthlyLocation.id.asc()).first().id)
        run = MonthlyRouteRun(
            id=5031,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            status="open",
            source="office_manual",
            prepared_at=datetime(2026, 5, 1, 8, 0, tzinfo=PACIFIC_TZ),
        )
        db.session.add(run)
        db.session.commit()
        from app.monthly.worksheet_locations import ensure_worksheet_stops_for_route_month

        ensure_worksheet_stops_for_route_month(1, date(2026, 5, 1), run)
        db.session.commit()

    with client.session_transaction() as sess:
        sess["authenticated"] = True

    blocked = client.post(
        f"/api/monthly_routes/routes/1/worksheet/locations/{ts_id}/prep_annual_test?month=2026-05-01",
        json={"reason": "Should fail"},
    )
    assert blocked.status_code == 409
    assert blocked.get_json().get("code") == "run_prep_locked"


def test_prep_annual_test_blocked_for_on_hold_site(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        _seed_route_with_two_stops()
        ts_id = int(MonthlyLocation.query.order_by(MonthlyLocation.id.asc()).first().id)
        loc = db.session.get(MonthlyLocation, ts_id)
        assert loc is not None
        loc.status_normalized = "on_hold"
        run = MonthlyRouteRun(
            id=5032,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            status="open",
            source="office_manual",
        )
        db.session.add(run)
        db.session.commit()
        from app.monthly.worksheet_locations import ensure_worksheet_stops_for_route_month

        ensure_worksheet_stops_for_route_month(1, date(2026, 5, 1), run)
        db.session.commit()

    with client.session_transaction() as sess:
        sess["authenticated"] = True

    blocked = client.post(
        f"/api/monthly_routes/routes/1/worksheet/locations/{ts_id}/prep_annual_test?month=2026-05-01",
        json={"reason": "Should fail"},
    )
    assert blocked.status_code == 409
    assert blocked.get_json().get("code") == "location_not_active"


def test_prep_annual_test_idempotent_when_already_overridden(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        _seed_route_with_two_stops()
        ts_id = int(MonthlyLocation.query.order_by(MonthlyLocation.id.asc()).first().id)
        run = MonthlyRouteRun(
            id=5035,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            status="open",
            source="office_manual",
        )
        db.session.add(run)
        db.session.commit()
        from app.monthly.worksheet_locations import ensure_worksheet_stops_for_route_month

        ensure_worksheet_stops_for_route_month(1, date(2026, 5, 1), run)
        db.session.commit()

    with client.session_transaction() as sess:
        sess["authenticated"] = True

    qs = "month=2026-05-01"
    first = client.post(
        f"/api/monthly_routes/routes/1/worksheet/locations/{ts_id}/prep_annual_test?{qs}",
    )
    assert first.status_code == 200
    assert first.get_json()["stop"]["annual_test_override"] is True

    second = client.post(
        f"/api/monthly_routes/routes/1/worksheet/locations/{ts_id}/prep_annual_test?{qs}",
    )
    assert second.status_code == 200
    assert second.get_json()["stop"]["annual_test_override"] is True
