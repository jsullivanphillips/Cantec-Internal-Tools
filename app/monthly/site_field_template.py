"""Library "newest edition" template vs run-month snapshots (``MonthlyTestingSiteMonth``)."""

from __future__ import annotations

from datetime import date

from app.db_models import (
    MonthlyRouteLocation,
    MonthlyTestingSite,
    MonthlyTestingSiteMonth,
)
from app.monthly.testing_site_fields import SNAPSHOT_STRING_FIELDS, SNAPSHOT_TEXT_FIELDS


def _normalize_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _panel_from_testing_site(ts: MonthlyTestingSite) -> str | None:
    return _normalize_text(ts.panel) or _normalize_text(ts.facp_detail)


def _master_monitoring_company_name(
    ts: MonthlyTestingSite,
    loc: MonthlyRouteLocation,
) -> str | None:
    if ts.monitoring_company is not None:
        return _normalize_text(ts.monitoring_company.name)
    if loc.monitoring_company is not None:
        return _normalize_text(loc.monitoring_company.name)
    return None


def master_template_fields(
    ts: MonthlyTestingSite,
    loc: MonthlyRouteLocation,
) -> dict[str, object]:
    """Canonical field values for library display and seeding new run months (office master)."""
    pmc = _normalize_text(ts.property_management_company) or _normalize_text(
        loc.property_management_company
    )
    panel = _panel_from_testing_site(ts)
    return {
        "annual_month": ts.annual_month or loc.annual_month,
        "property_management_company": pmc,
        "building_name": _normalize_text(ts.building_name) or _normalize_text(loc.building),
        "panel_location": ts.panel_location,
        "door_code": ts.door_code,
        "ring": _normalize_text(ts.ring_detail) or _normalize_text(loc.ring_detail),
        "key_number": _normalize_text(ts.keys) or _normalize_text(loc.keys),
        "panel": panel,
        "facp": panel,
        "testing_procedures": ts.testing_procedures or loc.testing_procedures,
        "inspection_tech_notes": ts.inspection_tech_notes or loc.inspection_tech_notes,
        "monitoring_company_id": ts.monitoring_company_id,
        "monitoring_company_name": _master_monitoring_company_name(ts, loc),
        "monitoring_account_number": ts.monitoring_account_number,
        "monitoring_password": ts.monitoring_password,
        "monitoring_notes": ts.monitoring_notes,
    }


def latest_mtsm_for_testing_site(
    testing_site_id: int,
    *,
    before_month: date | None = None,
) -> MonthlyTestingSiteMonth | None:
    q = MonthlyTestingSiteMonth.query.filter(
        MonthlyTestingSiteMonth.monthly_testing_site_id == int(testing_site_id),
    )
    if before_month is not None:
        q = q.filter(MonthlyTestingSiteMonth.month_date < before_month)
    return q.order_by(MonthlyTestingSiteMonth.month_date.desc()).first()


def merge_template_with_prior_fallback(
    template: dict[str, object],
    prior: MonthlyTestingSiteMonth | None,
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
        if key in ("panel", "facp"):
            continue
        if _normalize_text(merged.get(key)) is not None:
            continue
        merged[key] = getattr(prior, key, None)
    if _normalize_text(merged.get("panel")) is None:
        panel = _normalize_text(prior.panel) or _normalize_text(prior.facp)
        merged["panel"] = panel
        merged["facp"] = panel
    return merged
