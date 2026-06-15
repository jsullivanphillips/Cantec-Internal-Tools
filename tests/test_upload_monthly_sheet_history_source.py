"""Master-sheet history upsert respects run/portal protection and sets history_source."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app import create_app
from app.db_models import MonthlyLocation, MonthlyLocationMonth, MonthlyRoute, db
from app.monthly.history_source import (
    HISTORY_SOURCE_MASTER_SHEET,
    HISTORY_SOURCE_ROUTE_CSV,
    HISTORY_SOURCE_TECHNICIAN_PORTAL,
)
from app.scripts.upload_monthly_sheet import _upsert_history
from tests.monthly_location_helpers import WORKSHEET_TABLES


@pytest.fixture
def upload_db(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    with app.app_context():
        db.metadata.create_all(db.engine, tables=WORKSHEET_TABLES)
        route = MonthlyRoute(id=1, route_number=7, weekday_iso=0, week_occurrence=1)
        loc = MonthlyLocation(
            id=10,
            address="100 Test St",
            address_normalized="100 TEST ST",
            label="100 Test St",
            label_normalized="100 TEST ST",
            property_management_company_normalized="",
            monthly_route_id=1,
            route_stop_order=0,
            price_per_month=Decimal("55.00"),
            status_normalized="active",
        )
        db.session.add_all([route, loc])
        db.session.commit()
        yield app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(WORKSHEET_TABLES)))


def test_upsert_history_sets_master_sheet_source(upload_db):
    with upload_db.app_context():
        db.session.add(
            MonthlyLocationMonth(
                id=99,
                monthly_location_id=10,
                month_date=date(2026, 1, 1),
                test_monthly_route_id=1,
            )
        )
        db.session.commit()

        assert _upsert_history(10, date(2026, 1, 1), "tested", None, "Y") == "upserted"
        db.session.commit()
        row = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=10,
            month_date=date(2026, 1, 1),
        ).one()
        assert row.result_status == "tested"
        assert row.source_value_raw == "Y"
        assert row.history_source == HISTORY_SOURCE_MASTER_SHEET


def test_upsert_history_skips_portal_protected_row(upload_db):
    with upload_db.app_context():
        db.session.add(
            MonthlyLocationMonth(
                id=100,
                monthly_location_id=10,
                month_date=date(2026, 2, 1),
                test_monthly_route_id=1,
                result_status="tested",
                test_outcome="all_good",
                history_source=HISTORY_SOURCE_TECHNICIAN_PORTAL,
            )
        )
        db.session.commit()

        assert _upsert_history(10, date(2026, 2, 1), "skipped", None, "X") == "skipped_protected"
        db.session.commit()
        row = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=10,
            month_date=date(2026, 2, 1),
        ).one()
        assert row.result_status == "tested"
        assert row.test_outcome == "all_good"
        assert row.history_source == HISTORY_SOURCE_TECHNICIAN_PORTAL


def test_upsert_history_skips_route_csv_run_row(upload_db):
    with upload_db.app_context():
        db.session.add(
            MonthlyLocationMonth(
                id=101,
                monthly_location_id=10,
                month_date=date(2026, 3, 1),
                test_monthly_route_id=1,
                run_id=500,
                result_status="tested",
                source_value_raw="7:55am | 8:40am",
                history_source=HISTORY_SOURCE_ROUTE_CSV,
            )
        )
        db.session.commit()

        assert _upsert_history(10, date(2026, 3, 1), "skipped", None, "X") == "skipped_protected"
