"""GET /api/monthly_routes/dashboard/route_breakdown — expense vs revenue."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import MonthlyRoute, MonthlyRouteRun, MonthlyRouteRunTimingMonth, db
from app.monthly.route_expense_constants import (
    LABOUR_RATE_PER_HOUR,
    TRUCK_CHARGE_PER_MONTH,
)
from app.monthly.service_trade_route_run_timing import SYNC_STATUS_OK
from app.routes import monthly_routes as mr_mod
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location, make_location_month

CURRENT_MONTH = date(2026, 6, 1)
PACIFIC = ZoneInfo("America/Vancouver")


@pytest.fixture
def breakdown_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setattr(mr_mod, "_current_pacific_month_first", lambda: CURRENT_MONTH)
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=WORKSHEET_TABLES)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["username"] = "office.staff"
                sess["authenticated"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(WORKSHEET_TABLES)))


def _get_breakdown(client, *, range_key: str | None = None, months: int | None = None):
    query = ["cache_bust=1"]
    if range_key is not None:
        query.append(f"range={range_key}")
    if months is not None:
        query.append(f"months={months}")
    suffix = f"?{'&'.join(query)}"
    res = client.get(f"/api/monthly_routes/dashboard/route_breakdown{suffix}")
    assert res.status_code == 200, res.get_data(as_text=True)
    return res.get_json()


def _seed_route(*, route_id: int, route_number: int, location_id: int, price: Decimal, tech_count: int | None = None):
    route = MonthlyRoute(
        id=route_id,
        route_number=route_number,
        weekday_iso=0,
        week_occurrence=1,
        tech_count=tech_count,
    )
    loc = make_location(
        id=location_id,
        address=f"{location_id} Test St",
        monthly_route_id=route_id,
        route_stop_order=0,
        price_per_month=price,
    )
    db.session.add_all([route, loc])


def _seed_tested_month(
    *,
    location_id: int,
    mlm_id: int,
    month_date: date,
    route_id: int,
):
    mlm = make_location_month(
        id=mlm_id,
        location_id=location_id,
        month_date=month_date,
        route_id=route_id,
        result_status="tested",
        billing_status="bill",
    )
    db.session.add(mlm)


def _seed_run_timing_month(
    *,
    row_id: int,
    route_id: int,
    month_first: date,
    duration_minutes: int,
    clock_out_hour: int,
    clock_out_minute: int = 0,
) -> None:
    end_minute = clock_out_hour * 60 + clock_out_minute
    start_minute = end_minute - duration_minutes
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


def _seed_office_skipped_run(
    *,
    run_id: int,
    route_id: int,
    month_date: date,
    location_id: int,
    mlm_id: int,
) -> None:
    now = datetime.now(PACIFIC)
    run = MonthlyRouteRun(
        id=run_id,
        monthly_route_id=route_id,
        month_date=month_date,
        source="office_skip",
        status="completed",
        started_at=now,
        field_ended_at=now,
        office_review_completed_at=now,
        completed_at=now,
    )
    mlm = make_location_month(
        id=mlm_id,
        location_id=location_id,
        month_date=month_date,
        route_id=route_id,
        run_id=run_id,
        result_status="skipped",
        skip_reason="other",
        billing_status="do_not_bill",
    )
    db.session.add_all([run, mlm])


def test_breakdown_avg_revenue_ranking(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=2, location_id=101, price=Decimal("100.00"))
        _seed_route(route_id=2, route_number=3, location_id=102, price=Decimal("300.00"))
        _seed_tested_month(
            location_id=101,
            mlm_id=5001,
            month_date=date(2026, 5, 1),
            route_id=1,
        )
        _seed_tested_month(
            location_id=101,
            mlm_id=5002,
            month_date=date(2026, 4, 1),
            route_id=1,
        )
        _seed_tested_month(
            location_id=102,
            mlm_id=5003,
            month_date=date(2026, 5, 1),
            route_id=2,
        )
        _seed_run_timing_month(row_id=1, route_id=1, month_first=date(2026, 5, 1), duration_minutes=360, clock_out_hour=14)
        _seed_run_timing_month(row_id=2, route_id=1, month_first=date(2026, 4, 1), duration_minutes=360, clock_out_hour=14)
        _seed_run_timing_month(row_id=3, route_id=2, month_first=date(2026, 5, 1), duration_minutes=360, clock_out_hour=15)
        db.session.commit()

    body = _get_breakdown(client)
    assert body["cost_constants"]["labour_rate_per_hour"] == LABOUR_RATE_PER_HOUR
    assert body["cost_constants"]["truck_charge_per_month"] == TRUCK_CHARGE_PER_MONTH
    rows = [r for r in body["rows"] if r["has_sufficient_run_time_data"]]
    assert len(rows) == 2
    assert rows[0]["route"]["route_number"] == 3
    assert rows[0]["avg_monthly_revenue"] == 300.0
    assert rows[1]["route"]["route_number"] == 2
    assert rows[1]["avg_monthly_revenue"] == 100.0


def test_breakdown_hours_and_expense_from_clocks(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=5, location_id=201, price=Decimal("50.00"))
        _seed_tested_month(
            location_id=201,
            mlm_id=6001,
            month_date=date(2026, 5, 1),
            route_id=1,
        )
        _seed_run_timing_month(row_id=10, route_id=1, month_first=date(2026, 5, 1), duration_minutes=360, clock_out_hour=14)
        db.session.commit()

    body = _get_breakdown(client)
    row = body["rows"][0]
    assert row["avg_hours"] == 6.0
    assert row["avg_hours_billed"] == 6.0
    assert row["avg_hours_capped_for_billing"] is False
    expected_expense = LABOUR_RATE_PER_HOUR * 2 * 6.0 + TRUCK_CHARGE_PER_MONTH
    assert row["monthly_expense"] == expected_expense
    assert row["tech_count"] == 2


def test_breakdown_avg_hours_above_7_5_bills_as_8(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=11, location_id=701, price=Decimal("50.00"))
        _seed_tested_month(
            location_id=701,
            mlm_id=7001,
            month_date=date(2026, 5, 1),
            route_id=1,
        )
        _seed_run_timing_month(
            row_id=13,
            route_id=1,
            month_first=date(2026, 5, 1),
            duration_minutes=456,
            clock_out_hour=16,
        )
        db.session.commit()

    body = _get_breakdown(client)
    row = body["rows"][0]
    assert row["avg_hours"] == 7.6
    assert row["avg_hours_billed"] == 8.0
    assert row["avg_hours_capped_for_billing"] is True
    expected_expense = LABOUR_RATE_PER_HOUR * 2 * 8.0 + TRUCK_CHARGE_PER_MONTH
    assert row["monthly_expense"] == expected_expense


def test_breakdown_avg_hours_exactly_7_5_not_capped(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=12, location_id=702, price=Decimal("50.00"))
        _seed_tested_month(
            location_id=702,
            mlm_id=7002,
            month_date=date(2026, 5, 1),
            route_id=1,
        )
        _seed_run_timing_month(
            row_id=14,
            route_id=1,
            month_first=date(2026, 5, 1),
            duration_minutes=450,
            clock_out_hour=16,
        )
        db.session.commit()

    body = _get_breakdown(client)
    row = body["rows"][0]
    assert row["avg_hours"] == 7.5
    assert row["avg_hours_billed"] == 7.5
    assert row["avg_hours_capped_for_billing"] is False
    expected_expense = LABOUR_RATE_PER_HOUR * 2 * 7.5 + TRUCK_CHARGE_PER_MONTH
    assert row["monthly_expense"] == expected_expense


def test_breakdown_avg_hours_at_or_above_8_use_actual(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=13, location_id=703, price=Decimal("50.00"))
        _seed_tested_month(
            location_id=703,
            mlm_id=7003,
            month_date=date(2026, 5, 1),
            route_id=1,
        )
        _seed_run_timing_month(
            row_id=15,
            route_id=1,
            month_first=date(2026, 5, 1),
            duration_minutes=510,
            clock_out_hour=17,
        )
        db.session.commit()

    body = _get_breakdown(client)
    row = body["rows"][0]
    assert row["avg_hours"] == 8.5
    assert row["avg_hours_billed"] == 8.5
    assert row["avg_hours_capped_for_billing"] is False
    expected_expense = LABOUR_RATE_PER_HOUR * 2 * 8.5 + TRUCK_CHARGE_PER_MONTH
    assert row["monthly_expense"] == expected_expense


def test_breakdown_custom_tech_count_lowers_expense(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(
            route_id=1,
            route_number=7,
            location_id=301,
            price=Decimal("80.00"),
            tech_count=1,
        )
        _seed_tested_month(
            location_id=301,
            mlm_id=8001,
            month_date=date(2026, 5, 1),
            route_id=1,
        )
        _seed_run_timing_month(row_id=11, route_id=1, month_first=date(2026, 5, 1), duration_minutes=360, clock_out_hour=15)
        db.session.commit()

    body = _get_breakdown(client)
    row = body["rows"][0]
    assert row["tech_count"] == 1
    assert row["avg_hours"] == 6.0
    expected = LABOUR_RATE_PER_HOUR * 1 * 6.0 + TRUCK_CHARGE_PER_MONTH
    assert row["monthly_expense"] == expected


def test_breakdown_no_clock_data_truck_only_expense(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=8, location_id=401, price=Decimal("50.00"))
        _seed_tested_month(
            location_id=401,
            mlm_id=9001,
            month_date=date(2026, 5, 1),
            route_id=1,
        )
        db.session.commit()

    body = _get_breakdown(client)
    row = body["rows"][0]
    assert row["has_sufficient_run_time_data"] is False
    assert row["period_fully_skipped"] is False
    assert row["avg_hours"] is None
    assert row["monthly_expense"] == TRUCK_CHARGE_PER_MONTH
    assert row["avg_monthly_revenue"] == 50.0
    assert row["monthly_net"] is not None


def test_breakdown_monthly_net_null_when_no_revenue(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=14, location_id=413, price=Decimal("50.00"))
        _seed_run_timing_month(row_id=20, route_id=1, month_first=date(2026, 5, 1), duration_minutes=360, clock_out_hour=14)
        db.session.commit()

    body = _get_breakdown(client)
    row = body["rows"][0]
    assert row["has_sufficient_run_time_data"] is True
    assert row["avg_monthly_revenue"] == 0.0
    assert row["revenue_months_sampled"] == 0
    assert row["monthly_expense"] > 0
    assert row["monthly_net"] is None
    assert row["monthly_net_pct"] is None


def test_breakdown_office_skipped_last_month_zero_expense_in_main_table(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=12, location_id=411, price=Decimal("50.00"))
        _seed_office_skipped_run(
            run_id=9100,
            route_id=1,
            month_date=date(2026, 5, 1),
            location_id=411,
            mlm_id=9101,
        )
        db.session.commit()

    body = _get_breakdown(client, range_key="last_month")
    row = body["rows"][0]
    assert row["has_sufficient_run_time_data"] is True
    assert row["period_fully_skipped"] is True
    assert row["avg_hours"] is None
    assert row["monthly_expense"] == 0.0
    assert row["monthly_net"] == 0.0
    assert row["monthly_net_pct"] is None
    assert row["monthly_revenues"] == [
        {"month_key": "2026-05-01", "revenue": 0.0, "revenue_status": "skipped"},
    ]


def test_breakdown_partial_skip_still_insufficient_without_timing(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=13, location_id=412, price=Decimal("50.00"))
        _seed_office_skipped_run(
            run_id=9102,
            route_id=1,
            month_date=date(2026, 5, 1),
            location_id=412,
            mlm_id=9103,
        )
        db.session.commit()

    body = _get_breakdown(client, range_key="last_12_months")
    row = body["rows"][0]
    assert row["has_sufficient_run_time_data"] is False
    assert row["period_fully_skipped"] is False


def test_breakdown_insufficient_routes_sorted_after_sufficient(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=2, location_id=101, price=Decimal("100.00"))
        _seed_route(route_id=2, route_number=3, location_id=102, price=Decimal("50.00"))
        _seed_tested_month(
            location_id=101,
            mlm_id=5001,
            month_date=date(2026, 5, 1),
            route_id=1,
        )
        _seed_tested_month(
            location_id=102,
            mlm_id=5002,
            month_date=date(2026, 5, 1),
            route_id=2,
        )
        _seed_run_timing_month(row_id=12, route_id=1, month_first=date(2026, 5, 1), duration_minutes=360, clock_out_hour=14)
        db.session.commit()

    body = _get_breakdown(client)
    rows = body["rows"]
    assert len(rows) == 2
    assert rows[0]["has_sufficient_run_time_data"] is True
    assert rows[1]["has_sufficient_run_time_data"] is False
    assert rows[1]["route"]["route_number"] == 3


def test_breakdown_r99_excluded(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=99, location_id=501, price=Decimal("999.00"))
        _seed_route(route_id=2, route_number=4, location_id=502, price=Decimal("10.00"))
        _seed_tested_month(location_id=501, mlm_id=9101, month_date=date(2026, 5, 1), route_id=1)
        _seed_tested_month(location_id=502, mlm_id=9102, month_date=date(2026, 5, 1), route_id=2)
        db.session.commit()

    body = _get_breakdown(client)
    numbers = {row["route"]["route_number"] for row in body["rows"]}
    assert 99 not in numbers
    assert 4 in numbers


def test_patch_route_tech_count(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=10, location_id=601, price=Decimal("50.00"))
        db.session.commit()

    res = client.patch(
        "/api/monthly_routes/routes/1",
        json={"tech_count": 1},
    )
    assert res.status_code == 200
    assert res.get_json()["route"]["tech_count"] == 1

    bad = client.patch("/api/monthly_routes/routes/1", json={"tech_count": 0})
    assert bad.status_code == 400

    cleared = client.patch("/api/monthly_routes/routes/1", json={"tech_count": None})
    assert cleared.status_code == 200
    assert cleared.get_json()["route"]["tech_count"] is None


def test_breakdown_range_last_month(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=5, location_id=701, price=Decimal("100.00"))
        _seed_tested_month(
            location_id=701,
            mlm_id=7101,
            month_date=date(2026, 6, 1),
            route_id=1,
        )
        _seed_tested_month(
            location_id=701,
            mlm_id=7102,
            month_date=date(2026, 5, 1),
            route_id=1,
        )
        _seed_run_timing_month(
            row_id=20,
            route_id=1,
            month_first=date(2026, 5, 1),
            duration_minutes=360,
            clock_out_hour=14,
        )
        _seed_run_timing_month(
            row_id=21,
            route_id=1,
            month_first=date(2026, 6, 1),
            duration_minutes=480,
            clock_out_hour=16,
        )
        db.session.commit()

    body = _get_breakdown(client, range_key="last_month")
    assert body["range"] == "last_month"
    assert body["period_label"] == "Last month"
    assert body["period_start"] == "2026-05-01"
    assert body["period_end"] == "2026-05-01"
    assert body["trailing_months"] == 1
    assert body["show_avg_monthly_revenue"] is False
    assert len(body["revenue_columns"]) == 1
    assert body["revenue_columns"][0]["header"] == "MAY REVENUE"
    row = body["rows"][0]
    assert row["avg_monthly_revenue"] == 100.0
    assert row["monthly_revenues"] == [{"month_key": "2026-05-01", "revenue": 100.0}]
    assert row["avg_hours"] == 6.0


def test_breakdown_range_last_quarter(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=6, location_id=801, price=Decimal("90.00"))
        _seed_tested_month(
            location_id=801,
            mlm_id=8101,
            month_date=date(2026, 3, 1),
            route_id=1,
        )
        _seed_tested_month(
            location_id=801,
            mlm_id=8102,
            month_date=date(2026, 6, 1),
            route_id=1,
        )
        db.session.commit()

    body = _get_breakdown(client, range_key="last_quarter")
    assert body["range"] == "last_quarter"
    assert body["period_start"] == "2026-01-01"
    assert body["period_end"] == "2026-03-01"
    assert body["trailing_months"] == 3
    assert body["show_avg_monthly_revenue"] is True
    assert len(body["revenue_columns"]) == 3
    assert [c["header"] for c in body["revenue_columns"]] == [
        "JAN REVENUE",
        "FEB REVENUE",
        "MAR REVENUE",
    ]
    assert "Jan" in body["period_label"]
    row = body["rows"][0]
    assert row["monthly_revenues"] == [
        {"month_key": "2026-01-01", "revenue": 0.0, "revenue_status": "no_data"},
        {"month_key": "2026-02-01", "revenue": 0.0, "revenue_status": "no_data"},
        {"month_key": "2026-03-01", "revenue": 90.0},
    ]
    assert row["avg_monthly_revenue"] == 90.0


def test_breakdown_range_ytd(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=7, location_id=901, price=Decimal("120.00"))
        _seed_tested_month(
            location_id=901,
            mlm_id=9101,
            month_date=date(2026, 1, 1),
            route_id=1,
        )
        _seed_tested_month(
            location_id=901,
            mlm_id=9102,
            month_date=date(2026, 6, 1),
            route_id=1,
        )
        _seed_tested_month(
            location_id=901,
            mlm_id=9103,
            month_date=date(2025, 12, 1),
            route_id=1,
        )
        db.session.commit()

    body = _get_breakdown(client, range_key="ytd")
    assert body["range"] == "ytd"
    assert body["period_start"] == "2026-01-01"
    assert body["period_end"] == "2026-06-01"
    assert body["trailing_months"] == 6
    assert body["show_avg_monthly_revenue"] is True
    assert len(body["revenue_columns"]) == 6
    row = body["rows"][0]
    assert len(row["monthly_revenues"]) == 6
    assert row["monthly_revenues"][0] == {"month_key": "2026-01-01", "revenue": 120.0}
    assert row["monthly_revenues"][-1] == {"month_key": "2026-06-01", "revenue": 120.0}
    assert row["avg_monthly_revenue"] == 120.0


def test_breakdown_range_last_month_default(breakdown_client):
    body = _get_breakdown(client=breakdown_client[0])
    assert body["range"] == "last_month"
    assert body["period_start"] == "2026-05-01"
    assert body["period_end"] == "2026-05-01"
    assert body["trailing_months"] == 1
    assert body["show_avg_monthly_revenue"] is False
    assert len(body["revenue_columns"]) == 1
    assert body["revenue_columns"][0]["header"] == "MAY REVENUE"


def test_breakdown_range_last_12_months(breakdown_client):
    body = _get_breakdown(client=breakdown_client[0], range_key="last_12_months")
    assert body["range"] == "last_12_months"
    assert body["period_start"] == "2025-07-01"
    assert body["period_end"] == "2026-06-01"
    assert body["trailing_months"] == 12
    assert body["show_avg_monthly_revenue"] is True
    assert len(body["revenue_columns"]) == 12
    assert body["revenue_columns"][0]["header"] == "JUL '25 REVENUE"
    assert body["revenue_columns"][-1]["header"] == "JUN '26 REVENUE"


def test_breakdown_month_revenue_no_data_when_history_skipped_without_office_run(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=20, location_id=901, price=Decimal("75.00"))
        db.session.add(
            make_location_month(
                id=9201,
                location_id=901,
                month_date=date(2026, 5, 1),
                route_id=1,
                result_status="skipped",
                skip_reason="annual",
            )
        )
        db.session.commit()

    body = _get_breakdown(client, range_key="last_month")
    row = body["rows"][0]
    assert row["monthly_revenues"] == [
        {"month_key": "2026-05-01", "revenue": 0.0, "revenue_status": "no_data"},
    ]


def test_breakdown_month_revenue_no_data_for_field_skip_outcomes_without_office_skip(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=23, location_id=904, price=Decimal("75.00"))
        now = datetime.now(PACIFIC)
        db.session.add(
            MonthlyRouteRun(
                id=9205,
                monthly_route_id=1,
                month_date=date(2026, 5, 1),
                source="technician_app",
                status="completed",
                started_at=now,
                field_ended_at=now,
                completed_at=now,
            )
        )
        db.session.add(
            make_location_month(
                id=9204,
                location_id=904,
                month_date=date(2026, 5, 1),
                route_id=1,
                run_id=9205,
                test_outcome="skipped",
                result_status="skipped",
                skip_category="lack_of_time",
                skip_note="not enough technicians",
                skip_reason="lack_of_time: not enough technicians",
            )
        )
        db.session.commit()

    body = _get_breakdown(client, range_key="last_month")
    row = body["rows"][0]
    assert row["monthly_revenues"] == [
        {"month_key": "2026-05-01", "revenue": 0.0, "revenue_status": "no_data"},
    ]


def test_breakdown_month_revenue_skipped_status_when_office_skip_run_exists(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=22, location_id=903, price=Decimal("75.00"))
        db.session.add(
            MonthlyRouteRun(
                id=9200,
                monthly_route_id=1,
                month_date=date(2026, 5, 1),
                status="completed",
                source="office_skip",
                started_at=datetime.now(PACIFIC),
                field_ended_at=datetime.now(PACIFIC),
                completed_at=datetime.now(PACIFIC),
            )
        )
        db.session.add(
            make_location_month(
                id=9203,
                location_id=903,
                month_date=date(2026, 5, 1),
                route_id=1,
                run_id=9200,
                result_status="skipped",
                skip_reason="annual",
            )
        )
        db.session.commit()

    body = _get_breakdown(client, range_key="last_month")
    row = body["rows"][0]
    assert row["monthly_revenues"] == [
        {"month_key": "2026-05-01", "revenue": 0.0, "revenue_status": "skipped"},
    ]


def test_breakdown_skipped_with_bill_status_includes_revenue(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=24, location_id=905, price=Decimal("85.00"))
        db.session.add(
            make_location_month(
                id=9206,
                location_id=905,
                month_date=date(2026, 5, 1),
                route_id=1,
                result_status="skipped",
                test_outcome="skipped",
                skip_category="other",
                billing_status="bill",
            )
        )
        _seed_run_timing_month(
            row_id=30,
            route_id=1,
            month_first=date(2026, 5, 1),
            duration_minutes=360,
            clock_out_hour=14,
        )
        db.session.commit()

    body = _get_breakdown(client, range_key="last_month")
    row = body["rows"][0]
    assert row["monthly_revenues"] == [{"month_key": "2026-05-01", "revenue": 85.0}]
    assert row["avg_monthly_revenue"] == 85.0
    assert row["monthly_net"] == pytest.approx(85.0 - row["monthly_expense"], rel=0.001)


def test_breakdown_tested_do_not_bill_excludes_revenue(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=25, location_id=906, price=Decimal("200.00"))
        db.session.add(
            make_location_month(
                id=9207,
                location_id=906,
                month_date=date(2026, 5, 1),
                route_id=1,
                result_status="tested",
                billing_status="do_not_bill",
            )
        )
        _seed_run_timing_month(
            row_id=31,
            route_id=1,
            month_first=date(2026, 5, 1),
            duration_minutes=360,
            clock_out_hour=14,
        )
        db.session.commit()

    body = _get_breakdown(client, range_key="last_month")
    row = body["rows"][0]
    assert row["monthly_revenues"] == [
        {"month_key": "2026-05-01", "revenue": 0.0, "revenue_status": "no_data"},
    ]
    assert row["avg_monthly_revenue"] == 0.0
    assert row["monthly_net"] is None


def test_breakdown_tested_unset_billing_falls_back_to_tested_revenue(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=26, location_id=907, price=Decimal("150.00"))
        db.session.add(
            make_location_month(
                id=9208,
                location_id=907,
                month_date=date(2026, 5, 1),
                route_id=1,
                result_status="tested",
            )
        )
        _seed_run_timing_month(
            row_id=32,
            route_id=1,
            month_first=date(2026, 5, 1),
            duration_minutes=360,
            clock_out_hour=14,
        )
        db.session.commit()

    body = _get_breakdown(client, range_key="last_month")
    row = body["rows"][0]
    assert row["monthly_revenues"] == [{"month_key": "2026-05-01", "revenue": 150.0}]
    assert row["avg_monthly_revenue"] == 150.0


def test_breakdown_skipped_unset_billing_has_no_revenue(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        _seed_route(route_id=1, route_number=27, location_id=908, price=Decimal("90.00"))
        db.session.add(
            make_location_month(
                id=9209,
                location_id=908,
                month_date=date(2026, 5, 1),
                route_id=1,
                result_status="skipped",
                test_outcome="skipped",
                skip_category="other",
            )
        )
        db.session.commit()

    body = _get_breakdown(client, range_key="last_month")
    row = body["rows"][0]
    assert row["monthly_revenues"] == [
        {"month_key": "2026-05-01", "revenue": 0.0, "revenue_status": "no_data"},
    ]


def test_breakdown_month_revenue_no_data_when_tested_without_price(breakdown_client):
    client, app = breakdown_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=21, weekday_iso=0, week_occurrence=1)
        loc = make_location(
            id=902,
            address="902 Test St",
            monthly_route_id=1,
            route_stop_order=0,
            price_per_month=None,
        )
        db.session.add_all([route, loc])
        _seed_tested_month(
            location_id=902,
            mlm_id=9202,
            month_date=date(2026, 5, 1),
            route_id=1,
        )
        db.session.commit()

    body = _get_breakdown(client, range_key="last_month")
    row = body["rows"][0]
    assert row["monthly_revenues"] == [
        {"month_key": "2026-05-01", "revenue": 0.0, "revenue_status": "no_data"},
    ]
