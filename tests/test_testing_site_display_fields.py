"""Per-testing-site display fields on MonthlyTestingSite."""

from __future__ import annotations

import itertools

import pytest

from app import create_app
from app.db_models import (
    Key,
    MonthlyRoute,
    MonthlyRouteLocation,
    MonthlySite,
    MonthlyTestingSite,
    db,
)
from app.monthly.monthly_sites_sync import sync_testing_sites_from_legacy


@pytest.fixture
def display_fields_tables(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(
            db.engine,
            tables=[
                Key.__table__,
                MonthlyRoute.__table__,
                MonthlyRouteLocation.__table__,
                MonthlySite.__table__,
                MonthlyTestingSite.__table__,
            ],
        )
        yield app
        db.session.remove()
        db.metadata.drop_all(
            db.engine,
            tables=[
                MonthlyTestingSite.__table__,
                MonthlySite.__table__,
                MonthlyRouteLocation.__table__,
                MonthlyRoute.__table__,
                Key.__table__,
            ],
        )


_loc_id = itertools.count(1)


def _seed_loc(*, facp: str = "FACP-1", building: str = "Tower A") -> int:
    r = MonthlyRoute(id=1, route_number=1, weekday_iso=2, week_occurrence=1)
    db.session.add(r)
    lid = next(_loc_id)
    loc = MonthlyRouteLocation(
        id=lid,
        address="100 Main",
        address_normalized="100 main",
        property_management_company="PMC Co",
        property_management_company_normalized="pmc co",
        building=building,
        building_normalized=building.lower(),
        status_normalized="active",
        annual_month="March",
        facp_detail=facp,
        ring_detail="R-9",
        keys="KEY-77",
        monthly_route_id=1,
    )
    db.session.add(loc)
    db.session.commit()
    return int(lid)


def test_sync_copies_display_fields_from_legacy(display_fields_tables):
    with display_fields_tables.app_context():
        lid = _seed_loc()
        loc = db.session.get(MonthlyRouteLocation, lid)
        rows = sync_testing_sites_from_legacy(loc)
        db.session.commit()
        ts = rows[0]
        assert ts.annual_month == "March"
        assert ts.property_management_company == "PMC Co"
        assert ts.building_name == "Tower A"
        assert ts.panel == "FACP-1"
        assert ts.ring_detail == "R-9"
        assert ts.keys == "KEY-77"


def test_patch_testing_site_display_fields(display_fields_tables):
    with display_fields_tables.app_context():
        lid = _seed_loc()
        loc = db.session.get(MonthlyRouteLocation, lid)
        sync_testing_sites_from_legacy(loc)
        db.session.commit()
        ts = MonthlyTestingSite.query.one()

        client = display_fields_tables.test_client()
        with client.session_transaction() as sess:
            sess["authenticated"] = True

        resp = client.patch(
            f"/api/monthly_sites/testing_sites/{int(ts.id)}",
            json={
                "panel": "Panel X",
                "panel_location": "Lobby",
                "door_code": "1234",
                "building_name": "Annex",
            },
        )
        assert resp.status_code == 200
        body = resp.get_json()["testing_site"]
        assert body["panel"] == "Panel X"
        assert body["panel_location"] == "Lobby"
        assert body["door_code"] == "1234"
        assert body["building_name"] == "Annex"
        assert body["facp_detail"] == "Panel X"
