#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

p = Path(__file__).resolve().parent.parent / "tests" / "test_route_run_csv_import.py"
t = p.read_text(encoding="utf-8")
t = t.replace("location_id=loc1", "monthly_location_id=loc1")
t = t.replace("location_id=loc2", "monthly_location_id=loc2")
t = t.replace("location_id=loc_id", "monthly_location_id=loc_id")
t = re.sub(r"from app\.monthly\.monthly_sites_sync import sync_testing_sites_from_legacy\n", "", t)
t = re.sub(r"\s*sync_testing_sites_from_legacy\([^\n]+\)\n", "", t)
t = t.replace("MonthlyTestingSiteMonth", "MonthlyLocationMonth")
t = t.replace("monthly_testing_site_id=", "monthly_location_id=")
t = re.sub(
    r"by_loc: dict\[int, MonthlyLocationMonth\] = \{\}\s*for row in mtsm_rows:[\s\S]*?by_loc\[int\(site\.legacy_monthly_route_location_id\)\] = row",
    "by_loc = {int(row.monthly_location_id): row for row in mtsm_rows}",
    t,
    count=1,
)
t = re.sub(
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
    t,
    count=1,
)
t = re.sub(
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
    t,
    count=1,
)
t = re.sub(
    r"def _seed_route1_ambiguous_testing_site_labels\(\)[\s\S]*?return int\(route\.id\)",
    '''def _seed_route1_ambiguous_testing_site_labels() -> int:
    route = MonthlyRoute(id=1, route_number=1, weekday_iso=0, week_occurrence=1)
    loc1 = make_location(id=301, address="100 Alpha St", label="9838 Second Street", monthly_route_id=1)
    loc2 = make_location(
        id=302,
        address="200 Beta St",
        label="9838 Second Street",
        monthly_route_id=1,
        route_stop_order=1,
    )
    db.session.add_all([route, loc1, loc2])
    db.session.commit()
    return int(route.id)''',
    t,
    count=1,
)
t = t.replace('assert body["testing_site_matches"] == 1', 'assert body["history_upserts"] == 2')
t = t.replace(
    'assert body["stop_month_upserts"] == 1\n    assert body["history_upserts"] == 1',
    'assert body["history_upserts"] == 2',
)
t = t.replace(
    "hist = MonthlyLocationMonth.query.filter_by(\n            monthly_location_id=loc_id",
    "primary_mlm = MonthlyLocationMonth.query.filter_by(\n            monthly_location_id=loc_id",
)
t = t.replace("secondary_mtsm = MonthlyLocationMonth", "secondary_mlm = MonthlyLocationMonth")
t = t.replace("assert hist.", "assert primary_mlm.")
t = t.replace("assert secondary_mtsm.", "assert secondary_mlm.")
t = re.sub(
    r"def test_import_r15_panel_fields_on_v2_testing_site[\s\S]*?assert ts\.panel_location == \"Electrical room\"",
    '''def test_import_r15_panel_fields_on_v2_testing_site(import_client):
    """``PANEL:`` / ``LOCATION:`` in the FACP column map to flat ``panel`` + ``panel_location``."""
    client, app = import_client
    with app.app_context():
        route_id, loc_id = _seed_route15_one_stop()

    res = _post_csv(client, route_id, _build_csv_r15_multiline_site_sheet())
    assert res.status_code == 200, res.get_data(as_text=True)

    with app.app_context():
        loc = db.session.get(MonthlyLocation, loc_id)
        assert loc is not None
        assert loc.facp_detail == "EDWARDS 6500"
        assert loc.panel == "EDWARDS 6500"
        assert loc.panel_location == "Electrical room"''',
    t,
    count=1,
)
t = re.sub(
    r"def _seed_route15_one_stop\(\)[\s\S]*?return int\(route\.id\), int\(loc\.id\)",
    '''def _seed_route15_one_stop() -> tuple[int, int]:
    route = MonthlyRoute(id=15, route_number=15, weekday_iso=3, week_occurrence=1)
    loc = make_location(
        id=1501,
        address="2028 Richmond",
        label="Richmond Medical",
        property_management_company="Brown Bros.",
        property_management_company_normalized="brown bros.",
        monthly_route_id=15,
    )
    db.session.add_all([route, loc])
    db.session.commit()
    return int(route.id), int(loc.id)''',
    t,
    count=1,
)
# session order test simplification
t = re.sub(
    r"ensure_worksheet_stops_for_route_month\(route_id, month_first, run\)\s*ts1 = MonthlyTestingSite\.query[\s\S]*?ts2_id = int\(ts2\.id\)",
    """ensure_worksheet_stops_for_route_month(route_id, month_first, run)
        mtsm1 = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=loc1,
            month_date=month_first,
        ).one()
        mtsm2 = MonthlyLocationMonth.query.filter_by(
            monthly_location_id=loc2,
            month_date=month_first,
        ).one()
        mtsm1.result_status = "tested"
        mtsm1.session_route_stop_order = None
        mtsm2.session_route_stop_order = None
        ts1_id = loc1
        ts2_id = loc2""",
    t,
    count=1,
)
t = re.sub(
    r"db\.session\.add\(\s*MonthlyLocation\(\s*id=899,[\s\S]*?route_stop_order=99,\s*\)\s*\)",
    'db.session.add(make_location(id=899, address="999 Library Only Street", label="999 Library Only Street", property_management_company="Extra", property_management_company_normalized="extra", monthly_route_id=8, route_stop_order=99))',
    t,
    count=1,
)
p.write_text(t, encoding="utf-8")
print("fixed")
