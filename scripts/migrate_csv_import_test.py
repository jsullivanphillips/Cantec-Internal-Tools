#!/usr/bin/env python3
"""Migrate test_route_run_csv_import.py to flat MonthlyLocation model."""

from __future__ import annotations

import re
from pathlib import Path

path = Path(__file__).resolve().parent.parent / "tests" / "test_route_run_csv_import.py"
text = path.read_text(encoding="utf-8")

# imports
text = re.sub(
    r"from app import create_app\nfrom app\.db_models import \([\s\S]*?\)\n",
    "",
    text,
    count=1,
)
insert = '''from app import create_app
from app.db_models import (
    MonthlyLocation,
    MonthlyLocationMonth,
    MonthlyRoute,
    MonthlyRouteRun,
    db,
)
from tests.monthly_location_helpers import WORKSHEET_TABLES, make_location

'''
text = text.replace("import pytest\n\n", f"import pytest\n\n{insert}")

# fixture
text = re.sub(
    r"with app\.app_context\(\):\s*db\.metadata\.create_all\([\s\S]*?tables=\[[\s\S]*?\]\s*\)\s*with app\.test_client",
    "with app.app_context():\n        db.metadata.create_all(db.engine, tables=WORKSHEET_TABLES)\n        with app.test_client",
    text,
    count=1,
)
text = re.sub(
    r"db\.session\.remove\(\)\s*db\.metadata\.drop_all\([\s\S]*?\)\s*\)",
    "db.session.remove()\n        db.metadata.drop_all(db.engine, tables=list(reversed(WORKSHEET_TABLES)))",
    text,
    count=1,
)

# seed route8
text = re.sub(
    r"def _seed_route8_with_two_stops\(\)[\s\S]*?return int\(route\.id\), int\(loc1\.id\), int\(loc2\.id\)",
    '''def _seed_route8_with_two_stops() -> tuple[int, int, int]:
    route = MonthlyRoute(id=8, route_number=8, weekday_iso=3, week_occurrence=1)
    loc1 = make_location(
        id=801,
        address="800 Johnson Street",
        label="TDMC Holdings",
        property_management_company="Invermay",
        property_management_company_normalized="invermay",
        monthly_route_id=8,
        annual_month="July",
    )
    loc2 = make_location(
        id=802,
        address="1461 Blanshard Street",
        label="Congregation Emanu-El",
        property_management_company="Singleton Maintenance Solutions",
        property_management_company_normalized="singleton maintenance solutions",
        monthly_route_id=8,
        annual_month="January",
    )
    db.session.add_all([route, loc1, loc2])
    db.session.commit()
    return int(route.id), int(loc1.id), int(loc2.id)''',
    text,
    count=1,
)

replacements = [
    (r"MonthlyRouteLocation\b", "MonthlyLocation"),
    (r"MonthlyRouteTestHistory\b", "MonthlyLocationMonth"),
    (r"MonthlyTestingSiteMonth\b", "MonthlyLocationMonth"),
    (r"MonthlyTestingSite\b", "MonthlyLocation"),
    (r"MonthlySite\b", "MonthlyLocation"),
    (r"MonthlyRouteRunFieldSubmission\b", ""),
    (r"MonthlyTestingSiteDeficiency\b", "MonthlyLocationDeficiency"),
    (r"from app\.monthly\.monthly_sites_sync import sync_testing_sites_from_legacy\n", ""),
    (r"^\s*sync_testing_sites_from_legacy\([^\n]+\)\n", "", re.MULTILINE),
    (r"from app\.monthly\.worksheet_stops import", "from app.monthly.worksheet_locations import"),
    (r"MonthlyLocationMonth\.query\.filter_by\(\s*location_id=", "MonthlyLocationMonth.query.filter_by(monthly_location_id="),
    (r"MonthlyLocationMonth\(\s*\n\s*id=([^,]+),\s*\n\s*location_id=", r"MonthlyLocationMonth(\n                id=\1,\n                monthly_location_id="),
    (r"building=", "label="),
    (r"building_normalized=", "label_normalized="),
    (r"db\.session\.get\(MonthlyLocationMonth, (\d+)\)", r"db.session.get(MonthlyLocationMonth, \1)"),
]

