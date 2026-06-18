"""Field route duration and pre-route gap from stop times vs ServiceTrade clocks."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import MonthlyRoute, MonthlyRouteRunTimingMonth, db
from app.monthly.route_field_timing import (
    field_timing_for_route_month,
    route_median_field_timing,
)
from app.monthly.service_trade_route_run_timing import SYNC_STATUS_OK
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location, make_location_month

PACIFIC = ZoneInfo("America/Vancouver")
MAY = date(2026, 5, 1)


@pytest.fixture
def field_timing_app(monkeypatch):
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


def _seed_r6_like_month(*, route_id: int = 1, location_id: int = 101) -> MonthlyRouteRunTimingMonth:
    route = MonthlyRoute(id=route_id, route_number=6, weekday_iso=0, week_occurrence=1)
    loc = make_location(
        id=location_id,
        address="101 Test St",
        monthly_route_id=route_id,
        route_stop_order=0,
    )
    mlm = make_location_month(
        id=5001,
        location_id=location_id,
        month_date=MAY,
        route_id=route_id,
        result_status="tested",
        sheet_time_in_raw="8:26 AM",
        sheet_time_out_raw="4:30 PM",
    )
    clock_in_at = datetime(2026, 5, 15, 8, 6, tzinfo=PACIFIC)
    clock_out_at = datetime(2026, 5, 15, 16, 36, tzinfo=PACIFIC)
    timing = MonthlyRouteRunTimingMonth(
        id=1,
        monthly_route_id=route_id,
        month_first=MAY,
        service_trade_job_id=9001,
        clock_in_at=clock_in_at,
        clock_out_at=clock_out_at,
        duration_minutes=516,
        sync_status=SYNC_STATUS_OK,
    )
    db.session.add_all([route, loc, mlm, timing])
    db.session.commit()
    return timing


def test_field_timing_pre_route_gap_and_duration(field_timing_app):
    with field_timing_app.app_context():
        timing = _seed_r6_like_month()
        field_duration, pre_route_gap = field_timing_for_route_month(1, MAY, timing_row=timing)
        assert pre_route_gap == 20
        assert field_duration == duration_minutes_from_label("8:26 AM", "4:36 PM")


def test_route_median_field_timing(field_timing_app):
    with field_timing_app.app_context():
        _seed_r6_like_month()
        field_typical, field_months, gap_typical, gap_months = route_median_field_timing(
            1,
            {MAY.isoformat()},
        )
        assert field_months == 1
        assert gap_months == 1
        assert gap_typical == 20
        assert field_typical is not None


def duration_minutes_from_label(start: str, end: str) -> int:
    from app.monthly.visit_clock_times import (
        duration_minutes_from_start_end,
        parse_visit_clock_minutes,
    )

    return duration_minutes_from_start_end(
        parse_visit_clock_minutes(start) or 0,
        parse_visit_clock_minutes(end) or 0,
    )
