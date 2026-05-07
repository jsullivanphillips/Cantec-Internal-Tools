"""
Monthly inspection sheet field keys and revision JSON shapes.

Used by API, technician UI, office approval flows, and Excel import scripts.
Append-only revisions store ``value_previous`` / ``value_new`` as JSON documents.

Plain-text fields (string or null in JSON):
  ``annual_month``, ``ring``, ``keys``, ``facp``, ``testing_procedures``,
  ``inspection_tech_notes``

Monitoring (structured):
  - Linked directory company: ``{"monitoring_company_id": <int>}``
  - Pending new company (proposal selected on location): ``{"monitoring_company_proposal_id": <int>}``
  - Cleared / unknown until set: ``null``

Annual pending (technician proposal for office approval):
  - Same as plain text for ``annual_month`` pending pipeline; canonical ``annual_month``
    on ``MonthlyRouteLocation`` updates only after office approval.

Restore:
  - Set ``restored_from_revision_id`` on the new revision row to the revision whose
    effective value was reapplied.

Actor roles (``MonthlyRouteLocationInspectionRevision.actor_role``):
  ``technician``, ``office``, ``system``, ``import``

Monitoring proposal statuses (``MonitoringCompanyProposal.status``):
  ``pending``, ``approved``, ``rejected``, ``merged``
"""

from __future__ import annotations

from enum import Enum
from typing import Any

ACTOR_ROLES_TECHNICIAN = "technician"
ACTOR_ROLES_OFFICE = "office"
ACTOR_ROLES_SYSTEM = "system"
ACTOR_ROLES_IMPORT = "import"
VALID_ACTOR_ROLES: frozenset[str] = frozenset(
    {ACTOR_ROLES_TECHNICIAN, ACTOR_ROLES_OFFICE, ACTOR_ROLES_SYSTEM, ACTOR_ROLES_IMPORT}
)

MONITORING_PROPOSAL_PENDING = "pending"
MONITORING_PROPOSAL_APPROVED = "approved"
MONITORING_PROPOSAL_REJECTED = "rejected"
MONITORING_PROPOSAL_MERGED = "merged"
VALID_MONITORING_PROPOSAL_STATUSES: frozenset[str] = frozenset(
    {
        MONITORING_PROPOSAL_PENDING,
        MONITORING_PROPOSAL_APPROVED,
        MONITORING_PROPOSAL_REJECTED,
        MONITORING_PROPOSAL_MERGED,
    }
)


class InspectionFieldKey(str, Enum):
    annual_month = "annual_month"
    ring = "ring"
    keys = "keys"
    facp = "facp"
    monitoring_company = "monitoring_company"
    testing_procedures = "testing_procedures"
    inspection_tech_notes = "inspection_tech_notes"


ALL_INSPECTION_FIELD_KEYS: frozenset[str] = frozenset(k.value for k in InspectionFieldKey)


def monitoring_company_value(company_id: int) -> dict[str, Any]:
    return {"monitoring_company_id": int(company_id)}


def monitoring_proposal_value(proposal_id: int) -> dict[str, Any]:
    return {"monitoring_company_proposal_id": int(proposal_id)}


def plain_text_value(text: str | None) -> str | None:
    """Normalize plain-string fields stored as JSON string or null."""
    if text is None:
        return None
    s = str(text).strip()
    return s if s else None
