"""Unit tests for prior-month run pace comparison."""

from __future__ import annotations

from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import (
    MonthlyRoute,
    MonthlyRouteLocation,
    MonthlyRouteRun,
    MonthlySite,
    MonthlyStopClockEvent,
    MonthlyTestingSite,
    MonthlyTestingSiteMonth,
    db,
)
from app.monthly.run_pace_comparison import (
    _comparison_date_in_month,
    _format_time_label,
    _prior_month_first,
    compute_run_pace_comparison,
)

PACIFIC_TZ = ZoneInfo("America/Vancouver")


@pytest.fixture
def pace_app(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    tables = [
        MonthlyRoute.__table__,
        MonthlyRouteLocation.__table__,
        MonthlyRouteRun.__table__,
        MonthlySite.__table__,
        MonthlyTestingSite.__table__,
        MonthlyTestingSiteMonth.__table__,
        MonthlyStopClockEvent.__table__,
    ]

    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        yield app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


def test_prior_month_first_and_comparison_date_clamp():
    assert _prior_month_first(date(2026, 6, 1)) == date(2026, 5, 1)
    assert _prior_month_first(date(2026, 1, 1)) == date(2025, 12, 1)
    assert _comparison_date_in_month(date(2026, 2, 1), 31) == date(2026, 2, 28)
    assert _comparison_date_in_month(date(2024, 2, 1), 31) == date(2024, 2, 29)


def test_format_time_label():
    assert _format_time_label(time(10, 0)) == "10:00 AM"
    assert _format_time_label(time(14, 30)) == "2:30 PM"
    assert _format_time_label(time(0, 15)) == "12:15 AM"


def _seed_site(route_id: int = 1, testing_site_id: int = 1001) -> int:
    route = MonthlyRoute(id=route_id, route_number=1, weekday_iso=0, week_occurrence=1)
    loc = MonthlyRouteLocation(
        id=201,
        address="100 Main St",
        address_normalized="100 main st",
        property_management_company="Acme",
        property_management_company_normalized="acme",
        building="A",
        building_normalized="a",
        status_normalized="active",
        status_raw="Active",
        monthly_route_id=route_id,
        route_stop_order=0,
    )
    site = MonthlySite(id=301, legacy_monthly_route_location_id=201)
    ts = MonthlyTestingSite(
        id=testing_site_id,
        monthly_site_id=301,
        sort_order=0,
        label="Main",
    )
    db.session.add_all([route, loc, site, ts])
    db.session.commit()
    return testing_site_id


def _ensure_run(route_id: int, month_first: date, *, run_id: int) -> MonthlyRouteRun:
    existing = MonthlyRouteRun.query.get(run_id)
    if existing is not None:
        return existing
    run = MonthlyRouteRun(
        id=run_id,
        monthly_route_id=route_id,
        month_date=month_first,
        status="open",
        source="technician_app",
    )
    db.session.add(run)
    db.session.commit()
    return run


def _add_stop_month(
    route_id: int,
    month_first: date,
    *,
    run_id: int,
    mtsm_id: int,
    testing_site_id: int,
    test_outcome: str = "all_good",
) -> MonthlyTestingSiteMonth:
    _ensure_run(route_id, month_first, run_id=run_id)
    mtsm = MonthlyTestingSiteMonth(
        id=mtsm_id,
        monthly_testing_site_id=testing_site_id,
        month_date=month_first,
        run_id=run_id,
        test_outcome=test_outcome,
    )
    db.session.add(mtsm)
    db.session.commit()
    return mtsm


def _add_closed_clock(
    mtsm: MonthlyTestingSiteMonth,
    *,
    event_id: int,
    completed_at_pacific: datetime,
) -> None:
    completed_utc = completed_at_pacific.astimezone(timezone.utc)
    ev = MonthlyStopClockEvent(
        id=event_id,
        monthly_testing_site_month_id=int(mtsm.id),
        sort_order=0,
        time_in_raw="9:00 AM",
        time_out_raw="9:30 AM",
        created_at=completed_utc,
        updated_at=completed_utc,
    )
    db.session.add(ev)
    db.session.commit()


def test_compute_run_pace_behind(pace_app):
    with pace_app.app_context():
        ts_id = _seed_site()
        prior_month = date(2026, 5, 1)
        current_month = date(2026, 6, 1)
        comparison_day = 9

        prior_mtsm_a = _add_stop_month(1, prior_month, run_id=10, mtsm_id=110, testing_site_id=ts_id)
        _add_closed_clock(
            prior_mtsm_a,
            event_id=1001,
            completed_at_pacific=datetime(2026, 5, comparison_day, 9, 0, tzinfo=PACIFIC_TZ),
        )

        prior_mtsm_b = _add_stop_month(
            1,
            prior_month,
            run_id=10,
            mtsm_id=111,
            testing_site_id=1002,
        )
        ts2 = MonthlyTestingSite(id=1002, monthly_site_id=301, sort_order=1, label="Annex")
        db.session.add(ts2)
        db.session.commit()
        _add_closed_clock(
            prior_mtsm_b,
            event_id=1002,
            completed_at_pacific=datetime(2026, 5, comparison_day, 9, 30, tzinfo=PACIFIC_TZ),
        )

        current_mtsm = _add_stop_month(1, current_month, run_id=20, mtsm_id=210, testing_site_id=ts_id)
        _add_closed_clock(
            current_mtsm,
            event_id=2001,
            completed_at_pacific=datetime(2026, 6, comparison_day, 9, 15, tzinfo=PACIFIC_TZ),
        )

        now = datetime(2026, 6, comparison_day, 10, 0, tzinfo=PACIFIC_TZ)
        result = compute_run_pace_comparison(1, current_month, now_pacific=now)

        assert result is not None
        assert result["available"] is True
        assert result["status"] == "behind"
        assert result["current_tested_count"] == 1
        assert result["prior_tested_count"] == 2
        assert result["delta"] == -1
        assert result["prior_month_label"] == "May"


def test_compute_run_pace_time_cutoff_excludes_later_completion(pace_app):
    with pace_app.app_context():
        ts_id = _seed_site()
        prior_month = date(2026, 5, 1)
        current_month = date(2026, 6, 1)
        day = 9

        prior_mtsm = _add_stop_month(1, prior_month, run_id=10, mtsm_id=110, testing_site_id=ts_id)
        _add_closed_clock(
            prior_mtsm,
            event_id=1001,
            completed_at_pacific=datetime(2026, 5, day, 9, 30, tzinfo=PACIFIC_TZ),
        )

        current_mtsm = _add_stop_month(1, current_month, run_id=20, mtsm_id=210, testing_site_id=ts_id)
        _add_closed_clock(
            current_mtsm,
            event_id=2001,
            completed_at_pacific=datetime(2026, 6, day, 9, 0, tzinfo=PACIFIC_TZ),
        )

        now = datetime(2026, 6, day, 9, 0, tzinfo=PACIFIC_TZ)
        result = compute_run_pace_comparison(1, current_month, now_pacific=now)

        assert result is not None
        assert result["current_tested_count"] == 1
        assert result["prior_tested_count"] == 0
        assert result["status"] == "ahead"
        assert result["delta"] == 1


def test_compute_run_pace_even(pace_app):
    with pace_app.app_context():
        ts_id = _seed_site()
        prior_month = date(2026, 5, 1)
        current_month = date(2026, 6, 1)
        day = 9

        prior_mtsm = _add_stop_month(1, prior_month, run_id=10, mtsm_id=110, testing_site_id=ts_id)
        _add_closed_clock(
            prior_mtsm,
            event_id=1001,
            completed_at_pacific=datetime(2026, 5, day, 8, 0, tzinfo=PACIFIC_TZ),
        )

        current_mtsm = _add_stop_month(1, current_month, run_id=20, mtsm_id=210, testing_site_id=ts_id)
        _add_closed_clock(
            current_mtsm,
            event_id=2001,
            completed_at_pacific=datetime(2026, 6, day, 9, 0, tzinfo=PACIFIC_TZ),
        )

        now = datetime(2026, 6, day, 10, 0, tzinfo=PACIFIC_TZ)
        result = compute_run_pace_comparison(1, current_month, now_pacific=now)

        assert result is not None
        assert result["status"] == "even"
        assert result["delta"] == 0


def test_compute_run_pace_no_prior_run_returns_none(pace_app):
    with pace_app.app_context():
        ts_id = _seed_site()
        current_month = date(2026, 6, 1)
        _add_stop_month(1, current_month, run_id=20, mtsm_id=210, testing_site_id=ts_id)

        result = compute_run_pace_comparison(
            1,
            current_month,
            now_pacific=datetime(2026, 6, 9, 10, 0, tzinfo=PACIFIC_TZ),
        )
        assert result is None


def test_compute_run_pace_skipped_stops_ignored(pace_app):
    with pace_app.app_context():
        ts_id = _seed_site()
        prior_month = date(2026, 5, 1)
        current_month = date(2026, 6, 1)
        day = 9

        prior_mtsm = _add_stop_month(
            1,
            prior_month,
            run_id=10,
            mtsm_id=110,
            testing_site_id=ts_id,
            test_outcome="skipped",
        )
        _add_closed_clock(
            prior_mtsm,
            event_id=1001,
            completed_at_pacific=datetime(2026, 5, day, 8, 0, tzinfo=PACIFIC_TZ),
        )

        _add_stop_month(1, current_month, run_id=20, mtsm_id=210, testing_site_id=ts_id)

        result = compute_run_pace_comparison(
            1,
            current_month,
            now_pacific=datetime(2026, 6, day, 10, 0, tzinfo=PACIFIC_TZ),
        )
        assert result == {"available": False}

