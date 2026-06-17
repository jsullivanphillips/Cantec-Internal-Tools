"""GET/PATCH ``/api/monthly_routes/billing_board``."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import (
    MonthlyLocationMonth,
    MonthlyLocationQuarterBilled,
    MonthlyRoute,
    MonthlyRouteRun,
    db,
)
from app.monthly.billing_board import quarter_from_anchor_month
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location

PACIFIC_TZ = ZoneInfo("America/Vancouver")

BILLING_TABLES = WORKSHEET_TABLES + [MonthlyLocationQuarterBilled.__table__]


@pytest.fixture
def billing_board_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(db.engine, tables=BILLING_TABLES)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["username"] = "billing.user"
                sess["authenticated"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(BILLING_TABLES)))


def test_quarter_from_anchor_month():
    year, quarter, months = quarter_from_anchor_month(date(2026, 5, 1))
    assert year == 2026
    assert quarter == 2
    assert [m.month for m in months] == [4, 5, 6]


def _seed_location_with_may_billing():
    route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
    loc = make_location(
        id=101,
        address="123 Test St",
        label="123 Test St",
        property_management_company="Acme",
        property_management_company_normalized="acme",
        monthly_route_id=1,
        test_day="Tuesday",
        annual_month="May",
    )
    mlm = MonthlyLocationMonth(
        id=5001,
        monthly_location_id=101,
        month_date=date(2026, 5, 1),
        result_status="tested",
        test_monthly_route_id=1,
        billing_status="bill",
        test_outcome="all_good",
    )
    inactive = make_location(
        id=102,
        address="999 Inactive St",
        label="999 Inactive St",
        status_normalized="inactive",
        status_raw="Inactive",
    )
    db.session.add_all([route, loc, mlm, inactive])
    db.session.commit()
    return loc


def test_billing_board_returns_billing_and_outcome(billing_board_client):
    client, _app = billing_board_client
    _seed_location_with_may_billing()

    r = client.get("/api/monthly_routes/billing_board?anchor_month=2026-05-01")
    assert r.status_code == 200
    data = r.get_json()
    assert data["year"] == 2026
    assert data["quarter"] == 2
    assert len(data["month_dates"]) == 3
    assert data["pagination"]["total"] == 1
    row = data["locations"][0]
    assert row["location_id"] == 101
    assert row["property_management_company"] == "Acme"
    may = row["months"]["2026-05-01"]
    assert may["billing_status"] == "bill"
    assert may["test_summary"]["summary_key"] == "all_good"
    assert row["quarter_billed"] is False
    assert row["pricing_updated"] is False


def test_billing_board_includes_pricing_updated(billing_board_client):
    client, _app = billing_board_client
    loc = _seed_location_with_may_billing()
    loc.pricing_updated = True
    db.session.commit()

    r = client.get("/api/monthly_routes/billing_board?anchor_month=2026-05-01")
    assert r.status_code == 200
    row = r.get_json()["locations"][0]
    assert row["pricing_updated"] is True


def test_billing_board_excludes_inactive(billing_board_client):
    client, _app = billing_board_client
    _seed_location_with_may_billing()

    r = client.get("/api/monthly_routes/billing_board?anchor_month=2026-05-01&q=inactive")
    assert r.status_code == 200
    assert r.get_json()["pagination"]["total"] == 0


def test_quarter_billed_toggle(billing_board_client):
    client, _app = billing_board_client
    _seed_location_with_may_billing()

    r = client.patch(
        "/api/monthly_routes/billing_board/locations/101/quarter_billed?anchor_month=2026-05-01",
        json={"billed": True},
    )
    assert r.status_code == 200
    body = r.get_json()
    assert body["quarter_billed"] is True
    assert body["billed_by"] == "billing.user"
    assert body["billed_at"]

    row = MonthlyLocationQuarterBilled.query.filter_by(location_id=101, year=2026, quarter=2).one()
    assert row.billed_by_username == "billing.user"

    r2 = client.get(
        "/api/monthly_routes/billing_board?anchor_month=2026-05-01&not_billed_quarter=true"
    )
    assert r2.get_json()["pagination"]["total"] == 0

    r3 = client.patch(
        "/api/monthly_routes/billing_board/locations/101/quarter_billed?anchor_month=2026-05-01",
        json={"billed": False},
    )
    assert r3.status_code == 200
    assert r3.get_json()["quarter_billed"] is False
    assert MonthlyLocationQuarterBilled.query.filter_by(location_id=101).count() == 0


def test_billing_board_invalid_quarter_params(billing_board_client):
    client, _app = billing_board_client
    r = client.get("/api/monthly_routes/billing_board")
    assert r.status_code == 400
    assert r.get_json()["code"] == "invalid_quarter_params"


def _seed_two_routes_for_filter():
    route10 = MonthlyRoute(id=10, route_number=10, weekday_iso=2, week_occurrence=1)
    route16 = MonthlyRoute(id=16, route_number=16, weekday_iso=3, week_occurrence=2)
    loc10 = make_location(
        id=201,
        address="On R10",
        label="On R10",
        monthly_route_id=10,
        test_day="W1-R10",
    )
    loc16 = make_location(
        id=202,
        address="On R16",
        label="On R16",
        monthly_route_id=16,
        test_day="TH2-R16",
    )
    db.session.add_all([route10, route16, loc10, loc16])
    db.session.commit()


def test_billing_board_route_filter_by_route_number(billing_board_client):
    client, _app = billing_board_client
    _seed_two_routes_for_filter()

    r = client.get("/api/monthly_routes/billing_board?anchor_month=2026-05-01&route=R10")
    assert r.status_code == 200
    data = r.get_json()
    assert data["pagination"]["total"] == 1
    row = data["locations"][0]
    assert row["location_id"] == 201
    assert row["route_number"] == 10


def test_billing_board_search_route_token_suffix_only(billing_board_client):
    client, _app = billing_board_client
    _seed_two_routes_for_filter()

    r = client.get("/api/monthly_routes/billing_board?anchor_month=2026-05-01&q=r10")
    assert r.status_code == 200
    data = r.get_json()
    assert data["pagination"]["total"] == 1
    assert data["locations"][0]["location_id"] == 201


def test_billing_board_do_not_bill_any_month_filter(billing_board_client):
    client, _app = billing_board_client
    route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
    bill_loc = make_location(
        id=501,
        address="Bill St",
        label="Bill St",
        monthly_route_id=1,
        test_day="Tuesday",
    )
    skip_loc = make_location(
        id=502,
        address="Skip St",
        label="Skip St",
        monthly_route_id=1,
        test_day="Tuesday",
        annual_month="May",
    )
    bill_mlm = MonthlyLocationMonth(
        id=5011,
        monthly_location_id=501,
        month_date=date(2026, 5, 1),
        test_monthly_route_id=1,
        billing_status="bill",
    )
    skip_mlm = MonthlyLocationMonth(
        id=5012,
        monthly_location_id=502,
        month_date=date(2026, 5, 1),
        test_monthly_route_id=1,
        billing_status="do_not_bill",
        skip_category="testing_not_required",
    )
    db.session.add_all([route, bill_loc, skip_loc, bill_mlm, skip_mlm])
    db.session.commit()

    r = client.get(
        "/api/monthly_routes/billing_board?anchor_month=2026-05-01&do_not_bill_any_month=true"
    )
    assert r.status_code == 200
    data = r.get_json()
    assert data["pagination"]["total"] == 1
    assert data["locations"][0]["location_id"] == 502


def test_billing_board_unset_any_month_filter(billing_board_client):
    client, _app = billing_board_client
    route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
    bill_loc = make_location(
        id=511,
        address="Bill Only St",
        label="Bill Only St",
        monthly_route_id=1,
        test_day="Tuesday",
    )
    unset_loc = make_location(
        id=512,
        address="Unset St",
        label="Unset St",
        monthly_route_id=1,
        test_day="Tuesday",
    )
    bill_mlm = MonthlyLocationMonth(
        id=5111,
        monthly_location_id=511,
        month_date=date(2026, 5, 1),
        test_monthly_route_id=1,
        billing_status="bill",
    )
    unset_mlm = MonthlyLocationMonth(
        id=5112,
        monthly_location_id=512,
        month_date=date(2026, 5, 1),
        test_monthly_route_id=1,
        billing_status="unset",
    )
    db.session.add_all([route, bill_loc, unset_loc, bill_mlm, unset_mlm])
    db.session.commit()

    r = client.get(
        "/api/monthly_routes/billing_board?anchor_month=2026-05-01&unset_any_month=true"
    )
    assert r.status_code == 200
    data = r.get_json()
    assert data["pagination"]["total"] == 1
    assert data["locations"][0]["location_id"] == 512


def test_billing_board_pricing_updated_filter(billing_board_client):
    client, _app = billing_board_client
    route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
    updated_loc = make_location(
        id=701,
        address="Updated Price St",
        label="Updated Price St",
        monthly_route_id=1,
        test_day="Tuesday",
        pricing_updated=True,
    )
    not_updated_loc = make_location(
        id=702,
        address="Stale Price St",
        label="Stale Price St",
        monthly_route_id=1,
        test_day="Tuesday",
        pricing_updated=False,
    )
    db.session.add_all([route, updated_loc, not_updated_loc])
    db.session.commit()

    r = client.get(
        "/api/monthly_routes/billing_board?anchor_month=2026-05-01&pricing_updated=true"
    )
    assert r.status_code == 200
    data = r.get_json()
    assert data["pagination"]["total"] == 1
    assert data["locations"][0]["location_id"] == 701
    assert data["locations"][0]["pricing_updated"] is True


def test_billing_board_non_empty_billing_notes_filter(billing_board_client):
    client, _app = billing_board_client
    route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
    with_note = make_location(
        id=601,
        address="Note St",
        label="Note St",
        monthly_route_id=1,
        test_day="Tuesday",
        billing_comments="Credit from QB",
    )
    without_note = make_location(
        id=602,
        address="No Note St",
        label="No Note St",
        monthly_route_id=1,
        test_day="Tuesday",
        billing_comments=None,
    )
    blank_note = make_location(
        id=603,
        address="Blank Note St",
        label="Blank Note St",
        monthly_route_id=1,
        test_day="Tuesday",
        billing_comments="   ",
    )
    db.session.add_all([route, with_note, without_note, blank_note])
    db.session.commit()

    r = client.get(
        "/api/monthly_routes/billing_board?anchor_month=2026-05-01&non_empty_billing_notes=true"
    )
    assert r.status_code == 200
    data = r.get_json()
    assert data["pagination"]["total"] == 1
    assert data["locations"][0]["location_id"] == 601


def test_billing_board_do_not_bill_includes_skip_reason_category(billing_board_client):
    client, _app = billing_board_client
    route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
    loc = make_location(
        id=301,
        address="Annual Skip St",
        label="Annual Skip St",
        monthly_route_id=1,
        test_day="Tuesday",
        annual_month="May",
    )
    mlm = MonthlyLocationMonth(
        id=5002,
        monthly_location_id=301,
        month_date=date(2026, 5, 1),
        result_status="skipped",
        skip_reason="testing_not_required",
        test_monthly_route_id=1,
        billing_status="do_not_bill",
        test_outcome="skipped",
        skip_category="testing_not_required",
    )
    db.session.add_all([route, loc, mlm])
    db.session.commit()

    r = client.get("/api/monthly_routes/billing_board?anchor_month=2026-05-01&q=annual")
    assert r.status_code == 200
    row = r.get_json()["locations"][0]
    may = row["months"]["2026-05-01"]
    assert may["billing_status"] == "do_not_bill"
    assert may["skip_reason_category"] == "Annual"


def test_billing_board_do_not_bill_includes_skip_reason_note(billing_board_client):
    client, _app = billing_board_client
    route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
    loc = make_location(
        id=302,
        address="Waive Note St",
        label="Waive Note St",
        monthly_route_id=1,
        test_day="Tuesday",
    )
    mlm = MonthlyLocationMonth(
        id=5003,
        monthly_location_id=302,
        month_date=date(2026, 5, 1),
        result_status="skipped",
        skip_reason="lack_of_time: No technicians available",
        test_monthly_route_id=1,
        billing_status="do_not_bill",
        test_outcome="skipped",
        skip_category="lack_of_time",
        skip_note="No technicians available",
    )
    db.session.add_all([route, loc, mlm])
    db.session.commit()

    r = client.get("/api/monthly_routes/billing_board?anchor_month=2026-05-01&q=waive")
    assert r.status_code == 200
    row = r.get_json()["locations"][0]
    may = row["months"]["2026-05-01"]
    assert may["billing_status"] == "do_not_bill"
    assert may["skip_reason_category"] == "Lack of time"
    assert may["skip_reason_note"] == "No technicians available"


def test_billing_board_unset_before_field_end_reports_field_work_ended_false(billing_board_client):
    client, _app = billing_board_client
    route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
    loc = make_location(
        id=401,
        address="Open Run St",
        label="Open Run St",
        monthly_route_id=1,
        test_day="Tuesday",
    )
    run = MonthlyRouteRun(
        id=9001,
        monthly_route_id=1,
        month_date=date(2026, 5, 1),
        started_at=datetime(2026, 5, 2, 9, 0, tzinfo=PACIFIC_TZ),
        field_ended_at=None,
        status="open",
        source="technician_app",
    )
    mlm = MonthlyLocationMonth(
        id=5003,
        monthly_location_id=401,
        month_date=date(2026, 5, 1),
        test_monthly_route_id=1,
        run_id=9001,
        billing_status="unset",
    )
    db.session.add_all([route, loc, run, mlm])
    db.session.commit()

    r = client.get("/api/monthly_routes/billing_board?anchor_month=2026-05-01&q=open")
    assert r.status_code == 200
    may = r.get_json()["locations"][0]["months"]["2026-05-01"]
    assert may["billing_status"] == "unset"
    assert may["field_work_ended"] is False


def test_billing_board_unset_after_field_end_reports_field_work_ended_true(billing_board_client):
    client, _app = billing_board_client
    route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
    loc = make_location(
        id=402,
        address="Ended Run St",
        label="Ended Run St",
        monthly_route_id=1,
        test_day="Tuesday",
    )
    run = MonthlyRouteRun(
        id=9002,
        monthly_route_id=1,
        month_date=date(2026, 5, 1),
        started_at=datetime(2026, 5, 2, 9, 0, tzinfo=PACIFIC_TZ),
        field_ended_at=datetime(2026, 5, 2, 17, 0, tzinfo=PACIFIC_TZ),
        status="open",
        source="technician_app",
    )
    mlm = MonthlyLocationMonth(
        id=5004,
        monthly_location_id=402,
        month_date=date(2026, 5, 1),
        result_status="tested",
        test_monthly_route_id=1,
        run_id=9002,
        billing_status="unset",
    )
    db.session.add_all([route, loc, run, mlm])
    db.session.commit()

    r = client.get("/api/monthly_routes/billing_board?anchor_month=2026-05-01&q=ended")
    assert r.status_code == 200
    may = r.get_json()["locations"][0]["months"]["2026-05-01"]
    assert may["billing_status"] == "unset"
    assert may["field_work_ended"] is True
