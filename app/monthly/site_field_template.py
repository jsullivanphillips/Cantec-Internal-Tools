"""Library master template vs run-month snapshots (``MonthlyLocationMonth``)."""

from __future__ import annotations

from datetime import date

from app.db_models import MonthlyLocation, MonthlyLocationMonth
from app.monthly.location_building import monthly_location_building_name
from app.monthly.testing_site_fields import SNAPSHOT_STRING_FIELDS, SNAPSHOT_TEXT_FIELDS


def _normalize_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _panel_from_location(loc: MonthlyLocation) -> str | None:
    return _normalize_text(loc.panel) or _normalize_text(loc.facp_detail)


def master_template_fields(loc: MonthlyLocation) -> dict[str, object]:
    """Canonical field values for library display and seeding new run months (office master)."""
    panel = _panel_from_location(loc)
    company_name: str | None = None
    if loc.monitoring_company is not None:
        company_name = _normalize_text(loc.monitoring_company.name)
    return {
        "annual_month": loc.annual_month,
        "property_management_company": _normalize_text(loc.property_management_company),
        "building_name": monthly_location_building_name(loc),
        "panel_location": loc.panel_location,
        "door_code": loc.door_code,
        "ring": _normalize_text(loc.ring_detail),
        "key_number": _normalize_text(loc.keys),
        "panel": panel,
        "facp": panel,
        "testing_procedures": loc.testing_procedures,
        "inspection_tech_notes": loc.inspection_tech_notes,
        "monitoring_company_id": loc.monitoring_company_id,
        "monitoring_company_name": company_name,
        "monitoring_account_number": loc.monitoring_account_number,
        "monitoring_password": loc.monitoring_password,
        "monitoring_notes": loc.monitoring_notes,
    }


def latest_mlm_for_location(
    location_id: int,
    *,
    before_month: date | None = None,
) -> MonthlyLocationMonth | None:
    q = MonthlyLocationMonth.query.filter(
        MonthlyLocationMonth.monthly_location_id == int(location_id),
    )
    if before_month is not None:
        q = q.filter(MonthlyLocationMonth.month_date < before_month)
    return q.order_by(MonthlyLocationMonth.month_date.desc()).first()


def merge_template_with_prior_fallback(
    template: dict[str, object],
    prior: MonthlyLocationMonth | None,
) -> dict[str, object]:
    """Office master wins; fill gaps from the most recent prior run month."""
    if prior is None:
        return dict(template)
    merged = dict(template)
    for key in (
        *SNAPSHOT_STRING_FIELDS,
        *SNAPSHOT_TEXT_FIELDS,
        "monitoring_company_id",
        "monitoring_company_name",
        "monitoring_notes",
    ):
        if key in ("panel", "facp", "building_name"):
            continue
        if _normalize_text(merged.get(key)) is not None:
            continue
        merged[key] = getattr(prior, key, None)
    if _normalize_text(merged.get("panel")) is None:
        panel = _normalize_text(prior.panel) or _normalize_text(prior.facp)
        merged["panel"] = panel
        merged["facp"] = panel
    return merged
