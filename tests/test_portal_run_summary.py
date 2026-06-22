"""Technician portal run summary after End field run."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import MonthlyRoute, MonthlyRouteRun, MonthlyRouteRunTimingMonth, db
from app.monthly.portal_run_summary import build_portal_run_summary
from app.monthly.service_trade_route_run_timing import SYNC_STATUS_OK
from app.routes import monthly_routes as mr_mod
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location, make_location_month
from tests.run_workflow_helpers import portal_start_run

PACIFIC = ZoneInfo("America/Vancouver")
JUNE = date(2026, 6, 1)
APRIL = date(2026, 4, 1)
MAY = date(2026, 5, 1)


@pytest.fixture
def summary_app(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: JUNE)
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=WORKSHEET_TABLES)
        yield app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(WORKSHEET_TABLES)))


@pytest.fixture
def portal_client(summary_app):
    with summary_app.test_client() as client:
        with client.session_transaction() as sess:
            sess["tech_portal_unlocked"] = True
            sess["username"] = "tech1"
            sess["authenticated"] = True
        yield client


def _seed_route(*, route_id: int = 1, location_id: int = 101) -> tuple[int, int]:
    route = MonthlyRoute(id=route_id, route_number=2, weekday_iso=0, week_occurrence=1)
    loc = make_location(
        id=location_id,
        address="123 Test St",
        monthly_route_id=route_id,
        route_stop_order=0,
    )
    db.session.add_all([route, loc])
    db.session.commit()
    return route_id, location_id


def _seed_timing_row(
    *,
    row_id: int,
    route_id: int,
    month_first: date,
    clock_out_hour: int,
    clock_out_minute: int = 0,
    duration_minutes: int = 480,
) -> None:
    start_minute = clock_out_hour * 60 + clock_out_minute - duration_minutes
    clock_in_at = datetime(
        month_first.year,
        month_first.month,
        15,
        start_minute // 60,
        start_minute % 60,
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
    db.session.add(
        MonthlyRouteRunTimingMonth(
            id=row_id,
            monthly_route_id=route_id,
            month_first=month_first,
            service_trade_job_id=9000 + row_id,
            clock_in_at=clock_in_at,
            clock_out_at=clock_out_at,
            duration_minutes=duration_minutes,
            sync_status=SYNC_STATUS_OK,
        )
    )


def test_build_portal_run_summary_outcome_counts(summary_app):
    with summary_app.app_context():
        route_id, location_id = _seed_route()
        run = MonthlyRouteRun(
            id=5001,
            monthly_route_id=route_id,
            month_date=JUNE,
            opened_at=datetime.now(PACIFIC),
            started_at=datetime.now(PACIFIC),
            field_ended_at=datetime(2026, 6, 15, 15, 0, tzinfo=PACIFIC),
            status="open",
            source="technician_app",
        )
        db.session.add(run)
        db.session.add(
            make_location_month(
                id=1,
                location_id=location_id,
                month_date=JUNE,
                route_id=route_id,
                run_id=5001,
                test_outcome="all_good",
                sheet_time_in_raw="8:00 AM",
                sheet_time_out_raw="3:00 PM",
            )
        )
        db.session.add(
            make_location(
                id=102,
                address="456 Annual St",
                monthly_route_id=route_id,
                route_stop_order=1,
            )
        )
        db.session.add(
            make_location_month(
                id=2,
                location_id=102,
                month_date=JUNE,
                route_id=route_id,
                run_id=5001,
                test_outcome="skipped",
                skip_category="annual",
                sheet_time_in_raw="3:05 PM",
                sheet_time_out_raw="3:12 PM",
            )
        )
        db.session.add(
            make_location(
                id=103,
                address="789 Skip St",
                monthly_route_id=route_id,
                route_stop_order=2,
            )
        )
        db.session.add(
            make_location_month(
                id=3,
                location_id=103,
                month_date=JUNE,
                route_id=route_id,
                run_id=5001,
                test_outcome="skipped",
                skip_category="lack_of_time",
            )
        )
        db.session.commit()

        summary = build_portal_run_summary(route_id, JUNE, run)

    assert summary["outcomes"] == {
        "tested": 1,
        "skipped_annual": 1,
        "skipped_non_annual": 1,
    }
    assert summary["field_duration_minutes"] == 420
    assert summary["field_end_time"] == "3:00 PM"


def test_annual_normalization_adjusts_finish_time_comparison(summary_app):
    with summary_app.app_context():
        route_id, location_id = _seed_route()
        annual_loc = make_location(
            id=102,
            address="456 Annual St",
            monthly_route_id=route_id,
            route_stop_order=1,
        )
        db.session.add(annual_loc)
        run = MonthlyRouteRun(
            id=5001,
            monthly_route_id=route_id,
            month_date=JUNE,
            opened_at=datetime.now(PACIFIC),
            started_at=datetime.now(PACIFIC),
            field_ended_at=datetime(2026, 6, 15, 14, 0, tzinfo=PACIFIC),
            status="open",
            source="technician_app",
        )
        db.session.add(run)
        db.session.add(
            make_location_month(
                id=10,
                location_id=location_id,
                month_date=JUNE,
                route_id=route_id,
                run_id=5001,
                test_outcome="all_good",
                sheet_time_in_raw="9:00 AM",
                sheet_time_out_raw="1:00 PM",
            )
        )
        db.session.add(
            make_location_month(
                id=11,
                location_id=102,
                month_date=JUNE,
                route_id=route_id,
                run_id=5001,
                test_outcome="skipped",
                skip_category="annual",
                sheet_time_in_raw="9:05 AM",
                sheet_time_out_raw="9:17 AM",
            )
        )
        for idx, month_first in enumerate((APRIL, MAY), start=1):
            db.session.add(
                make_location_month(
                    id=100 + idx,
                    location_id=location_id,
                    month_date=month_first,
                    route_id=route_id,
                    test_outcome="all_good",
                    sheet_time_in_raw="8:00 AM",
                    sheet_time_out_raw="4:00 PM",
                )
            )
            _seed_timing_row(
                row_id=200 + idx,
                route_id=route_id,
                month_first=month_first,
                clock_out_hour=16,
                duration_minutes=480,
            )
            db.session.add(
                make_location_month(
                    id=110 + idx,
                    location_id=102,
                    month_date=month_first,
                    route_id=route_id,
                    test_outcome="skipped",
                    skip_category="annual",
                    sheet_time_in_raw="8:05 AM",
                    sheet_time_out_raw="8:17 AM",
                )
            )
        db.session.commit()

        summary = build_portal_run_summary(route_id, JUNE, run)

    assert summary["annual_minutes_per_skip"] == 12
    finish_cmp = summary["comparisons"]["finish_time"]
    assert finish_cmp["typical_end_time"] == "4:00 PM"
    assert finish_cmp["direction"] == "early"
    assert finish_cmp["delta_minutes"] < 0


def test_insufficient_history_omits_comparisons(summary_app):
    with summary_app.app_context():
        route_id, location_id = _seed_route()
        run = MonthlyRouteRun(
            id=5001,
            monthly_route_id=route_id,
            month_date=JUNE,
            opened_at=datetime.now(PACIFIC),
            started_at=datetime.now(PACIFIC),
            field_ended_at=datetime(2026, 6, 15, 15, 0, tzinfo=PACIFIC),
            status="open",
            source="technician_app",
        )
        db.session.add(run)
        db.session.add(
            make_location_month(
                id=1,
                location_id=location_id,
                month_date=JUNE,
                route_id=route_id,
                run_id=5001,
                test_outcome="all_good",
                sheet_time_in_raw="8:00 AM",
                sheet_time_out_raw="3:00 PM",
            )
        )
        db.session.commit()

        summary = build_portal_run_summary(route_id, JUNE, run)

    assert summary["comparisons"] == {}
    assert summary["has_sufficient_history"] is False


def test_end_run_api_includes_run_summary(portal_client, summary_app):
    with summary_app.app_context():
        route_id, location_id = _seed_route()

    portal_start_run(portal_client, month_first=JUNE.isoformat())

    with summary_app.app_context():
        from app.db_models import MonthlyLocationMonth

        mlm = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=location_id,
            month_date=JUNE,
        ).one()
        mlm.test_outcome = "all_good"
        mlm.sheet_time_in_raw = "8:00 AM"
        mlm.sheet_time_out_raw = "3:00 PM"
        db.session.commit()
    end = portal_client.post(f"/api/technician_portal/routes/{route_id}/runs/end")
    assert end.status_code == 200
    body = end.get_json()
    assert body["run"]["field_ended_at"] is not None
    assert "run_summary" in body
    assert body["run_summary"]["outcomes"]["tested"] == 1
    assert body["run_summary"]["field_end_time"] is not None

    repeat = portal_client.post(f"/api/technician_portal/routes/{route_id}/runs/end")
    assert repeat.status_code == 200
    assert "run_summary" not in repeat.get_json()
