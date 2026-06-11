#!/usr/bin/env python3
"""Careful test migration: legacy models -> flat MonthlyLocation."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / "tests"

IMPORT_BLOCK = '''
from app.db_models import (
    Key,
    MonitoringCompany,
    MonthlyLocation,
    MonthlyLocationComment,
    MonthlyLocationDeficiency,
    MonthlyLocationMonth,
    MonthlyRoute,
    MonthlyRouteComment,
    MonthlyRouteRun,
    MonthlyRouteWorksheetAuditEvent,
    MonthlyStopClockEvent,
    db,
)
from tests.monthly_location_helpers import (
    WORKSHEET_TABLES,
    make_location,
    make_location_month,
    seed_route_with_one_stop,
    seed_route_with_two_stops,
)
'''

REPLACEMENTS: list[tuple[str, str]] = [
    (r"from app\.monthly\.monthly_sites_sync import sync_testing_sites_from_legacy\n", ""),
    (r"^\s*sync_testing_sites_from_legacy\([^\n]+\)\n", "", re.MULTILINE),
    (r"from app\.monthly\.worksheet_stops import", "from app.monthly.worksheet_locations import"),
    (r"MonthlyRouteLocationComment", "MonthlyLocationComment"),
    (r"MonthlyRouteLocation\b", "MonthlyLocation"),
    (r"MonthlyRouteTestHistory\b", "MonthlyLocationMonth"),
    (r"MonthlyTestingSiteMonth\b", "MonthlyLocationMonth"),
    (r"MonthlyTestingSiteDeficiency\b", "MonthlyLocationDeficiency"),
    (r"MonthlyTestingSite\b", "MonthlyLocation"),
    (r"MonthlySite\b", "MonthlyLocation"),
    (r"MonthlyRouteRunFieldSubmission\b", ""),
    (r"monthly_testing_site_month_id", "monthly_location_month_id"),
    (r"monthly_testing_site_id", "monthly_location_id"),
    (r"/api/monthly_sites/testing_sites/", "/api/monthly_routes/library/"),
    (r"/api/monthly_sites/library", "/api/monthly_routes/library"),
    (r"building_normalized=", "label_normalized="),
    (r"\bbuilding=", "label="),
    (r"MonthlyLocationMonth\(\s*\n\s*id=([^,]+),\s*\n\s*location_id=", r"MonthlyLocationMonth(\n                id=\1,\n                monthly_location_id="),
    (r"MonthlyLocationMonth\(\s*id=([^,]+),\s*location_id=", r"MonthlyLocationMonth(id=\1, monthly_location_id="),
    (r"MonthlyLocationDeficiency\(\s*\n\s*id=([^,]+),\s*\n\s*monthly_location_id=", r"MonthlyLocationDeficiency(\n                id=\1,\n                monthly_location_id="),
    (r"MonthlyLocationMonth\.query\.filter_by\(\s*location_id=", "MonthlyLocationMonth.query.filter_by(\n                monthly_location_id="),
    (r"MonthlyLocationMonth\.query\.filter_by\(location_id=", "MonthlyLocationMonth.query.filter_by(monthly_location_id="),
    (r"db\.session\.get\(MonthlyLocationMonth, (\d+)\)", r"db.session.get(MonthlyLocationMonth, \1)"),
    (r"serialize_worksheet_stop\(\s*\n?\s*[^,\n]+,\s*\n?\s*[^,\n]+,\s*", "serialize_worksheet_location(\n            loc,\n            "),
    (r"serialize_worksheet_stop\([^,]+,\s*[^,]+,\s*", "serialize_worksheet_location(loc, "),
    (r"MonthlyLocation\.query\.filter_by\(monthly_site_id=", "MonthlyLocation.query.filter_by(id="),
    (r"MonthlyLocation\.query\.filter_by\(legacy_monthly_route_location_id=", "MonthlyLocation.query.filter_by(id="),
    (r"MonthlyLocation\.query\.join\(MonthlyLocation\)", "MonthlyLocation.query"),
    (r"\.join\(MonthlyLocation\)\s*\n\s*\.filter\(MonthlyLocation\.legacy_monthly_route_location_id", ".filter(MonthlyLocation.id"),
    (r"MonthlyLocation\.legacy_monthly_route_location_id", "MonthlyLocation.id"),
    (r"int\(site\.legacy_monthly_route_location_id\)", "int(loc.id)"),
    (r"int\(site\.id\)", "int(loc.id)"),
    (r"hist\b", "mlm"),
    (r"_hist\b", "_mlm"),
    (r"MonthlyLocationMonth, hist,", "MonthlyLocationMonth, mlm,"),
    (r"return route, loc, hist, run", "return route, loc, mlm, run"),
    (r"return route, loc, hist", "return route, loc, mlm"),
    (r"_, _, hist,", "_, _, mlm,"),
    (r"_, _, hist\b", "_, _, mlm"),
    (r"hist1", "mlm1"),
    (r"hist2", "mlm2"),
    (r"h_clear", "mlm_clear"),
    (r"h_annual", "mlm_annual"),
    (r"hist_a", "mlm_a"),
    (r"hist_b", "mlm_b"),
    (r"cleared = db\.session\.get\(MonthlyLocationMonth", "cleared = db.session.get(MonthlyLocationMonth"),
]

TABLES_PATTERNS = [
    (r"tables = \[[\s\S]*?\]", "tables = WORKSHEET_TABLES"),
    (r"worksheet_tables = \[[\s\S]*?\]", "worksheet_tables = WORKSHEET_TABLES + [\n        MonthlyLocationComment.__table__,\n    ]"),
    (r"hybrid_tables = \[[\s\S]*?\]", "hybrid_tables = WORKSHEET_TABLES"),
    (r"portal_tables = \[[\s\S]*?\]", "portal_tables = WORKSHEET_TABLES"),
]

FILES = [
    "test_monthly_run_details_api.py",
    "test_worksheet_stops_api.py",
    "test_monthly_worksheet_api.py",
    "test_route_run_csv_import.py",
]


def strip_legacy_imports(content: str) -> str:
    content = re.sub(
        r"from app\.db_models import \([\s\S]*?\)\n",
        "",
        content,
        count=1,
    )
    content = re.sub(r"from app\.monthly\.monthly_sites_sync import[^\n]+\n", "", content)
    return content


def migrate_file(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    text = strip_legacy_imports(text)
    for item in REPLACEMENTS:
        if len(item) == 3:
            pattern, repl, flags = item
            text = re.sub(pattern, repl, text, flags=flags)
        else:
            pattern, repl = item
            text = re.sub(pattern, repl, text)

    for pattern, repl in TABLES_PATTERNS:
        text = re.sub(pattern, repl, text, count=1)

    if "from tests.monthly_location_helpers import" not in text:
        anchor = "import pytest\n"
        if anchor in text:
            idx = text.index(anchor) + len(anchor)
            text = text[:idx] + IMPORT_BLOCK + text[idx:]

    # cleanup empty import commas
    text = re.sub(r",\s*\n\s*\)", "\n)", text)
    text = re.sub(r"\(\s*,", "(", text)

    path.write_text(text, encoding="utf-8")
    print(f"migrated {path.name}")


def main() -> int:
    for name in FILES:
        p = TESTS / name
        if p.exists():
            migrate_file(p)
    return 0


if __name__ == "__main__":
    sys.exit(main())
