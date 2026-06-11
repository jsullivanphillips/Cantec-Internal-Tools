"""Tests for flat monthly location data migration."""

from __future__ import annotations

import itertools
from datetime import date

import pytest

from app import create_app
from app.db_models import (
    MonthlyLocation,
    MonthlyLocationMonth,
    MonthlyMigrationConflict,
    MonthlyRoute,
    db,
)
from app.monthly.legacy_orm_migration import (
    MonthlyRouteLocation,
    MonthlyRouteTestHistory,
    MonthlySite,
    MonthlyTestingSite,
    MonthlyTestingSiteMonth,
)
from app.monthly.migrate_flat_locations import migrate_flat_locations


@pytest.fixture
def migrate_tables(monkeypatch, tmp_path):
    db_file = tmp_path / "migrate_test.db"
    uri = f"sqlite:///{db_file.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", uri)
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = uri
    tables = [
        MonthlyRoute.__table__,
        MonthlyRouteLocation.__table__,
        MonthlySite.__table__,
        MonthlyTestingSite.__table__,
        MonthlyTestingSiteMonth.__table__,
        MonthlyRouteTestHistory.__table__,
        MonthlyLocation.__table__,
        MonthlyLocationMonth.__table__,
        MonthlyMigrationConflict.__table__,
    ]
    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        yield app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


_loc_id = itertools.count(200)
_site_id = itertools.count(300)
_ts_id = itertools.count(400)


def _seed_parent_with_sites(
    *,
    address: str = "2471 Sidney Ave",
    sites: list[tuple[str, int]],
) -> tuple[int, list[int]]:
    """sites: list of (label, sort_order)."""
    mr = MonthlyRoute(id=1, route_number=7, weekday_iso=2, week_occurrence=1)
    db.session.add(mr)
    lid = next(_loc_id)
    loc = MonthlyRouteLocation(
        id=lid,
        address=address,
        address_normalized=address.casefold(),
        property_management_company="PMC",
        property_management_company_normalized="pmc",
        building=None,
        building_normalized="",
        status_normalized="active",
        monthly_route_id=1,
        route_stop_order=2,
        billing_comments="shared note",
    )
    db.session.add(loc)
    db.session.flush()
    ms = MonthlySite(id=next(_site_id), legacy_monthly_route_location_id=lid)
    db.session.add(ms)
    db.session.flush()
    ts_ids: list[int] = []
    for label, sort_order in sites:
        tid = next(_ts_id)
        ts_ids.append(tid)
        db.session.add(
            MonthlyTestingSite(
                id=tid,
                monthly_site_id=int(ms.id),
                sort_order=sort_order,
                label=label,
                price_per_month=10,
            )
        )
    db.session.commit()
    return lid, ts_ids


def test_single_site_migration(migrate_tables):
    with migrate_tables.app_context():
        _seed_parent_with_sites(sites=[("2471 Sidney Ave", 0)])
        stats = migrate_flat_locations(execute=True, allow_conflicts=True)
        db.session.commit()
        assert stats.locations_created == 1
        ml = MonthlyLocation.query.one()
        assert ml.address == "2471 Sidney Ave"
        assert ml.label == "2471 Sidney Ave"
        assert ml.billing_comments == "shared note"
        assert ml.route_stop_order == 2


def test_multi_site_split_uses_label_as_secondary_address(migrate_tables):
    with migrate_tables.app_context():
        _seed_parent_with_sites(
            address="2471 Sidney Ave",
            sites=[
                ("2471 Sidney Ave", 0),
                ("9838 Second Street", 1),
            ],
        )
        stats = migrate_flat_locations(execute=True, allow_conflicts=True)
        db.session.commit()
        assert stats.locations_created == 2
        rows = MonthlyLocation.query.order_by(MonthlyLocation.route_stop_order.asc()).all()
        assert rows[0].address == "2471 Sidney Ave"
        assert rows[1].address == "9838 Second Street"
        assert rows[0].route_stop_order == 2
        assert rows[1].route_stop_order == 3


def test_duplicate_identity_logs_conflict(migrate_tables):
    with migrate_tables.app_context():
        for lid in (next(_loc_id), next(_loc_id)):
            db.session.add(
                MonthlyRouteLocation(
                    id=lid,
                    address="100 Main St",
                    address_normalized="100 main st",
                    property_management_company="PMC",
                    property_management_company_normalized="pmc",
                    building=None,
                    building_normalized="",
                    status_normalized="active",
                )
            )
            db.session.flush()
            ms = MonthlySite(id=next(_site_id), legacy_monthly_route_location_id=lid)
            db.session.add(ms)
            db.session.flush()
            db.session.add(
                MonthlyTestingSite(
                    id=next(_ts_id),
                    monthly_site_id=int(ms.id),
                    sort_order=0,
                    label="Building A",
                )
            )
        db.session.commit()

        stats = migrate_flat_locations(execute=True, allow_conflicts=True)
        db.session.commit()
        assert stats.locations_created == 1
        assert stats.conflicts == 1
        assert MonthlyMigrationConflict.query.count() == 1


def test_billing_status_copied_to_location_month(migrate_tables):
    with migrate_tables.app_context():
        lid, ts_ids = _seed_parent_with_sites(sites=[("Main", 0)])
        db.session.add(
            MonthlyRouteTestHistory(
                id=9001,
                location_id=lid,
                month_date=date(2026, 5, 1),
                billing_status="bill",
                test_monthly_route_id=1,
            )
        )
        db.session.add(
            MonthlyTestingSiteMonth(
                id=9002,
                monthly_testing_site_id=ts_ids[0],
                month_date=date(2026, 5, 1),
                test_monthly_route_id=1,
            )
        )
        db.session.commit()

        migrate_flat_locations(execute=True, allow_conflicts=True)
        db.session.commit()
        mlm = MonthlyLocationMonth.query.one()
        assert mlm.billing_status == "bill"
