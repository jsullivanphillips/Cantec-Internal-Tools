#!/usr/bin/env python3
"""Second-pass fixes for flat-location test migrations."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "tests"

RUNS_BY_MONTH = '''def test_runs_by_month_includes_worksheet_stop_counts(run_details_client):
    """Route detail runs_by_month includes tested/total stop counts at worksheet grain."""
    client, app = run_details_client
    with app.app_context():
        route = MonthlyRoute(id=1, route_number=2, weekday_iso=0, week_occurrence=1)
        loc_primary = make_location(
            id=101,
            address="123 Test St",
            label="123 Test St",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            monthly_route_id=1,
            route_stop_order=0,
            annual_month="May",
        )
        loc_annex = make_location(
            id=88002,
            address="123 Test St",
            label="Annex panel",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            monthly_route_id=1,
            route_stop_order=1,
        )
        loc_pending = make_location(
            id=88003,
            address="123 Test St",
            label="Garage panel",
            property_management_company="Acme",
            property_management_company_normalized="acme",
            monthly_route_id=1,
            route_stop_order=2,
        )
        run = MonthlyRouteRun(
            id=9001,
            monthly_route_id=1,
            month_date=date(2026, 5, 1),
            started_at=datetime(2026, 5, 2, 8, 0, tzinfo=PACIFIC_TZ),
            status="open",
            source="technician_app",
        )
        db.session.add_all([route, loc_primary, loc_annex, loc_pending, run])
        db.session.add_all(
            [
                MonthlyLocationMonth(
                    id=92001,
                    monthly_location_id=101,
                    month_date=date(2026, 5, 1),
                    test_monthly_route_id=1,
                    run_id=9001,
                    test_outcome="all_good",
                ),
                MonthlyLocationMonth(
                    id=92002,
                    monthly_location_id=88002,
                    month_date=date(2026, 5, 1),
                    test_monthly_route_id=1,
                    run_id=9001,
                    result_status="skipped",
                    skip_reason="annual_booked",
                ),
                MonthlyLocationMonth(
                    id=92003,
                    monthly_location_id=88003,
                    month_date=date(2026, 5, 1),
                    test_monthly_route_id=1,
                    run_id=9001,
                ),
            ]
        )
        db.session.commit()

        from app.monthly.run_details_review import run_month_worksheet_stop_counts
        from app.routes.monthly_routes import _runs_by_month_for_route

        counts = run_month_worksheet_stop_counts(1, date(2026, 5, 1))
        assert counts == {"stops_on_route_count": 3, "stops_tested_count": 1}

        run_row = _runs_by_month_for_route(1)["2026-05-01"]
        assert run_row["stops_on_route_count"] == 3
        assert run_row["stops_tested_count"] == 1
        assert run_row["workflow_stage_label"] == "Field in progress"
'''

SEED_TWO_STOPS = '''def _seed_route_with_two_stops() -> tuple[int, int, int]:
    """Route 1 with two flat library locations."""
    route_id, primary_id, secondary_id = seed_route_with_two_stops()
    return route_id, primary_id, secondary_id
'''


def fix_run_details(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    text = re.sub(
        r"def test_runs_by_month_includes_worksheet_stop_counts[\s\S]*?assert run_row\[\"workflow_stage_label\"\] == \"Field in progress\"",
        RUNS_BY_MONTH.strip(),
        text,
        count=1,
    )
    text = text.replace('stops = res.get_json()["locations"][0]["stops"]\n    assert len(stops) >= 1\n    stop = stops[0]',
                        'stop = res.get_json()["locations"][0]')
    text = text.replace('details.get_json()["locations"][0]["stops"][0]',
                        'details.get_json()["locations"][0]')
    text = text.replace('res.get_json()["locations"][0]["stops"][0]',
                        'res.get_json()["locations"][0]')
    text = re.sub(
        r"\s*ts_rows = sync_testing_sites_from_legacy\(loc\)\s*\n\s*ts_id = int\(ts_rows\[0\]\.id\)",
        "\n        ts_id = int(loc.id)",
        text,
    )
    text = re.sub(
        r"\s*sync_testing_sites_from_legacy\(loc\)\s*\n",
        "\n",
        text,
    )
    text = re.sub(
        r"ts_id = int\(MonthlyLocation\.query\.one\(\)\.id\)",
        "ts_id = 101",
        text,
    )
    text = re.sub(
        r"ts = MonthlyLocation\.query\.one\(\)\s*\n\s*ts\.door_code",
        "loc = db.session.get(MonthlyLocation, 101)\n        assert loc is not None\n        loc.door_code",
        text,
    )
    path.write_text(text, encoding="utf-8")
    print(f"fixed {path.name}")


def fix_worksheet_stops(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    text = re.sub(
        r"def _seed_route_with_two_stops\(\)[\s\S]*?return 1, int\(ts_primary\.id\), int\(ts_second\.id\)",
        SEED_TWO_STOPS.strip(),
        text,
        count=1,
    )
    text = text.replace('body["locations"][0]["stops"]', 'body["locations"]')
    text = re.sub(r"monthly_site_id=int\([^)]+\),\s*\n\s*sort_order=\d+,\s*\n", "", text)
    text = re.sub(r"\.order_by\(MonthlyLocation\.sort_order\.asc\(\), MonthlyLocation\.id\.asc\(\)\)", "", text)
    path.write_text(text, encoding="utf-8")
    print(f"fixed {path.name}")


def fix_worksheet_api(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    text = re.sub(
        r"\s*sync_testing_sites_from_legacy\(loc_a\)\s*\n\s*sync_testing_sites_from_legacy\(loc_b\)\s*\n\s*ts_a = \([\s\S]*?\)\s*\n\s*ts_b = \([\s\S]*?\)\s*\n",
        "",
        text,
    )
    text = re.sub(
        r"MonthlyLocationMonth\(\s*\n\s*id=5201,\s*\n\s*monthly_location_id=int\(ts_a\.id\)",
        "MonthlyLocationMonth(\n                    id=5201,\n                    monthly_location_id=101",
        text,
    )
    text = re.sub(
        r"MonthlyLocationMonth\(\s*\n\s*id=5202,\s*\n\s*monthly_location_id=int\(ts_b\.id\)",
        "MonthlyLocationMonth(\n                    id=5202,\n                    monthly_location_id=102",
        text,
    )
    text = re.sub(
        r"sync_testing_sites_from_legacy\(loc\)\s*\n\s*ts = \([\s\S]*?\)\s*\n\s*\.first\(\)\s*\n\s*mtsm = MonthlyLocationMonth\(",
        "ts_id = 101\n        mtsm = MonthlyLocationMonth(",
        text,
        count=1,
    )
    text = text.replace("monthly_location_id=int(ts.id)", "monthly_location_id=ts_id")
    path.write_text(text, encoding="utf-8")
    print(f"fixed {path.name}")


def main() -> None:
    fix_run_details(ROOT / "test_monthly_run_details_api.py")
    fix_worksheet_stops(ROOT / "test_worksheet_stops_api.py")
    fix_worksheet_api(ROOT / "test_monthly_worksheet_api.py")


if __name__ == "__main__":
    main()
