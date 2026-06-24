"""Persisted ServiceTrade annual schedule cache on monthly_location_month."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import MonthlyLocation, MonthlyLocationMonth, MonthlyRouteRun, db
from app.monthly.service_trade_annual_schedule import (
    annual_schedule_location_rows_by_id,
    persist_route_annual_schedule_snapshot,
    sync_route_annual_schedule,
)
from app.monthly.worksheet_locations import serialize_worksheet_location
from tests.monthly_location_helpers import WORKSHEET_TABLES
from tests.test_worksheet_stops_api import _seed_route_with_two_stops

PACIFIC_TZ = ZoneInfo("America/Vancouver")


@pytest.fixture
def cache_client(monkeypatch):
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
                sess["authenticated"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


def _sample_snapshot(route_id: int, month_first: date, location_id: int) -> dict[str, object]:
    return {
        "route_id": route_id,
        "month_date": month_first.isoformat(),
        "checked_at": datetime(2026, 6, 1, 9, 0, tzinfo=PACIFIC_TZ).isoformat(),
        "warning_count": 0,
        "locations": {
            str(location_id): {
                "location_id": location_id,
                "has_service_trade_link": True,
                "service_trade_site_location_url": "https://app.servicetrade.com/locations/1",
                "has_scheduled_annual_in_month": True,
                "annual_spans_months": False,
                "annual_skip_recommended": True,
                "annual_test_recommended": False,
                "spanning_job_id": None,
                "prep_warning": None,
            }
        },
    }


def test_persist_route_annual_schedule_snapshot_writes_mlm(cache_client):
    _client, app = cache_client
    month_first = date(2026, 6, 1)
    with app.app_context():
        _route_id, primary_id, _secondary_id = _seed_route_with_two_stops()
        ts_id = int(primary_id)
        run = MonthlyRouteRun(
            id=8801,
            monthly_route_id=1,
            month_date=month_first,
            status="open",
            source="office_manual",
        )
        db.session.add(run)
        db.session.commit()
        persist_route_annual_schedule_snapshot(
            1,
            month_first,
            _sample_snapshot(1, month_first, ts_id),
        )
        mlm = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=ts_id,
            month_date=month_first,
        ).one()
        assert mlm.st_annual_skip_recommended is True
        assert mlm.st_has_scheduled_annual_in_month is True
        assert mlm.st_annual_synced_at is not None


def test_annual_schedule_location_rows_by_id_reads_db_only(cache_client, monkeypatch):
    _client, app = cache_client
    month_first = date(2026, 6, 1)

    def _fail_live_sync(*_args, **_kwargs):
        raise AssertionError("live ServiceTrade sync should not run on DB read")

    monkeypatch.setattr(
        "app.monthly.service_trade_annual_schedule.build_route_annual_schedule_snapshot",
        _fail_live_sync,
    )

    with app.app_context():
        _route_id, primary_id, _secondary_id = _seed_route_with_two_stops()
        ts_id = int(primary_id)
        run = MonthlyRouteRun(
            id=8802,
            monthly_route_id=1,
            month_date=month_first,
            status="open",
            source="office_manual",
        )
        db.session.add(run)
        db.session.commit()
        persist_route_annual_schedule_snapshot(
            1,
            month_first,
            _sample_snapshot(1, month_first, ts_id),
        )
        rows = annual_schedule_location_rows_by_id(1, month_first)
        assert rows is not None
        assert rows[ts_id]["annual_skip_recommended"] is True


def test_annual_schedule_check_endpoint_persists_snapshot(cache_client, monkeypatch):
    client, app = cache_client
    month_first = date(2026, 6, 1)
    with app.app_context():
        _route_id, primary_id, _secondary_id = _seed_route_with_two_stops()
        ts_id = int(primary_id)

    monkeypatch.setattr(
        "app.monthly.service_trade_annual_schedule.build_route_annual_schedule_snapshot",
        lambda route_id, month: _sample_snapshot(route_id, month, ts_id),
    )

    res = client.get(
        f"/api/monthly_routes/routes/1/runs/annual_schedule_check?month_date={month_first.isoformat()}"
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body["locations"][str(ts_id)]["annual_skip_recommended"] is True

    with app.app_context():
        mlm = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=ts_id,
            month_date=month_first,
        ).one()
        assert mlm.st_annual_skip_recommended is True


def test_scheduled_annual_auto_skip_respects_cache_and_override(cache_client):
    _client, app = cache_client
    month_first = date(2026, 6, 1)
    with app.app_context():
        _route_id, primary_id, _secondary_id = _seed_route_with_two_stops()
        loc = db.session.get(MonthlyLocation, primary_id)
        assert loc is not None
        mlm = MonthlyLocationMonth(
            id=99001,
            monthly_location_id=primary_id,
            month_date=month_first,
            test_monthly_route_id=1,
        )
        db.session.add(mlm)
        db.session.commit()
        mlm.st_annual_skip_recommended = True
        mlm.st_annual_synced_at = datetime(2026, 6, 1, 8, 0, tzinfo=PACIFIC_TZ)
        db.session.commit()

        stop = serialize_worksheet_location(
            loc,
            mlm,
            route_id=1,
            month_first=month_first,
            stop_number=1,
            run=None,
            include_portal_extras=False,
        )
        assert stop["scheduled_annual_auto_skip"] is True

        mlm.annual_test_override = True
        db.session.commit()
        stop_override = serialize_worksheet_location(
            loc,
            mlm,
            route_id=1,
            month_first=month_first,
            stop_number=1,
            run=None,
            include_portal_extras=False,
        )
        assert stop_override["scheduled_annual_auto_skip"] is False


def test_dashboard_annual_count_uses_cached_mlm_without_live_sync(
    cache_client, monkeypatch
):
    from app.routes import monthly_routes as mr_mod

    client, app = cache_client
    month_first = date(2026, 6, 1)
    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: month_first)

    def _fail_live_sync(*_args, **_kwargs):
        raise AssertionError("dashboard must not call live ServiceTrade sync")

    monkeypatch.setattr(
        "app.monthly.service_trade_annual_schedule.build_route_annual_schedule_snapshot",
        _fail_live_sync,
    )

    with app.app_context():
        _route_id, primary_id, _secondary_id = _seed_route_with_two_stops()
        ts_id = int(primary_id)
        mlm = MonthlyLocationMonth(
            id=99002,
            monthly_location_id=ts_id,
            month_date=month_first,
            test_monthly_route_id=1,
            st_annual_skip_recommended=True,
            st_annual_synced_at=datetime(2026, 6, 1, 8, 0, tzinfo=PACIFIC_TZ),
        )
        db.session.add(mlm)
        db.session.commit()

    res = client.get("/api/monthly_routes/dashboard")
    assert res.status_code == 200
    row = next(r for r in res.get_json()["routes"] if r["route"]["id"] == 1)
    assert row["route"]["annual_count"] == 1


def test_sync_route_annual_schedule_calls_live_and_persist(cache_client, monkeypatch):
    _client, app = cache_client
    month_first = date(2026, 6, 1)
    calls: list[tuple[int, date]] = []

    def _fake_build(route_id: int, month: date) -> dict[str, object]:
        calls.append((route_id, month))
        return _sample_snapshot(route_id, month, 101)

    monkeypatch.setattr(
        "app.monthly.service_trade_annual_schedule.build_route_annual_schedule_snapshot",
        _fake_build,
    )

    with app.app_context():
        _seed_route_with_two_stops()
        payload = sync_route_annual_schedule(1, month_first)
        assert payload["route_id"] == 1
        assert calls == [(1, month_first)]
