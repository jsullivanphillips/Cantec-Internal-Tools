"""Per-location office tickets API."""

from __future__ import annotations

from datetime import date

import pytest

from app import create_app
from app.db_models import (
    MonthlyLocation,
    MonthlyLocationTicket,
    MonthlyLocationTicketEvent,
    MonthlyRoute,
    MonthlyRouteRun,
    db,
)
from tests.monthly_location_helpers import make_location


@pytest.fixture
def ticket_client():
    import os

    os.environ["DATABASE_URL"] = "sqlite:///:memory:"
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    tables = [
        MonthlyRoute.__table__,
        MonthlyLocation.__table__,
        MonthlyRouteRun.__table__,
        MonthlyLocationTicket.__table__,
        MonthlyLocationTicketEvent.__table__,
    ]

    with app.app_context():
        db.metadata.create_all(db.engine, tables=tables)
        route = MonthlyRoute(id=1, route_number=1, weekday_iso=0, week_occurrence=1)
        loc = make_location(
            id=10,
            address="1 Main",
            property_management_company="x",
            property_management_company_normalized="x",
            monthly_route_id=1,
        )
        run = MonthlyRouteRun(
            id=1,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            status="open",
            source="office_manual",
        )
        db.session.add_all([route, loc, run])
        db.session.commit()
        with app.test_client() as client:
            with client.session_transaction() as sess:
                sess["username"] = "office_user"
                sess["authenticated"] = True
            yield client, app
        db.session.remove()
        db.metadata.drop_all(db.engine, tables=list(reversed(tables)))


def test_create_and_list_location_ticket(ticket_client):
    client, _app = ticket_client
    create = client.post(
        "/api/monthly_routes/routes/1/locations/10/tickets",
        json={"title": "Email site", "body": "Monitoring issue", "month_date": "2026-05-01"},
    )
    assert create.status_code == 201
    ticket_id = create.get_json()["ticket"]["id"]

    listing = client.get("/api/monthly_routes/routes/1/locations/10/tickets")
    assert listing.status_code == 200
    tickets = listing.get_json()["tickets"]
    assert len(tickets) == 1
    assert tickets[0]["title"] == "Email site"

    patch = client.patch(
        f"/api/monthly_routes/tickets/{ticket_id}",
        json={"status": "email_sent"},
    )
    assert patch.status_code == 200
    assert patch.get_json()["ticket"]["status"] == "email_sent"
