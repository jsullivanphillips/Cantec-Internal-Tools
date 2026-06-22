"""Office draft prep: skip / unskip a single active site."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import MonthlyLocation, MonthlyLocationMonth, MonthlyRouteRun, db
from app.monthly.history_source import HISTORY_SOURCE_OFFICE_PREP
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


def test_prep_skip_site_sets_outcome_comment_and_unskip(stops_client, monkeypatch):
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
            id=5020,
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
    skip = client.post(
        f"/api/monthly_routes/routes/1/worksheet/locations/{ts_id}/prep_skip?{qs}",
        json={
            "skip_category": "access_issues",
            "skip_note": "Gate locked — skip this month",
        },
    )
    assert skip.status_code == 200
    stop = skip.get_json()["stop"]
    assert stop["test_outcome"] == "skipped"
    assert stop["skip_category"] == "access_issues"
    assert "Gate locked" in (stop["office_job_comment"] or "")
    assert stop["office_attention"] is True

    with app.app_context():
        mlm = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=ts_id,
            month_date=date(2026, 5, 1),
        ).one()
        assert mlm.history_source == HISTORY_SOURCE_OFFICE_PREP
        assert mlm.billing_status in (None, "unset")

    unskip = client.delete(
        f"/api/monthly_routes/routes/1/worksheet/locations/{ts_id}/prep_skip?{qs}",
    )
    assert unskip.status_code == 200
    cleared = unskip.get_json()["stop"]
    assert cleared["test_outcome"] in (None, "")
    assert cleared["office_job_comment"] in (None, "")


def test_prep_skip_blocked_when_prepared(stops_client, monkeypatch):
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 5, 1))

    client, app = stops_client
    with app.app_context():
        _seed_route_with_two_stops()
        ts_id = int(MonthlyLocation.query.order_by(MonthlyLocation.id.asc()).first().id)
        run = MonthlyRouteRun(
            id=5021,
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
        f"/api/monthly_routes/routes/1/worksheet/locations/{ts_id}/prep_skip?month=2026-05-01",
        json={"skip_category": "other", "skip_note": "No access"},
    )
    assert blocked.status_code == 409
    assert blocked.get_json().get("code") == "run_prep_locked"


def test_prep_skip_blocked_for_on_hold_site(stops_client, monkeypatch):
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
            id=5022,
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
        f"/api/monthly_routes/routes/1/worksheet/locations/{ts_id}/prep_skip?month=2026-05-01",
        json={"skip_category": "other", "skip_note": "Should fail"},
    )
    assert blocked.status_code == 409
    assert blocked.get_json().get("code") == "location_not_active"


def test_prep_skip_allowed_when_only_legacy_result_status_skipped(stops_client, monkeypatch):
    from app.db_models import MonthlyLocationMonth
    from app.routes import monthly_routes as mr_mod

    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: date(2026, 7, 1))

    client, app = stops_client
    with app.app_context():
        _seed_route_with_two_stops()
        ts_id = int(MonthlyLocation.query.order_by(MonthlyLocation.id.asc()).first().id)
        loc = db.session.get(MonthlyLocation, ts_id)
        assert loc is not None
        loc.status_normalized = "active"
        loc.annual_month = "July"
        run = MonthlyRouteRun(
            id=5023,
            monthly_route_id=1,
            month_date=date(2026, 7, 1),
            status="open",
            source="office_manual",
        )
        db.session.add(run)
        db.session.commit()
        from app.monthly.worksheet_locations import ensure_worksheet_stops_for_route_month

        ensure_worksheet_stops_for_route_month(1, date(2026, 7, 1), run)
        mlm = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=ts_id,
            month_date=date(2026, 7, 1),
        ).one()
        mlm.result_status = "skipped"
        mlm.skip_reason = "annual"
        db.session.commit()

    with client.session_transaction() as sess:
        sess["authenticated"] = True

    skip = client.post(
        f"/api/monthly_routes/routes/1/worksheet/locations/{ts_id}/prep_skip?month=2026-07-01",
        json={"skip_category": "access_issues", "skip_note": "Office skip despite legacy annual"},
    )
    assert skip.status_code == 200
    stop = skip.get_json()["stop"]
    assert stop["test_outcome"] == "skipped"
    assert stop["skip_category"] == "access_issues"
