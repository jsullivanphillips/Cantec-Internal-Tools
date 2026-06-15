"""Unit tests for route run timing cache reads."""

from __future__ import annotations

from datetime import date, datetime

import pytest
from zoneinfo import ZoneInfo

from app import create_app
from app.db_models import MonthlyRoute, MonthlyRouteRunTimingMonth, db
from app.monthly.route_run_timing import route_median_run_duration_minutes, route_typical_end_time
from app.monthly.service_trade_route_run_timing import SYNC_STATUS_OK
from tests.monthly_location_helpers import WORKSHEET_TABLES

PACIFIC = ZoneInfo("America/Vancouver")


@pytest.fixture
def timing_app(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=WORKSHEET_TABLES)
        yield app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(WORKSHEET_TABLES)))


def _seed_timing_row(
    *,
    row_id: int,
    route_id: int,
    month_first: date,
    clock_in_hour: int,
    clock_in_minute: int,
    clock_out_hour: int,
    clock_out_minute: int,
    route_number: int | None = None,
) -> None:
    if db.session.get(MonthlyRoute, route_id) is None:
        db.session.add(
            MonthlyRoute(
                id=route_id,
                route_number=route_number if route_number is not None else route_id,
                weekday_iso=0,
                week_occurrence=1,
            )
        )
    clock_in_at = datetime(
        month_first.year,
        month_first.month,
        15,
        clock_in_hour,
        clock_in_minute,
        tzinfo=PACIFIC,
    )
    clock_out_at = datetime(
        month_first.year,
        month_first.month,
        15,
        clock_out_hour,
        clock_out_minute,
        tzinfo=PACIFIC,
    )
    start_minute = clock_in_hour * 60 + clock_in_minute
    end_minute = clock_out_hour * 60 + clock_out_minute
    duration = end_minute - start_minute
    db.session.add(
        MonthlyRouteRunTimingMonth(
            id=row_id,
            monthly_route_id=route_id,
            month_first=month_first,
            service_trade_job_id=1000 + row_id,
            clock_in_at=clock_in_at,
            clock_out_at=clock_out_at,
            duration_minutes=duration,
            sync_status=SYNC_STATUS_OK,
        )
    )


def test_route_median_run_duration_from_cache(timing_app):
    with timing_app.app_context():
        _seed_timing_row(
            row_id=1,
            route_id=1,
            month_first=date(2026, 4, 1),
            clock_in_hour=8,
            clock_in_minute=0,
            clock_out_hour=14,
            clock_out_minute=0,
        )
        _seed_timing_row(
            row_id=2,
            route_id=1,
            month_first=date(2026, 5, 1),
            clock_in_hour=9,
            clock_in_minute=0,
            clock_out_hour=15,
            clock_out_minute=0,
        )
        db.session.commit()

        duration, count = route_median_run_duration_minutes(
            1,
            {"2026-04-01", "2026-05-01"},
        )
        assert count == 2
        assert duration == 6 * 60


def test_route_typical_end_time_from_cache(timing_app):
    with timing_app.app_context():
        _seed_timing_row(
            row_id=3,
            route_id=2,
            month_first=date(2026, 4, 1),
            clock_in_hour=8,
            clock_in_minute=0,
            clock_out_hour=14,
            clock_out_minute=30,
        )
        _seed_timing_row(
            row_id=4,
            route_id=2,
            month_first=date(2026, 5, 1),
            clock_in_hour=8,
            clock_in_minute=0,
            clock_out_hour=16,
            clock_out_minute=30,
        )
        db.session.commit()

        typical, count = route_typical_end_time(2, {"2026-04-01", "2026-05-01"})
        assert count == 2
        assert typical == "3:30 PM"
