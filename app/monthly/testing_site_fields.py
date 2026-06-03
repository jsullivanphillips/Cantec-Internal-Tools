"""Canonical per-testing-site field keys (library + run snapshots).

Used by API serialization and future CSV import mapping. Legacy worksheet rows
(``MonthlyRouteTestHistory`` per location) remain until the technician UI cutover.
"""

from __future__ import annotations

# Library / master row (``MonthlyTestingSite``)
LIBRARY_STRING_FIELDS = (
    "annual_month",
    "property_management_company",
    "building_name",
    "panel_location",
    "door_code",
    "ring_detail",
    "keys",
    "barcode",
    "label",
    "monitoring_account_number",
)

LIBRARY_TEXT_FIELDS = (
    "panel",
    "facp_detail",  # legacy alias; prefer ``panel`` for new writes
    "testing_procedures",
    "inspection_tech_notes",
    "monitoring_notes",
)

# Run-month snapshot (``MonthlyTestingSiteMonth``) — route CSV import maps sheet
# columns onto these keys via ``upsert_stop_month_from_csv_import``.
SNAPSHOT_STRING_FIELDS = (
    "annual_month",
    "property_management_company",
    "building_name",
    "panel_location",
    "door_code",
    "ring",
    "key_number",
    "monitoring_account_number",
)

SNAPSHOT_TEXT_FIELDS = (
    "panel",
    "facp",  # legacy alias; prefer ``panel`` for new writes
    "testing_procedures",
    "inspection_tech_notes",
    "monitoring_notes",
)
