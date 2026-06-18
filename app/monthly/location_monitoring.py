"""Whether a monthly library location has monitoring configured."""

from __future__ import annotations

from app.db_models import MonthlyLocation
from app.monthly.monitoring_notes_parse import parse_monitoring_notes


def _non_empty(value: str | None) -> str | None:
    text = (value or "").strip()
    return text or None


def location_has_monitoring(loc: MonthlyLocation) -> bool:
    """Mirror frontend ``stopHasMonitoring``: company, account, or password present."""
    company = _non_empty(loc.monitoring_company.name if loc.monitoring_company is not None else None)
    account = _non_empty(loc.monitoring_account_number)
    password = _non_empty(loc.monitoring_password)

    if company or account or password:
        return True

    parsed = parse_monitoring_notes(loc.monitoring_notes)
    parsed_company = _non_empty(parsed.company)
    parsed_account = _non_empty(parsed.acct)
    parsed_password = _non_empty(parsed.password)
    return bool(parsed_company or parsed_account or parsed_password)
