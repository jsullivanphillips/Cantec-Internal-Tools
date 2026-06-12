"""Per-location office tickets for monthly run processing."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone

from sqlalchemy.exc import OperationalError, ProgrammingError

from app.db_models import (
    LOCATION_TICKET_ACTIVE_STATUSES,
    LOCATION_TICKET_CLOSE_REASONS,
    LOCATION_TICKET_STATUSES,
    MonthlyLocation,
    MonthlyLocationTicket,
    MonthlyLocationTicketComment,
    MonthlyLocationTicketEvent,
    MonthlyRoute,
    MonthlyRouteRun,
    db,
)

MAX_TICKET_TAGS = 16
MAX_TAG_LENGTH = 64


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


def _validate_close_reason(reason: str) -> str | None:
    r = (reason or "").strip().lower()
    if r not in LOCATION_TICKET_CLOSE_REASONS:
        return None
    return r


def normalize_ticket_tags(raw_tags: object) -> list[str]:
    if raw_tags is None:
        return []
    if not isinstance(raw_tags, list):
        raise ValueError("invalid_tags")
    seen: set[str] = set()
    out: list[str] = []
    for item in raw_tags:
        if not isinstance(item, str):
            raise ValueError("invalid_tags")
        tag = item.strip()
        if not tag:
            continue
        if len(tag) > MAX_TAG_LENGTH:
            raise ValueError("tag_too_long")
        key = tag.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(tag)
        if len(out) > MAX_TICKET_TAGS:
            raise ValueError("too_many_tags")
    return out


def _tags_from_ticket(ticket: MonthlyLocationTicket) -> list[str]:
    raw = (ticket.tags_json or "").strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed if str(item).strip()]


def _set_ticket_tags(ticket: MonthlyLocationTicket, tags: list[str]) -> None:
    ticket.tags_json = json.dumps(tags) if tags else None


def _location_label(loc: MonthlyLocation) -> str:
    label = (loc.label or "").strip()
    if label:
        return label
    address = (loc.address or loc.display_address or "").strip()
    return address or f"Location #{loc.id}"


def _route_label(route: MonthlyRoute | None) -> str | None:
    if route is None:
        return None
    display = (route.display_name or "").strip()
    if display:
        return display
    return f"Route {route.route_number}"


def serialize_ticket_comment(comment: MonthlyLocationTicketComment) -> dict[str, object]:
    return {
        "id": int(comment.id),
        "ticket_id": int(comment.ticket_id),
        "body": comment.body,
        "created_by": comment.created_by,
        "created_at": _iso(comment.created_at),
        "updated_at": _iso(comment.updated_at),
    }


def serialize_ticket(
    ticket: MonthlyLocationTicket,
    *,
    include_comments: bool = False,
    location_label: str | None = None,
    route_id: int | None = None,
    route_label: str | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": int(ticket.id),
        "location_id": int(ticket.monthly_location_id),
        "run_id": int(ticket.run_id) if ticket.run_id is not None else None,
        "month_date": ticket.month_date.isoformat() if ticket.month_date else None,
        "title": ticket.title,
        "description": (ticket.description or "").strip() or None,
        "tags": _tags_from_ticket(ticket),
        "status": ticket.status,
        "close_reason": ticket.close_reason,
        "created_by": ticket.created_by,
        "closed_at": _iso(ticket.closed_at),
        "created_at": _iso(ticket.created_at),
        "updated_at": _iso(ticket.updated_at),
    }
    if location_label is not None:
        payload["location_label"] = location_label
    if route_id is not None:
        payload["route_id"] = route_id
    if route_label is not None:
        payload["route_label"] = route_label
    if include_comments:
        payload["comments"] = [
            serialize_ticket_comment(c) for c in (ticket.comments or [])
        ]
    return payload


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


def _ticket_queue_rows(
    *,
    location_id: int | None = None,
    include_closed: bool = False,
) -> list[tuple[MonthlyLocationTicket, MonthlyLocation, MonthlyRoute | None]]:
    query = (
        db.session.query(MonthlyLocationTicket, MonthlyLocation, MonthlyRoute)
        .join(MonthlyLocation, MonthlyLocation.id == MonthlyLocationTicket.monthly_location_id)
        .outerjoin(MonthlyRoute, MonthlyRoute.id == MonthlyLocation.monthly_route_id)
    )
    if location_id is not None:
        query = query.filter(MonthlyLocationTicket.monthly_location_id == int(location_id))
    if not include_closed:
        query = query.filter(MonthlyLocationTicket.status.in_(LOCATION_TICKET_ACTIVE_STATUSES))
    rows = query.order_by(
        MonthlyLocationTicket.updated_at.desc(),
        MonthlyLocationTicket.id.desc(),
    ).all()
    return rows


def list_tickets_for_location(
    location_id: int,
    *,
    include_closed: bool = False,
) -> list[dict[str, object]]:
    rows = _ticket_queue_rows(location_id=int(location_id), include_closed=include_closed)
    return [
        serialize_ticket(
            ticket,
            location_label=_location_label(loc),
            route_id=int(loc.monthly_route_id) if loc.monthly_route_id is not None else None,
            route_label=_route_label(route),
        )
        for ticket, loc, route in rows
    ]


def list_tickets_dashboard(*, include_closed: bool = False) -> list[dict[str, object]]:
    rows = _ticket_queue_rows(include_closed=include_closed)
    return [
        serialize_ticket(
            ticket,
            location_label=_location_label(loc),
            route_id=int(loc.monthly_route_id) if loc.monthly_route_id is not None else None,
            route_label=_route_label(route),
        )
        for ticket, loc, route in rows
    ]


def get_ticket_detail(ticket_id: int) -> dict[str, object] | None:
    row = (
        db.session.query(MonthlyLocationTicket, MonthlyLocation, MonthlyRoute)
        .join(MonthlyLocation, MonthlyLocation.id == MonthlyLocationTicket.monthly_location_id)
        .outerjoin(MonthlyRoute, MonthlyRoute.id == MonthlyLocation.monthly_route_id)
        .filter(MonthlyLocationTicket.id == int(ticket_id))
        .one_or_none()
    )
    if row is None:
        return None
    ticket, loc, route = row
    payload = serialize_ticket(
        ticket,
        include_comments=True,
        location_label=_location_label(loc),
        route_id=int(loc.monthly_route_id) if loc.monthly_route_id is not None else None,
        route_label=_route_label(route),
    )
    payload["events"] = ticket_events_for_ticket(int(ticket.id))
    return payload


def count_open_tickets_for_location(location_id: int) -> int:
    return count_open_tickets_by_location([int(location_id)]).get(int(location_id), 0)


def count_open_tickets_by_location(location_ids: list[int]) -> dict[int, int]:
    """Active ticket counts keyed by ``monthly_location_id`` (one query)."""
    if not location_ids:
        return {}
    try:
        rows = (
            db.session.query(
                MonthlyLocationTicket.monthly_location_id,
                db.func.count(MonthlyLocationTicket.id),
            )
            .filter(
                MonthlyLocationTicket.monthly_location_id.in_([int(i) for i in location_ids]),
                MonthlyLocationTicket.status.in_(LOCATION_TICKET_ACTIVE_STATUSES),
            )
            .group_by(MonthlyLocationTicket.monthly_location_id)
            .all()
        )
    except (OperationalError, ProgrammingError):
        db.session.rollback()
        return {}
    return {int(loc_id): int(count) for loc_id, count in rows}


def count_active_tickets_global() -> dict[str, int]:
    try:
        rows = (
            db.session.query(
                MonthlyLocationTicket.status,
                db.func.count(MonthlyLocationTicket.id),
            )
            .filter(MonthlyLocationTicket.status.in_(LOCATION_TICKET_ACTIVE_STATUSES))
            .group_by(MonthlyLocationTicket.status)
            .all()
        )
    except (OperationalError, ProgrammingError):
        db.session.rollback()
        return {"open": 0, "in_progress": 0, "active_total": 0}
    counts = {str(status): int(count) for status, count in rows}
    open_count = counts.get("open", 0)
    in_progress_count = counts.get("in_progress", 0)
    return {
        "open": open_count,
        "in_progress": in_progress_count,
        "active_total": open_count + in_progress_count,
    }


def _append_status_event(
    ticket: MonthlyLocationTicket,
    *,
    from_status: str | None,
    to_status: str,
    username: str,
    note: str | None = None,
) -> None:
    event_kwargs: dict = {
        "ticket_id": int(ticket.id),
        "from_status": from_status,
        "to_status": to_status,
        "note": (note or "").strip() or None,
        "created_by": username,
    }
    event_id = _allocate_row_id(MonthlyLocationTicketEvent)
    if event_id is not None:
        event_kwargs["id"] = event_id
    db.session.add(MonthlyLocationTicketEvent(**event_kwargs))


def create_location_ticket(
    location_id: int,
    *,
    title: str,
    description: str | None,
    tags: list[str] | None = None,
    username: str,
    run: MonthlyRouteRun | None = None,
    month_first: date | None = None,
) -> MonthlyLocationTicket:
    loc = db.session.get(MonthlyLocation, int(location_id))
    if loc is None:
        raise ValueError("location_not_found")
    normalized_tags = normalize_ticket_tags(tags or [])
    ticket_kwargs: dict = {
        "monthly_location_id": int(location_id),
        "run_id": int(run.id) if run is not None else None,
        "month_date": month_first,
        "title": title.strip(),
        "description": (description or "").strip() or None,
        "status": "open",
        "created_by": username,
    }
    ticket_id_alloc = _allocate_row_id(MonthlyLocationTicket)
    if ticket_id_alloc is not None:
        ticket_kwargs["id"] = ticket_id_alloc
    ticket = MonthlyLocationTicket(**ticket_kwargs)
    _set_ticket_tags(ticket, normalized_tags)
    db.session.add(ticket)
    db.session.flush()
    _append_status_event(
        ticket,
        from_status=None,
        to_status="open",
        username=username,
        note="Ticket opened",
    )
    return ticket


def update_location_ticket(
    ticket: MonthlyLocationTicket,
    *,
    username: str,
    status: str | None = None,
    close_reason: str | None = None,
    title: str | None = None,
    description: str | None = None,
    tags: list[str] | None = None,
    note: str | None = None,
) -> MonthlyLocationTicket:
    if ticket.status == "closed":
        raise ValueError("ticket_closed")

    prev_status = ticket.status
    if title is not None:
        ticket.title = title.strip()
    if description is not None:
        ticket.description = (description or "").strip() or None
    if tags is not None:
        _set_ticket_tags(ticket, normalize_ticket_tags(tags))

    if status is not None:
        new_status = _validate_status(status)
        if new_status is None:
            raise ValueError("invalid_status")
        if new_status != ticket.status:
            if new_status == "closed":
                validated_reason = _validate_close_reason(close_reason or "")
                if validated_reason is None:
                    raise ValueError("close_reason_required")
                ticket.status = "closed"
                ticket.close_reason = validated_reason
                ticket.closed_at = datetime.now(timezone.utc)
            else:
                ticket.status = new_status
                ticket.close_reason = None
                ticket.closed_at = None
            _append_status_event(
                ticket,
                from_status=prev_status,
                to_status=ticket.status,
                username=username,
                note=note,
            )
    return ticket


def add_ticket_comment(
    ticket: MonthlyLocationTicket,
    *,
    body: str,
    username: str,
) -> MonthlyLocationTicketComment:
    if ticket.status == "closed":
        raise ValueError("ticket_closed")
    text = (body or "").strip()
    if not text:
        raise ValueError("comment_body_required")
    comment_kwargs: dict = {
        "ticket_id": int(ticket.id),
        "body": text,
        "created_by": username,
    }
    comment_id = _allocate_row_id(MonthlyLocationTicketComment)
    if comment_id is not None:
        comment_kwargs["id"] = comment_id
    comment = MonthlyLocationTicketComment(**comment_kwargs)
    db.session.add(comment)
    ticket.updated_at = datetime.now(timezone.utc)
    return comment


def update_ticket_comment(
    comment: MonthlyLocationTicketComment,
    *,
    body: str,
    username: str,
) -> MonthlyLocationTicketComment:
    if (comment.created_by or "").strip() != (username or "").strip():
        raise ValueError("comment_not_owned")
    text = (body or "").strip()
    if not text:
        raise ValueError("comment_body_required")
    comment.body = text
    comment.updated_at = datetime.now(timezone.utc)
    if comment.ticket is not None:
        comment.ticket.updated_at = datetime.now(timezone.utc)
    return comment


def delete_ticket_comment(
    comment: MonthlyLocationTicketComment,
    *,
    username: str,
) -> None:
    if (comment.created_by or "").strip() != (username or "").strip():
        raise ValueError("comment_not_owned")
    ticket = comment.ticket
    db.session.delete(comment)
    if ticket is not None:
        ticket.updated_at = datetime.now(timezone.utc)


def ticket_events_for_ticket(ticket_id: int) -> list[dict[str, object]]:
    rows = (
        MonthlyLocationTicketEvent.query.filter_by(ticket_id=int(ticket_id))
        .order_by(MonthlyLocationTicketEvent.created_at.asc(), MonthlyLocationTicketEvent.id.asc())
        .all()
    )
    return [serialize_ticket_event(e) for e in rows]
