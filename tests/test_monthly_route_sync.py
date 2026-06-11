import itertools

import pytest
from sqlalchemy import select

from app import create_app
from app.db_models import MonthlyLocation, MonthlyRoute, db
from app.monthly.route_sync import sync_monthly_route_fk_for_location
from tests.monthly_location_helpers import make_location


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
            tables=[MonthlyRoute.__table__, MonthlyLocation.__table__],
        )
        yield app
        db.session.remove()
        db.metadata.drop_all(
            db.engine,
            tables=[MonthlyLocation.__table__, MonthlyRoute.__table__],
        )


_loc_id = itertools.count(1)


def _loc(**kwargs):
    lid = kwargs.pop("id", next(_loc_id))
    address = kwargs.pop("address", "1 Main St")
    return make_location(id=lid, address=address, **kwargs)


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
            select(MonthlyLocation.monthly_route_id).where(MonthlyLocation.id == lid)
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
            select(MonthlyLocation.monthly_route_id).where(MonthlyLocation.id == lid)
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
            select(MonthlyLocation.monthly_route_id).where(MonthlyLocation.id == lid)
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
