"""Per-location office tickets API."""

from __future__ import annotations

from datetime import date

import pytest

from app import create_app
from app.db_models import (
    MonthlyLocation,
    MonthlyLocationTicket,
    MonthlyLocationTicketComment,
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
        MonthlyLocationTicketComment.__table__,
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
        json={
            "title": "Email site",
            "description": "Monitoring issue",
            "tags": ["monitoring", "email"],
            "month_date": "2026-05-01",
        },
    )
    assert create.status_code == 201
    body = create.get_json()["ticket"]
    ticket_id = body["id"]
    assert body["status"] == "open"
    assert body["tags"] == ["monitoring", "email"]

    listing = client.get("/api/monthly_routes/routes/1/locations/10/tickets")
    assert listing.status_code == 200
    tickets = listing.get_json()["tickets"]
    assert len(tickets) == 1
    assert tickets[0]["title"] == "Email site"
    assert tickets[0]["description"] == "Monitoring issue"


def test_ticket_lifecycle_and_close_reason(ticket_client):
    client, _app = ticket_client
    create = client.post(
        "/api/monthly_routes/routes/1/locations/10/tickets",
        json={"title": "Update keys"},
    )
    ticket_id = create.get_json()["ticket"]["id"]

    in_progress = client.patch(
        f"/api/monthly_routes/tickets/{ticket_id}",
        json={"status": "in_progress"},
    )
    assert in_progress.status_code == 200
    assert in_progress.get_json()["ticket"]["status"] == "in_progress"

    missing_reason = client.patch(
        f"/api/monthly_routes/tickets/{ticket_id}",
        json={"status": "closed"},
    )
    assert missing_reason.status_code == 400
    assert missing_reason.get_json().get("code") == "close_reason_required"

    closed = client.patch(
        f"/api/monthly_routes/tickets/{ticket_id}",
        json={"status": "closed", "close_reason": "completed"},
    )
    assert closed.status_code == 200
    closed_ticket = closed.get_json()["ticket"]
    assert closed_ticket["status"] == "closed"
    assert closed_ticket["close_reason"] == "completed"
    assert closed_ticket["closed_at"] is not None

    blocked = client.patch(
        f"/api/monthly_routes/tickets/{ticket_id}",
        json={"status": "open"},
    )
    assert blocked.status_code == 409
    assert blocked.get_json().get("code") == "ticket_closed"


def test_ticket_comments_owned_by_author(ticket_client):
    client, _app = ticket_client
    create = client.post(
        "/api/monthly_routes/routes/1/locations/10/tickets",
        json={"title": "Follow up"},
    )
    ticket_id = create.get_json()["ticket"]["id"]

    comment = client.post(
        f"/api/monthly_routes/tickets/{ticket_id}/comments",
        json={"body": "Called property manager"},
    )
    assert comment.status_code == 201
    comment_id = comment.get_json()["comment"]["id"]

    detail = client.get(f"/api/monthly_routes/tickets/{ticket_id}")
    assert detail.status_code == 200
    assert len(detail.get_json()["ticket"]["comments"]) == 1

    edited = client.patch(
        f"/api/monthly_routes/tickets/{ticket_id}/comments/{comment_id}",
        json={"body": "Called property manager — waiting on keys"},
    )
    assert edited.status_code == 200

    with client.session_transaction() as sess:
        sess["username"] = "other_user"

    forbidden = client.patch(
        f"/api/monthly_routes/tickets/{ticket_id}/comments/{comment_id}",
        json={"body": "Hijacked"},
    )
    assert forbidden.status_code == 403


def test_dashboard_ticket_queue_and_counts(ticket_client):
    client, _app = ticket_client
    create = client.post(
        "/api/monthly_routes/routes/1/locations/10/tickets",
        json={"title": "Dashboard ticket"},
    )
    assert create.status_code == 201

    queue = client.get("/api/monthly_routes/tickets")
    assert queue.status_code == 200
    tickets = queue.get_json()["tickets"]
    assert len(tickets) == 1
    assert tickets[0]["location_label"]
    assert tickets[0]["route_label"]

    dashboard = client.get("/api/monthly_routes/dashboard")
    assert dashboard.status_code == 200
    assert dashboard.get_json().get("open_ticket_count") == 1


def test_closed_tickets_hidden_by_default(ticket_client):
    client, _app = ticket_client
    create = client.post(
        "/api/monthly_routes/routes/1/locations/10/tickets",
        json={"title": "Temporary"},
    )
    ticket_id = create.get_json()["ticket"]["id"]
    client.patch(
        f"/api/monthly_routes/tickets/{ticket_id}",
        json={"status": "closed", "close_reason": "invalid"},
    )

    active = client.get("/api/monthly_routes/tickets")
    assert active.status_code == 200
    assert active.get_json()["tickets"] == []

    with_closed = client.get("/api/monthly_routes/tickets?include_closed=1")
    assert with_closed.status_code == 200
    assert len(with_closed.get_json()["tickets"]) == 1


def test_tag_limits(ticket_client):
    client, _app = ticket_client
    too_long = client.post(
        "/api/monthly_routes/routes/1/locations/10/tickets",
        json={"title": "Tagged", "tags": ["x" * 65]},
    )
    assert too_long.status_code == 400
    assert too_long.get_json().get("code") == "tag_too_long"
