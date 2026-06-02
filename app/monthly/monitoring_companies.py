"""Monitoring company directory helpers and serialization."""

from __future__ import annotations

from sqlalchemy import func

from app.db_models import MonitoringCompany, db


def normalize_monitoring_company_name(name: str | None) -> str:
    return (name or "").strip().casefold()


def serialize_monitoring_company(mc: MonitoringCompany | None) -> dict[str, object] | None:
    if mc is None:
        return None
    return {
        "id": int(mc.id),
        "name": (mc.name or "").strip() or None,
        "primary_phone": (mc.primary_phone or "").strip() or None,
        "secondary_phone": (mc.secondary_phone or "").strip() or None,
        "active": bool(mc.active),
    }


def find_active_monitoring_company_by_name(name: str) -> MonitoringCompany | None:
    folded = normalize_monitoring_company_name(name)
    if not folded:
        return None
    row = MonitoringCompany.query.filter(
        db.func.lower(MonitoringCompany.name) == folded,
        MonitoringCompany.active.is_(True),
    ).first()
    if row is not None:
        return row
    for candidate in MonitoringCompany.query.filter(MonitoringCompany.active.is_(True)).limit(1000).all():
        if normalize_monitoring_company_name(candidate.name) == folded:
            return candidate
    return None


def _next_sqlite_bigint_id(model) -> int | None:
    if "sqlite" not in (str(db.engine.url) or "").lower():
        return None
    return int(db.session.query(func.coalesce(func.max(model.id), 0)).scalar() or 0) + 1


def create_monitoring_company(
    *,
    name: str,
    primary_phone: str | None = None,
    secondary_phone: str | None = None,
    active: bool = True,
) -> tuple[MonitoringCompany, bool]:
    """Create directory row or return existing active match. Second value is True when reused."""
    cleaned_name = (name or "").strip()
    if not cleaned_name:
        raise ValueError("name_required")
    existing = find_active_monitoring_company_by_name(cleaned_name)
    if existing is not None:
        return existing, True
    mc_kwargs: dict[str, object] = {
        "name": cleaned_name,
        "name_normalized": normalize_monitoring_company_name(cleaned_name),
        "primary_phone": (primary_phone or "").strip() or None,
        "secondary_phone": (secondary_phone or "").strip() or None,
        "active": active,
    }
    nid = _next_sqlite_bigint_id(MonitoringCompany)
    if nid is not None:
        mc_kwargs["id"] = nid
    mc = MonitoringCompany(**mc_kwargs)
    db.session.add(mc)
    db.session.flush()
    return mc, False
