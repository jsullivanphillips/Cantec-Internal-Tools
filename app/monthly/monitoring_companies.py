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


def normalize_monitoring_company_name(name: str | None) -> str:
    return (name or "").strip().casefold()


def _monitoring_name_prefix_match(shorter: str, longer: str) -> bool:
    """True when ``longer`` extends ``shorter`` at a word boundary (``Telus`` → ``Telus Security``)."""
    if not shorter or not longer:
        return False
    if shorter == longer:
        return True
    if not longer.startswith(shorter):
        return False
    if len(longer) == len(shorter):
        return True
    return longer[len(shorter)] in " -–—:/"


def monitoring_company_names_compatible(query: str, directory_name: str) -> bool:
    """Whether a parsed sheet company string can match a directory row name."""
    q = normalize_monitoring_company_name(query)
    d = normalize_monitoring_company_name(directory_name)
    if not q or not d:
        return False
    if q == d:
        return True
    return _monitoring_name_prefix_match(q, d) or _monitoring_name_prefix_match(d, q)


def find_active_monitoring_company_by_name(name: str) -> MonitoringCompany | None:
    folded = normalize_monitoring_company_name(name)
    if not folded:
        return None
    active = (
        MonitoringCompany.query.filter(MonitoringCompany.active.is_(True))
        .order_by(MonitoringCompany.name.asc())
        .all()
    )
    exact = [mc for mc in active if normalize_monitoring_company_name(mc.name) == folded]
    if exact:
        return exact[0]

    compatible = [
        mc for mc in active if monitoring_company_names_compatible(folded, mc.name or "")
    ]
    if not compatible:
        return None
    if len(compatible) == 1:
        return compatible[0]

    query_extends_directory = [
        mc
        for mc in compatible
        if _monitoring_name_prefix_match(normalize_monitoring_company_name(mc.name), folded)
    ]
    if len(query_extends_directory) == 1:
        return query_extends_directory[0]

    directory_extends_query = [
        mc
        for mc in compatible
        if _monitoring_name_prefix_match(folded, normalize_monitoring_company_name(mc.name))
    ]
    if len(directory_extends_query) == 1:
        return directory_extends_query[0]

    compatible.sort(
        key=lambda mc: (
            abs(len(normalize_monitoring_company_name(mc.name)) - len(folded)),
            len(normalize_monitoring_company_name(mc.name)),
            normalize_monitoring_company_name(mc.name),
        )
    )
    return compatible[0]


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
