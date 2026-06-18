"""Unit tests for route detail hero summary aggregates."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import MonthlyRoute, MonthlyRouteRunTimingMonth, db
from app.monthly.route_hero_summary import build_route_hero_summary
from app.monthly.service_trade_route_run_timing import SYNC_STATUS_OK
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location, make_location_month

PACIFIC = ZoneInfo("America/Vancouver")
MAY = date(2026, 5, 1)
JUNE = date(2026, 6, 1)


@pytest.fixture
def hero_app(monkeypatch):
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


def _seed_route(*, route_id: int = 4, tech_count: int | None = None) -> MonthlyRoute:
    route = MonthlyRoute(
        id=route_id,
        route_number=route_id,
        weekday_iso=0,
        week_occurrence=1,
        tech_count=tech_count,
    )
    db.session.add(route)
    return route


def _seed_timing_row(
    *,
    row_id: int,
    route_id: int,
    month_first: date,
    clock_out_hour: int,
    clock_out_minute: int,
) -> None:
    clock_in_at = datetime(
        month_first.year,
        month_first.month,
        15,
        8,
        0,
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
    duration = (clock_out_hour * 60 + clock_out_minute) - 8 * 60
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


def test_hero_summary_empty_route(hero_app):
    with hero_app.app_context():
        route = _seed_route()
        db.session.commit()

        summary = build_route_hero_summary(route, {})

        assert summary["typical_end_time"] is None
        assert summary["typical_end_time_runs_sampled"] == 0
        assert summary["avg_net_pct"] is None
        assert summary["net_pct_months_sampled"] == 0
        assert summary["avg_skipped_non_annual"] is None
        assert summary["skipped_months_sampled"] == 0


def test_hero_summary_typical_end_time_median(hero_app):
    with hero_app.app_context():
        route = _seed_route(route_id=2)
        _seed_timing_row(row_id=1, route_id=2, month_first=MAY, clock_out_hour=14, clock_out_minute=0)
        _seed_timing_row(row_id=2, route_id=2, month_first=JUNE, clock_out_hour=16, clock_out_minute=0)
        db.session.commit()

        summary = build_route_hero_summary(route, {})

        assert summary["typical_end_time"] == "3:00 PM"
        assert summary["typical_end_time_runs_sampled"] == 2


def test_hero_summary_avg_skipped_non_annual(hero_app):
    with hero_app.app_context():
        route = _seed_route()
        testing_by_month = {
            MAY.isoformat(): {
                "sites_tested_count": 2,
                "skipped_non_annual_count": 1,
                "skipped_annual_count": 0,
            },
            JUNE.isoformat(): {
                "sites_tested_count": 3,
                "skipped_non_annual_count": 3,
                "skipped_annual_count": 1,
            },
        }

        summary = build_route_hero_summary(route, testing_by_month)

        assert summary["avg_skipped_non_annual"] == 2.0
        assert summary["skipped_months_sampled"] == 2


def test_hero_summary_avg_net_pct(hero_app):
    with hero_app.app_context():
        route_id = 4
        route = _seed_route(route_id=route_id)
        loc = make_location(
            id=401,
            address="401 Test St",
            monthly_route_id=route_id,
            route_stop_order=0,
            price_per_month=Decimal("1000.00"),
        )
        db.session.add(loc)
        db.session.add(
            make_location_month(
                id=501,
                location_id=401,
                month_date=MAY,
                route_id=route_id,
                result_status="tested",
            )
        )
        db.session.add(
            make_location_month(
                id=502,
                location_id=401,
                month_date=JUNE,
                route_id=route_id,
                result_status="tested",
            )
        )
        _seed_timing_row(row_id=10, route_id=route_id, month_first=MAY, clock_out_hour=14, clock_out_minute=0)
        _seed_timing_row(row_id=11, route_id=route_id, month_first=JUNE, clock_out_hour=14, clock_out_minute=0)
        db.session.commit()

        testing_by_month = {
            MAY.isoformat(): {
                "sites_tested_count": 1,
                "skipped_non_annual_count": 0,
                "skipped_annual_count": 0,
                "tested_revenue_total": 1000.0,
            },
            JUNE.isoformat(): {
                "sites_tested_count": 1,
                "skipped_non_annual_count": 0,
                "skipped_annual_count": 0,
                "tested_revenue_total": 1000.0,
            },
        }

        summary = build_route_hero_summary(route, testing_by_month)

        assert summary["avg_net_pct"] is not None
        assert summary["net_pct_months_sampled"] == 2
        assert 0 < float(summary["avg_net_pct"]) < 1