for item in replacements:
    if len(item) == 3:
        pat, rep, flags = item
        text = re.sub(pat, rep, text, flags=flags)
    else:
        pat, rep = item
        text = re.sub(pat, rep, text)

# session order test: use loc ids directly
text = re.sub(
    r"ensure_worksheet_stops_for_route_month\(route_id, month_first, run\)\s*ts1 = MonthlyLocation\.query\.filter_by\(id=MonthlyLocation\.query\.filter_by\(\s*legacy_monthly_route_location_id=loc1\s*\)\.one\(\)\.id\)\.one\(\)\s*ts2 = MonthlyLocation\.query\.filter_by\(id=MonthlyLocation\.query\.filter_by\(\s*legacy_monthly_route_location_id=loc2\s*\)\.one\(\)\.id\)\.one\(\)\s*mtsm1 = MonthlyLocationMonth\.query\.filter_by\(\s*monthly_location_id=int\(ts1\.id\)",
    "ensure_worksheet_stops_for_route_month(route_id, month_first, run)\n        mtsm1 = MonthlyLocationMonth.query.filter_by(\n            monthly_location_id=loc1",
    text,
)
text = re.sub(
    r"mtsm2 = MonthlyLocationMonth\.query\.filter_by\(\s*monthly_location_id=int\(ts2\.id\)",
    "mtsm2 = MonthlyLocationMonth.query.filter_by(\n            monthly_location_id=loc2",
    text,
)
text = re.sub(r"ts1_id = int\(ts1\.id\)\s*ts2_id = int\(ts2\.id\)", "ts1_id = loc1\n        ts2_id = loc2", text)
text = re.sub(
    r"mtsm1 = MonthlyLocationMonth\.query\.filter_by\(\s*monthly_location_id=ts1_id",
    "mtsm1 = MonthlyLocationMonth.query.filter_by(\n            monthly_location_id=loc1",
    text,
)
text = re.sub(
    r"mtsm2 = MonthlyLocationMonth\.query\.filter_by\(\s*monthly_location_id=ts2_id",
    "mtsm2 = MonthlyLocationMonth.query.filter_by(\n            monthly_location_id=loc2",
    text,
)

# csv import prepared test
text = re.sub(
    r"for row in mtsm_rows:\s*ts = db\.session\.get\(MonthlyLocation, int\(row\.monthly_location_id\)\)\s*site = db\.session\.get\(MonthlyLocation, int\(ts\.monthly_site_id\)\)\s*by_loc\[int\(site\.legacy_monthly_route_location_id\)\] = row",
    "by_loc = {int(row.monthly_location_id): row for row in mtsm_rows}",
    text,
)

# dual address seed
text = re.sub(
    r"def _seed_route1_dual_address_billing\(\)[\s\S]*?return int\(route\.id\), int\(loc\.id\), int\(ts_primary\.id\), int\(ts_secondary\.id\)",
    '''def _seed_route1_dual_address_billing() -> tuple[int, int, int, int]:
    route = MonthlyRoute(id=1, route_number=1, weekday_iso=0, week_occurrence=1)
    loc_primary = make_location(
        id=101,
        address="2471 Sidney Ave",
        label="Main",
        property_management_company="Example PMC",
        property_management_company_normalized="example pmc",
        monthly_route_id=1,
    )
    loc_secondary = make_location(
        id=102,
        address="9838 Second Street",
        label="9838 Second Street",
        property_management_company="Example PMC",
        property_management_company_normalized="example pmc",
        monthly_route_id=1,
        route_stop_order=1,
    )
    db.session.add_all([route, loc_primary, loc_secondary])
    db.session.commit()
    return int(route.id), int(loc_primary.id), int(loc_primary.id), int(loc_secondary.id)''',
    text,
    count=1,
)

