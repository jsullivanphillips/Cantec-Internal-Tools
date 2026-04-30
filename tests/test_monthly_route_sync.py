import itertools

import pytest
from sqlalchemy import select

from app import create_app
from app.db_models import MonthlyRoute, MonthlyRouteLocation, db
from app.monthly.route_sync import sync_monthly_route_fk_for_location


@pytest.fixture
def route_sync_tables(monkeypatch):
    """In-memory SQLite with only ``monthly_route`` + ``monthly_route_location`` (full schema uses JSONB)."""
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    with app.app_context():
        db.metadata.create_all(
            db.engine,
            tables=[MonthlyRoute.__table__, MonthlyRouteLocation.__table__],
        )
        yield app
        db.session.remove()
        db.metadata.drop_all(
            db.engine,
            tables=[MonthlyRouteLocation.__table__, MonthlyRoute.__table__],
        )


_loc_id = itertools.count(1)


def _loc(**kwargs):
    """SQLite test DDL does not always auto-generate BIGINT PKs — assign explicit ids."""
    defaults = {
        "id": next(_loc_id),
        "address": "1 Main St",
        "address_normalized": "1 main st",
        "property_management_company": "Co",
        "property_management_company_normalized": "co",
        "building": None,
        "building_normalized": "",
        "status_normalized": "active",
        "status_raw": "Active",
    }
    defaults.update(kwargs)
    return MonthlyRouteLocation(**defaults)


@pytest.mark.parametrize(
    "test_day",
    [None, "", "  ", "-", "not a route token xyz"],
)
def test_sync_clears_or_skips_fk(route_sync_tables, test_day):
    with route_sync_tables.app_context():
        loc = _loc(test_day=test_day)
        db.session.add(loc)
        db.session.flush()
        sync_monthly_route_fk_for_location(loc)
        lid = loc.id
        db.session.commit()
        fk = db.session.scalar(
            select(MonthlyRouteLocation.monthly_route_id).where(MonthlyRouteLocation.id == lid)
        )
        assert fk is None


def test_sync_creates_route_and_links(route_sync_tables):
    with route_sync_tables.app_context():
        loc = _loc(test_day="W1-R7")
        db.session.add(loc)
        db.session.flush()
        sync_monthly_route_fk_for_location(loc)
        lid = loc.id
        db.session.commit()
        mr = MonthlyRoute.query.filter_by(route_number=7).one()
        fk = db.session.scalar(
            select(MonthlyRouteLocation.monthly_route_id).where(MonthlyRouteLocation.id == lid)
        )
        assert fk == mr.id
        assert mr.weekday_iso == 2
        assert mr.week_occurrence == 1


def test_sync_links_existing_route(route_sync_tables):
    with route_sync_tables.app_context():
        mr = MonthlyRoute(id=1, route_number=7, weekday_iso=2, week_occurrence=1)
        db.session.add(mr)
        db.session.flush()
        loc = _loc(test_day="W1-R7")
        db.session.add(loc)
        db.session.flush()
        sync_monthly_route_fk_for_location(loc)
        lid = loc.id
        db.session.commit()
        fk = db.session.scalar(
            select(MonthlyRouteLocation.monthly_route_id).where(MonthlyRouteLocation.id == lid)
        )
        assert fk == mr.id


def test_sync_conflict_raises(route_sync_tables):
    with route_sync_tables.app_context():
        mr = MonthlyRoute(id=1, route_number=7, weekday_iso=2, week_occurrence=1)
        db.session.add(mr)
        db.session.flush()
        loc = _loc(test_day="TH1-R7")
        db.session.add(loc)
        db.session.flush()
        with pytest.raises(ValueError, match="conflicts"):
            sync_monthly_route_fk_for_location(loc)
