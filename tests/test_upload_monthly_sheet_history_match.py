"""History-only location matching fallbacks for master sheet imports."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app import create_app
from app.db_models import MonthlyLocation, MonthlyRoute, db
from app.scripts.upload_monthly_sheet import _resolve_location_id_for_history_row
from tests.monthly_location_helpers import WORKSHEET_TABLES


@pytest.fixture
def match_db(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    with app.app_context():
        db.metadata.create_all(db.engine, tables=WORKSHEET_TABLES)
        route = MonthlyRoute(id=1, route_number=6, weekday_iso=0, week_occurrence=1)
        loc = MonthlyLocation(
            id=10,
            address="1000 Mckenzie Avenue",
            address_normalized="1000 mckenzie avenue",
            label="1000 Mckenzie Avenue",
            label_normalized="1000 mckenzie avenue",
            property_management_company="Starlight/Devon",
            property_management_company_normalized="starlight/devon",
            monthly_route_id=1,
            route_stop_order=0,
            price_per_month=Decimal("65.00"),
            status_normalized="active",
        )
        db.session.add_all([route, loc])
        db.session.commit()
        yield app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(WORKSHEET_TABLES)))


def test_history_row_matches_sheet_address_to_library_label_when_notes_differ(match_db):
    with match_db.app_context():
        row = {
            "ADDRESS": "1000 Mckenzie Avenue",
            "PROPERTY MANAGEMENT COMPANY": "Starlight/Devon",
            "NOTES": "Increase to $65 after January 2026",
        }
        location_id, err = _resolve_location_id_for_history_row(row)
        assert err is None
        assert location_id == 10
