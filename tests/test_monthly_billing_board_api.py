"""GET/PATCH ``/api/monthly_routes/billing_board``."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app import create_app
from app.db_models import (
    MonthlyLocationQuarterBilled,
    MonthlyRoute,
    MonthlyRouteLocation,
    MonthlyRouteTestHistory,
    MonthlySite,
    MonthlyTestingSite,
    MonthlyTestingSiteMonth,
    db,
)
from app.monthly.billing_board import quarter_from_anchor_month
from app.monthly.monthly_sites_sync import sync_testing_sites_from_legacy

PACIFIC_TZ = ZoneInfo("America/Vancouver")


@pytest.fixture
def billing_board_client(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    tables = [
        MonthlyRoute.__table__,
        MonthlyRouteLocation.__table__,
        MonthlyRouteTestHistory.__table__,
        MonthlySite.__table__,
        MonthlyTestingSite.__table__,
        MonthlyTestingSiteMonth.__table__,
        MonthlyLocationQuarterBilled.__table__,
    ]

    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["username"] = "billing.user"
                sess["authenticated"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


def test_quarter_from_anchor_month():
    year, quarter, months = quarter_from_anchor_month(date(2026, 5, 1))
    assert year == 2026
    assert quarter == 2
    assert [m.month for m in months] == [4, 5, 6]


def _seed_location_with_may_billing():
    route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
    loc = MonthlyRouteLocation(
        id=101,
        address="123 Test St",
        address_normalized="123 test st",
        property_management_company="Acme",
        property_management_company_normalized="acme",
        building=None,
        building_normalized="",
        status_normalized="active",
        status_raw="Active",
        monthly_route_id=1,
        test_day="Tuesday",
        annual_month="May",
    )
    hist = MonthlyRouteTestHistory(
        id=5001,
        location_id=101,
        month_date=date(2026, 5, 1),
        result_status="tested",
        test_monthly_route_id=1,
        billing_status="bill",
    )
    inactive = MonthlyRouteLocation(
        id=102,
        address="999 Inactive St",
        address_normalized="999 inactive st",
        property_management_company="",
        property_management_company_normalized="",
        building=None,
        building_normalized="",
        status_normalized="inactive",
        status_raw="Inactive",
    )
    db.session.add_all([route, loc, hist, inactive])
    db.session.commit()
    sync_testing_sites_from_legacy(loc)
    site = MonthlySite.query.filter_by(legacy_monthly_route_location_id=101).one()
    ts = MonthlyTestingSite.query.filter_by(monthly_site_id=site.id).one()
    mtsm = MonthlyTestingSiteMonth(
        id=93001,
        monthly_testing_site_id=ts.id,
        month_date=date(2026, 5, 1),
        test_monthly_route_id=1,
        test_outcome="all_good",
        result_status="tested",
    )
    db.session.add(mtsm)
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
    may = row["months"]["2026-05-01"]
    assert may["billing_status"] == "bill"
    assert may["test_summary"]["summary_key"] == "all_good"
    assert row["quarter_billed"] is False


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
    loc10 = MonthlyRouteLocation(
        id=201,
        address="On R10",
        address_normalized="on r10",
        property_management_company="",
        property_management_company_normalized="",
        building=None,
        building_normalized="",
        status_normalized="active",
        status_raw="Active",
        monthly_route_id=10,
        test_day="W1-R10",
    )
    loc16 = MonthlyRouteLocation(
        id=202,
        address="On R16",
        address_normalized="on r16",
        property_management_company="",
        property_management_company_normalized="",
        building=None,
        building_normalized="",
        status_normalized="active",
        status_raw="Active",
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
