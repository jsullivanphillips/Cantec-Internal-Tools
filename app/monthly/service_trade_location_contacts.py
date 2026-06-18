"""Sync ServiceTrade contacts for monthly library site locations."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import requests
from sqlalchemy import func

from app.db_models import MonthlyLocation, ServiceTradeSiteContact, db
from app.monthly.service_trade_annual_schedule import _authenticate_service_trade
from app.monthly.service_trade_site_match import SERVICE_TRADE_API_BASE

_PAGE_LIMIT = 500

INACTIVE_CONTACT_STATUSES = frozenset({"inactive", "deleted", "void", "archived"})

_PHONE_FIELDS = ("phone", "mobile", "alternatePhone")


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def contact_has_email(contact: dict[str, Any]) -> bool:
    return bool(_normalize_text(contact.get("email")))


def contact_has_phone(contact: dict[str, Any]) -> bool:
    return any(_normalize_text(contact.get(field)) for field in _PHONE_FIELDS)


def contact_has_reachable_info(contact: dict[str, Any]) -> bool:
    return contact_has_email(contact) or contact_has_phone(contact)


def contact_is_active(contact: dict[str, Any]) -> bool:
    status = _normalize_text(contact.get("status")).lower()
    if not status:
        return True
    return status not in INACTIVE_CONTACT_STATUSES


def contact_is_storable(contact: dict[str, Any]) -> bool:
    return contact_has_reachable_info(contact) and contact_is_active(contact)


def parse_service_trade_contact_row(
    contact: dict[str, Any],
    *,
    service_trade_site_location_id: int,
    is_primary: bool,
    synced_at: datetime,
) -> dict[str, Any]:
    return {
        "service_trade_site_location_id": int(service_trade_site_location_id),
        "service_trade_contact_id": int(contact["id"]),
        "first_name": _normalize_text(contact.get("firstName")) or None,
        "last_name": _normalize_text(contact.get("lastName")) or None,
        "email": _normalize_text(contact.get("email")) or None,
        "phone": _normalize_text(contact.get("phone")) or None,
        "mobile": _normalize_text(contact.get("mobile")) or None,
        "alternate_phone": _normalize_text(contact.get("alternatePhone")) or None,
        "contact_type": _normalize_text(contact.get("type")) or None,
        "status": _normalize_text(contact.get("status")) or None,
        "is_primary": bool(is_primary),
        "synced_at": synced_at,
    }


def fetch_service_trade_contacts_for_location(
    http: requests.Session,
    service_trade_site_location_id: int,
    *,
    limit: int = _PAGE_LIMIT,
) -> list[dict[str, Any]]:
    """Return all contacts ServiceTrade associates with a building location."""
    all_contacts: list[dict[str, Any]] = []
    page = 1
    while True:
        resp = http.get(
            f"{SERVICE_TRADE_API_BASE}/contact",
            params={
                "locationId": int(service_trade_site_location_id),
                "limit": limit,
                "page": page,
            },
        )
        resp.raise_for_status()
        batch = resp.json().get("data", {}).get("contacts") or []
        if not isinstance(batch, list) or not batch:
            break
        all_contacts.extend(row for row in batch if isinstance(row, dict))
        if len(batch) < limit:
            break
        page += 1
    return all_contacts


def fetch_service_trade_primary_contact_id(
    http: requests.Session,
    service_trade_site_location_id: int,
) -> int | None:
    resp = http.get(f"{SERVICE_TRADE_API_BASE}/location/{int(service_trade_site_location_id)}")
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    data = resp.json().get("data") or {}
    if isinstance(data, dict) and isinstance(data.get("location"), dict):
        data = data["location"]
    primary = data.get("primaryContact") if isinstance(data, dict) else None
    if not isinstance(primary, dict):
        return None
    raw_id = primary.get("id")
    if raw_id is None:
        return None
    return int(raw_id)


@dataclass(frozen=True)
class SiteContactSyncResult:
    service_trade_site_location_id: int
    contacts_upserted: int
    contacts_deleted: int
    has_email_contact: bool
    has_phone_contact: bool
    error: str | None = None


def _upsert_service_trade_site_contact_row(row: dict[str, Any], *, now: datetime) -> None:
    existing = ServiceTradeSiteContact.query.filter_by(
        service_trade_site_location_id=int(row["service_trade_site_location_id"]),
        service_trade_contact_id=int(row["service_trade_contact_id"]),
    ).one_or_none()
    if existing is None:
        db.session.add(ServiceTradeSiteContact(**row))
        return
    for key, value in row.items():
        setattr(existing, key, value)
    existing.updated_at = now


def sync_service_trade_site_contacts(
    http: requests.Session,
    service_trade_site_location_id: int,
    *,
    synced_at: datetime | None = None,
    commit: bool = True,
) -> SiteContactSyncResult:
    """Upsert storable contacts for one ST site location and drop stale rows."""
    st_id = int(service_trade_site_location_id)
    now = synced_at or datetime.now(timezone.utc)

    try:
        raw_contacts = fetch_service_trade_contacts_for_location(http, st_id)
        primary_contact_id = fetch_service_trade_primary_contact_id(http, st_id)
    except requests.RequestException as exc:
        return SiteContactSyncResult(
            service_trade_site_location_id=st_id,
            contacts_upserted=0,
            contacts_deleted=0,
            has_email_contact=False,
            has_phone_contact=False,
            error=str(exc),
        )

    storable_rows: list[dict[str, Any]] = []
    for contact in raw_contacts:
        if not contact_is_storable(contact):
            continue
        contact_id = contact.get("id")
        if contact_id is None:
            continue
        storable_rows.append(
            parse_service_trade_contact_row(
                contact,
                service_trade_site_location_id=st_id,
                is_primary=primary_contact_id is not None and int(contact_id) == primary_contact_id,
                synced_at=now,
            )
        )

    kept_ids = {int(row["service_trade_contact_id"]) for row in storable_rows}
    has_email = any(bool(row.get("email")) for row in storable_rows)
    has_phone = any(
        bool(row.get("phone") or row.get("mobile") or row.get("alternate_phone"))
        for row in storable_rows
    )

    for row in storable_rows:
        _upsert_service_trade_site_contact_row(row, now=now)

    delete_query = ServiceTradeSiteContact.query.filter_by(service_trade_site_location_id=st_id)
    if kept_ids:
        delete_query = delete_query.filter(~ServiceTradeSiteContact.service_trade_contact_id.in_(kept_ids))
    deleted = delete_query.delete(synchronize_session=False)

    _update_monthly_location_contact_flags(
        st_id,
        synced_at=now,
        has_email_contact=has_email,
        has_phone_contact=has_phone,
    )

    if commit:
        db.session.commit()

    return SiteContactSyncResult(
        service_trade_site_location_id=st_id,
        contacts_upserted=len(storable_rows),
        contacts_deleted=int(deleted),
        has_email_contact=has_email,
        has_phone_contact=has_phone,
    )


def linked_service_trade_site_location_ids() -> list[int]:
    rows = (
        db.session.query(MonthlyLocation.service_trade_site_location_id)
        .filter(MonthlyLocation.service_trade_site_location_id.isnot(None))
        .distinct()
        .order_by(MonthlyLocation.service_trade_site_location_id.asc())
        .all()
    )
    return [int(row[0]) for row in rows if row[0] is not None]


def clear_unlinked_monthly_location_contact_flags() -> int:
    return (
        db.session.query(MonthlyLocation)
        .filter(MonthlyLocation.service_trade_site_location_id.is_(None))
        .filter(
            (MonthlyLocation.service_trade_contacts_synced_at.isnot(None))
            | (MonthlyLocation.service_trade_has_contact_email.isnot(None))
            | (MonthlyLocation.service_trade_has_contact_phone.isnot(None))
        )
        .update(
            {
                MonthlyLocation.service_trade_contacts_synced_at: None,
                MonthlyLocation.service_trade_has_contact_email: None,
                MonthlyLocation.service_trade_has_contact_phone: None,
            },
            synchronize_session=False,
        )
    )


def prune_orphaned_service_trade_site_contacts(linked_site_ids: set[int] | None = None) -> int:
    if linked_site_ids is None:
        linked_site_ids = set(linked_service_trade_site_location_ids())
    if not linked_site_ids:
        return ServiceTradeSiteContact.query.delete(synchronize_session=False)
    return (
        ServiceTradeSiteContact.query.filter(
            ~ServiceTradeSiteContact.service_trade_site_location_id.in_(linked_site_ids)
        ).delete(synchronize_session=False)
    )


def _update_monthly_location_contact_flags(
    service_trade_site_location_id: int,
    *,
    synced_at: datetime,
    has_email_contact: bool,
    has_phone_contact: bool,
) -> None:
    db.session.query(MonthlyLocation).filter(
        MonthlyLocation.service_trade_site_location_id == int(service_trade_site_location_id)
    ).update(
        {
            MonthlyLocation.service_trade_contacts_synced_at: synced_at,
            MonthlyLocation.service_trade_has_contact_email: has_email_contact,
            MonthlyLocation.service_trade_has_contact_phone: has_phone_contact,
        },
        synchronize_session=False,
    )


@dataclass(frozen=True)
class BulkContactSyncSummary:
    site_locations_processed: int
    contacts_upserted: int
    contacts_deleted: int
    sites_with_email: int
    sites_with_phone: int
    sites_missing_email: int
    errors: tuple[str, ...]
    unlinked_flags_cleared: int
    orphaned_contacts_pruned: int


def sync_all_linked_service_trade_site_contacts(
    http: requests.Session,
    *,
    site_location_ids: list[int] | None = None,
    limit: int | None = None,
) -> BulkContactSyncSummary:
    """Refresh contacts for every distinct linked ST site location id."""
    linked_ids = site_location_ids or linked_service_trade_site_location_ids()
    if limit is not None:
        linked_ids = linked_ids[: max(0, int(limit))]

    unlinked_flags_cleared = clear_unlinked_monthly_location_contact_flags()

    contacts_upserted = 0
    contacts_deleted = 0
    sites_with_email = 0
    sites_with_phone = 0
    sites_missing_email = 0
    errors: list[str] = []

    for st_id in linked_ids:
        result = sync_service_trade_site_contacts(http, st_id, commit=True)
        if result.error:
            errors.append(f"ST location {st_id}: {result.error}")
            continue
        contacts_upserted += result.contacts_upserted
        contacts_deleted += result.contacts_deleted
        if result.has_email_contact:
            sites_with_email += 1
        else:
            sites_missing_email += 1
        if result.has_phone_contact:
            sites_with_phone += 1

    orphaned_contacts_pruned = prune_orphaned_service_trade_site_contacts(set(linked_ids))
    db.session.commit()

    return BulkContactSyncSummary(
        site_locations_processed=len(linked_ids),
        contacts_upserted=contacts_upserted,
        contacts_deleted=contacts_deleted,
        sites_with_email=sites_with_email,
        sites_with_phone=sites_with_phone,
        sites_missing_email=sites_missing_email,
        errors=tuple(errors),
        unlinked_flags_cleared=int(unlinked_flags_cleared),
        orphaned_contacts_pruned=int(orphaned_contacts_pruned),
    )


def service_trade_credentials() -> tuple[str, str]:
    username = os.getenv("PROCESSING_USERNAME")
    password = os.getenv("PROCESSING_PASSWORD")
    if not username or not password:
        raise RuntimeError("Missing ServiceTrade creds. Set PROCESSING_USERNAME/PROCESSING_PASSWORD.")
    return username, password


def authenticated_service_trade_session(
    *,
    username: str | None = None,
    password: str | None = None,
    session: requests.Session | None = None,
) -> requests.Session:
    user, pwd = service_trade_credentials() if username is None or password is None else (username, password)
    http = session or requests.Session()
    _authenticate_service_trade(http, username=user, password=pwd)
    return http


def count_linked_monthly_locations_missing_email_contact() -> int:
    return (
        db.session.query(func.count(MonthlyLocation.id))
        .filter(MonthlyLocation.service_trade_site_location_id.isnot(None))
        .filter(MonthlyLocation.service_trade_has_contact_email.is_(False))
        .scalar()
        or 0
    )


def _contact_display_name(row: ServiceTradeSiteContact) -> str:
    parts = [p for p in (row.first_name, row.last_name) if p and str(p).strip()]
    if parts:
        return " ".join(str(p).strip() for p in parts)
    if row.email:
        return str(row.email).strip()
    for field in (row.phone, row.mobile, row.alternate_phone):
        if field and str(field).strip():
            return str(field).strip()
    return f"Contact {row.service_trade_contact_id}"


def serialize_service_trade_site_contact(row: ServiceTradeSiteContact) -> dict[str, object]:
    return {
        "id": int(row.service_trade_contact_id),
        "first_name": row.first_name,
        "last_name": row.last_name,
        "display_name": _contact_display_name(row),
        "email": row.email,
        "phone": row.phone,
        "mobile": row.mobile,
        "alternate_phone": row.alternate_phone,
        "contact_type": row.contact_type,
        "is_primary": bool(row.is_primary),
    }


def contacts_for_service_trade_site_location_id(st_location_id: int) -> list[ServiceTradeSiteContact]:
    rows = ServiceTradeSiteContact.query.filter_by(
        service_trade_site_location_id=int(st_location_id),
    ).all()
    rows.sort(
        key=lambda row: (
            0 if row.is_primary else 1,
            _contact_display_name(row).casefold(),
            int(row.service_trade_contact_id),
        )
    )
    return rows


def build_location_service_trade_contacts_payload(location_id: int) -> dict[str, object]:
    loc = MonthlyLocation.query.get(int(location_id))
    if loc is None:
        raise LookupError("location_not_found")
    st_id = loc.service_trade_site_location_id
    if st_id is None:
        return {
            "location_id": int(location_id),
            "has_service_trade_link": False,
            "service_trade_site_location_id": None,
            "contacts": [],
        }
    rows = contacts_for_service_trade_site_location_id(int(st_id))
    return {
        "location_id": int(location_id),
        "has_service_trade_link": True,
        "service_trade_site_location_id": int(st_id),
        "contacts": [serialize_service_trade_site_contact(row) for row in rows],
    }
