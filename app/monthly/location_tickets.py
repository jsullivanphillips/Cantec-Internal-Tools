"""Per-location office tickets for monthly run processing."""

from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy.exc import OperationalError, ProgrammingError

from app.db_models import (
    LOCATION_TICKET_STATUSES,
    MonthlyLocationTicket,
    MonthlyLocationTicketEvent,
    MonthlyRouteLocation,
    MonthlyRouteRun,
    db,
)


def _allocate_row_id(model_cls) -> int | None:
    bind = db.session.get_bind()
    if bind.dialect.name != "sqlite":
        return None
    from sqlalchemy import func

    current = db.session.query(func.max(model_cls.id)).scalar()
    return int(current or 0) + 1


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.isoformat()


def _validate_status(status: str) -> str | None:
    s = (status or "").strip().lower()
    if s not in LOCATION_TICKET_STATUSES:
        return None
    return s


def serialize_ticket(ticket: MonthlyLocationTicket) -> dict[str, object]:
    return {
        "id": int(ticket.id),
        "location_id": int(ticket.monthly_route_location_id),
        "run_id": int(ticket.run_id) if ticket.run_id is not None else None,
        "month_date": ticket.month_date.isoformat() if ticket.month_date else None,
        "title": ticket.title,
        "body": (ticket.body or "").strip() or None,
        "status": ticket.status,
        "created_by": ticket.created_by,
        "resolved_at": _iso(ticket.resolved_at),
        "created_at": _iso(ticket.created_at),
        "updated_at": _iso(ticket.updated_at),
    }


def serialize_ticket_event(event: MonthlyLocationTicketEvent) -> dict[str, object]:
    return {
        "id": int(event.id),
        "ticket_id": int(event.ticket_id),
        "from_status": event.from_status,
        "to_status": event.to_status,
        "note": (event.note or "").strip() or None,
        "created_by": event.created_by,
        "created_at": _iso(event.created_at),
    }


def list_tickets_for_location(location_id: int) -> list[dict[str, object]]:
    rows = (
        MonthlyLocationTicket.query.filter_by(monthly_route_location_id=int(location_id))
        .order_by(
            MonthlyLocationTicket.status.asc(),
            MonthlyLocationTicket.updated_at.desc(),
            MonthlyLocationTicket.id.desc(),
        )
        .all()
    )
    return [serialize_ticket(t) for t in rows]


def count_open_tickets_for_location(location_id: int) -> int:
    return count_open_tickets_by_location([int(location_id)]).get(int(location_id), 0)


def count_open_tickets_by_location(location_ids: list[int]) -> dict[int, int]:
    """Open ticket counts keyed by ``monthly_route_location_id`` (one query)."""
    if not location_ids:
        return {}
    try:
        rows = (
            db.session.query(
                MonthlyLocationTicket.monthly_route_location_id,
                db.func.count(MonthlyLocationTicket.id),
            )
            .filter(
                MonthlyLocationTicket.monthly_route_location_id.in_([int(i) for i in location_ids]),
                MonthlyLocationTicket.status != "resolved",
            )
            .group_by(MonthlyLocationTicket.monthly_route_location_id)
            .all()
        )
    except (OperationalError, ProgrammingError):
        db.session.rollback()
        return {}
    return {int(loc_id): int(count) for loc_id, count in rows}


def create_location_ticket(
    location_id: int,
    *,
    title: str,
    body: str | None,
    username: str,
    run: MonthlyRouteRun | None = None,
    month_first: date | None = None,
) -> MonthlyLocationTicket:
    loc = db.session.get(MonthlyRouteLocation, int(location_id))
    if loc is None:
        raise ValueError("location_not_found")
    ticket_kwargs: dict = {
        "monthly_route_location_id": int(location_id),
        "run_id": int(run.id) if run is not None else None,
        "month_date": month_first,
        "title": title.strip(),
        "body": (body or "").strip() or None,
        "status": "open",
        "created_by": username,
    }
    ticket_id_alloc = _allocate_row_id(MonthlyLocationTicket)
    if ticket_id_alloc is not None:
        ticket_kwargs["id"] = ticket_id_alloc
    ticket = MonthlyLocationTicket(**ticket_kwargs)
    db.session.add(ticket)
    db.session.flush()
    event_kwargs: dict = {
        "ticket_id": int(ticket.id),
        "from_status": None,
        "to_status": "open",
        "note": "Ticket opened",
        "created_by": username,
    }
    event_id = _allocate_row_id(MonthlyLocationTicketEvent)
    if event_id is not None:
        event_kwargs["id"] = event_id
    event = MonthlyLocationTicketEvent(**event_kwargs)
    db.session.add(event)
    return ticket


def update_location_ticket(
    ticket: MonthlyLocationTicket,
    *,
    username: str,
    status: str | None = None,
    title: str | None = None,
    body: str | None = None,
    note: str | None = None,
) -> MonthlyLocationTicket:
    prev_status = ticket.status
    if title is not None:
        ticket.title = title.strip()
    if body is not None:
        ticket.body = (body or "").strip() or None
    if status is not None:
        new_status = _validate_status(status)
        if new_status is None:
            raise ValueError("invalid_status")
        if new_status != ticket.status:
            ticket.status = new_status
            if new_status == "resolved":
                ticket.resolved_at = datetime.now(timezone.utc)
            else:
                ticket.resolved_at = None
            db.session.add(
                MonthlyLocationTicketEvent(
                    **(
                        {
                            "id": event_id,
                            "ticket_id": int(ticket.id),
                            "from_status": prev_status,
                            "to_status": new_status,
                            "note": (note or "").strip() or None,
                            "created_by": username,
                        }
                        if (event_id := _allocate_row_id(MonthlyLocationTicketEvent)) is not None
                        else {
                            "ticket_id": int(ticket.id),
                            "from_status": prev_status,
                            "to_status": new_status,
                            "note": (note or "").strip() or None,
                            "created_by": username,
                        }
                    )
                )
            )
    return ticket


def ticket_events_for_ticket(ticket_id: int) -> list[dict[str, object]]:
    rows = (
        MonthlyLocationTicketEvent.query.filter_by(ticket_id=int(ticket_id))
        .order_by(MonthlyLocationTicketEvent.created_at.asc(), MonthlyLocationTicketEvent.id.asc())
        .all()
    )
    return [serialize_ticket_event(e) for e in rows]