text = re.sub(
    r"def _seed_route2_with_off_route_testing_site_label\(\)[\s\S]*?return int\(route1\.id\), int\(route2\.id\)",
    '''def _seed_route2_with_off_route_testing_site_label() -> tuple[int, int]:
    route1 = MonthlyRoute(id=1, route_number=1, weekday_iso=0, week_occurrence=1)
    route2 = MonthlyRoute(id=2, route_number=2, weekday_iso=1, week_occurrence=1)
    loc_on_r2 = make_location(
        id=201,
        address="2471 Sidney Ave",
        label="9838 Second Street",
        monthly_route_id=2,
    )
    db.session.add_all([route1, route2, loc_on_r2])
    db.session.commit()
    return int(route1.id), int(route2.id)''',
    text,
    count=1,
)

text = re.sub(
    r"def _seed_route1_ambiguous_testing_site_labels\(\)[\s\S]*?return int\(route\.id\)",
    '''def _seed_route1_ambiguous_testing_site_labels() -> int:
    route = MonthlyRoute(id=1, route_number=1, weekday_iso=0, week_occurrence=1)
    loc1 = make_location(id=301, address="100 Alpha St", label="9838 Second Street", monthly_route_id=1)
    loc2 = make_location(id=302, address="200 Beta St", label="9838 Second Street", monthly_route_id=1, route_stop_order=1)
    db.session.add_all([route, loc1, loc2])
    db.session.commit()
    return int(route.id)''',
    text,
    count=1,
)

# dual address test expectations
text = text.replace('assert body["testing_site_matches"] == 1', 'assert body["history_upserts"] == 2')
text = text.replace('assert body["stop_month_upserts"] == 1\n    assert body["history_upserts"] == 1', 'assert body["history_upserts"] == 2')
text = re.sub(
    r"hist = MonthlyLocationMonth\.query\.filter_by\(\s*monthly_location_id=loc_id",
    "primary_mlm = MonthlyLocationMonth.query.filter_by(\n            monthly_location_id=loc_id",
    text,
    count=1,
)
text = text.replace(
    "secondary_mtsm = MonthlyLocationMonth.query.filter_by(\n            monthly_location_id=secondary_ts_id",
    "secondary_mlm = MonthlyLocationMonth.query.filter_by(\n            monthly_location_id=secondary_ts_id",
)
text = text.replace("assert hist.result_status", "assert primary_mlm.result_status")
text = text.replace("assert hist.key_number", "assert primary_mlm.key_number")
text = text.replace("assert hist.facp", "assert primary_mlm.facp")
text = text.replace("assert secondary_mtsm.", "assert secondary_mlm.")

# r15 panel test
text = re.sub(
    r"from app\.db_models import MonthlyLocation, MonthlyLocation\n",
    "",
    text,
)
text = re.sub(
    r"with app\.app_context\(\):\s*db\.metadata\.create_all\([\s\S]*?tables=\[MonthlyLocation\.__table__, MonthlyLocation\.__table__\],\s*\)\s*route_id, loc_id = _seed_route15_one_stop\(\)",
    "with app.app_context():\n        route_id, loc_id = _seed_route15_one_stop()",
    text,
    count=1,
)
text = re.sub(
    r"site = MonthlyLocation\.query\.filter_by\(id=loc_id\)\.one\(\)\s*ts = MonthlyLocation\.query\.filter_by\(id=int\(site\.id\)\)\.one\(\)\s*assert ts\.panel",
    "loc = db.session.get(MonthlyLocation, loc_id)\n        assert loc is not None\n        assert loc.panel",
    text,
)

text = re.sub(r",\s*\n\s*\)", "\n)", text)
path.write_text(text, encoding="utf-8")
print("migrated test_route_run_csv_import.py")
