"""
Print run-timing cache health and probe ServiceTrade for one route/month.

Usage:
  python -m app.scripts.diagnose_monthly_route_run_timing
  python -m app.scripts.diagnose_monthly_route_run_timing --route-number 7
  python -m app.scripts.diagnose_monthly_route_run_timing --route-number 7 --month 2026-05-01
"""
from __future__ import annotations

import argparse
import os
from datetime import date, datetime
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv
from sqlalchemy import func, text

from app import create_app, db
from app.db_models import MonthlyRoute, MonthlyRouteRunTimingMonth
from app.monthly.service_trade_annual_schedule import month_window_pacific
from app.monthly.service_trade_route_run_timing import (
    SERVICE_TRADE_API_BASE,
    fetch_paired_clock_events,
    fetch_scheduled_testing_jobs_route_month,
    fetch_testing_jobs_route_month,
    select_testing_job_for_month,
    sync_route_month_timing,
)

load_dotenv()
PACIFIC = ZoneInfo("America/Vancouver")


def _print_cache_summary() -> None:
    try:
        status_rows = (
            db.session.query(
                MonthlyRouteRunTimingMonth.sync_status,
                func.count(MonthlyRouteRunTimingMonth.id),
            )
            .group_by(MonthlyRouteRunTimingMonth.sync_status)
            .order_by(func.count(MonthlyRouteRunTimingMonth.id).desc())
            .all()
        )
    except Exception as exc:
        print(f"Cache table unavailable ({exc}). Run: flask db upgrade")
        return

    if not status_rows:
        print("Cache table is EMPTY — run: python -m app.scripts.update_monthly_route_run_timing")
        return

    print("Cache sync_status counts:")
    for status, count in status_rows:
        print(f"  {status}: {count}")

    ok_count = sum(c for s, c in status_rows if s == "ok")
    total = sum(c for _, c in status_rows)
    print(f"  => {ok_count}/{total} rows with usable timing (sync_status=ok)")

    routes_with_st = MonthlyRoute.query.filter(
        MonthlyRoute.service_trade_route_location_id.isnot(None)
    ).count()
    routes_without_st = MonthlyRoute.query.filter(
        MonthlyRoute.service_trade_route_location_id.is_(None)
    ).count()
    print(f"Routes with ST link: {routes_with_st}; without: {routes_without_st}")


def _probe_route_month(http: requests.Session, route: MonthlyRoute, month_first: date) -> None:
    st_id = route.service_trade_route_location_id
    print(f"\n--- R{route.route_number} month {month_first.isoformat()} ---")
    print(f"  monthly_route_id={route.id}  ST location_id={st_id}")

    cached = MonthlyRouteRunTimingMonth.query.filter_by(
        monthly_route_id=int(route.id),
        month_first=month_first,
    ).one_or_none()
    if cached is None:
        print("  cache row: MISSING (sync not run for this month?)")
    else:
        print(
            f"  cache row: sync_status={cached.sync_status!r} job_id={cached.service_trade_job_id} "
            f"duration_minutes={cached.duration_minutes}"
        )

    if st_id is None:
        print("  => Fix: set service_trade_route_location_id on this route")
        return

    start_ts, end_ts = month_window_pacific(month_first)
    jobs = fetch_testing_jobs_route_month(
        http,
        int(st_id),
        month_first=month_first,
    )
    print(f"  ST GET /job completed testing at route location: {len(jobs)} job(s)")

    for job in jobs[:5]:
        jid = job.get("id")
        jtype = job.get("type")
        jstatus = job.get("status")
        appts = job.get("appointments") or []
        print(f"    job {jid} type={jtype!r} status={jstatus!r} embedded_appointments={len(appts)}")
        for appt in appts[:3]:
            ws = appt.get("windowStart")
            ws_pacific = (
                datetime.fromtimestamp(int(ws), tz=PACIFIC).isoformat()
                if ws is not None
                else None
            )
            print(
                f"      appt id={appt.get('id')} status={appt.get('status')!r} "
                f"windowStart={ws_pacific}"
            )

    selected = select_testing_job_for_month(jobs, start_ts=start_ts, end_ts=end_ts)
    if selected is None:
        scheduled_jobs = fetch_scheduled_testing_jobs_route_month(
            http,
            int(st_id),
            month_first=month_first,
        )
        print(f"  ST GET /job scheduled testing at route location: {len(scheduled_jobs)} job(s)")
        for job in scheduled_jobs[:5]:
            jid = job.get("id")
            jtype = job.get("type")
            jstatus = job.get("status")
            appts = job.get("appointments") or []
            print(f"    job {jid} type={jtype!r} status={jstatus!r} appointments={len(appts)}")
            for appt in appts[:3]:
                ws = appt.get("windowStart")
                ws_pacific = (
                    datetime.fromtimestamp(int(ws), tz=PACIFIC).isoformat()
                    if ws is not None
                    else None
                )
                print(
                    f"      appt id={appt.get('id')} status={appt.get('status')!r} "
                    f"released={appt.get('released')!r} windowStart={ws_pacific}"
                )
        selected = select_testing_job_for_month(scheduled_jobs, start_ts=start_ts, end_ts=end_ts)

    if selected is None:
        print("  => No testing job with qualifying appointment windowStart in this month.")
        print("     Check: job type is 'testing', appointment status scheduled/completed,")
        print("     windowStart falls in Pacific calendar month (released is not required).")
        # Also probe jobs without type filter
        resp = http.get(
            f"{SERVICE_TRADE_API_BASE}/job",
            params={
                "locationId": int(st_id),
                "scheduleDateFrom": start_ts,
                "scheduleDateTo": end_ts,
                "limit": 20,
            },
        )
        resp.raise_for_status()
        all_jobs = (resp.json().get("data") or {}).get("jobs") or []
        if all_jobs:
            types = sorted({str(j.get("type") or "").lower() for j in all_jobs})
            print(f"     Jobs at this location (any type) in schedule window: {len(all_jobs)}")
            print(f"     Job types seen: {types}")
        else:
            print("     No jobs at all at this ST route location in schedule window.")
        return

    job_id = int(selected["id"])
    pairs = fetch_paired_clock_events(http, job_id)
    onsite = [
        p
        for p in pairs
        if (p.get("start") or {}).get("activity") == "onsite"
        or (p.get("end") or {}).get("activity") == "onsite"
    ]
    print(f"  Selected job {job_id}: {len(pairs)} clock pair(s), {len(onsite)} onsite")
    result = sync_route_month_timing(http, st_route_id=int(st_id), month_first=month_first)
    print(f"  sync result: {result.sync_status!r} duration_minutes={result.duration_minutes}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Diagnose monthly route run timing cache.")
    parser.add_argument("--route-number", type=int, default=None, help="Probe one Excel route number")
    parser.add_argument(
        "--month",
        type=str,
        default=None,
        help="Month to probe as YYYY-MM-01 (default: previous Pacific month)",
    )
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        print("=== Run timing cache summary ===")
        _print_cache_summary()

        if args.route_number is None:
            print("\nTip: python -m app.scripts.diagnose_monthly_route_run_timing --route-number N")
            return

        route = MonthlyRoute.query.filter_by(route_number=args.route_number).one_or_none()
        if route is None:
            raise SystemExit(f"No MonthlyRoute with route_number={args.route_number}")

        if args.month:
            month_first = date.fromisoformat(args.month)
        else:
            cur = datetime.now(PACIFIC).date().replace(day=1)
            if cur.month == 1:
                month_first = date(cur.year - 1, 12, 1)
            else:
                month_first = date(cur.year, cur.month - 1, 1)

        username = os.getenv("PROCESSING_USERNAME")
        password = os.getenv("PROCESSING_PASSWORD")
        if not username or not password:
            raise SystemExit("Set PROCESSING_USERNAME / PROCESSING_PASSWORD to probe ServiceTrade.")

        http = requests.Session()
        http.headers.update({"Accept": "application/json"})
        auth = http.post(
            f"{SERVICE_TRADE_API_BASE}/auth",
            json={"username": username, "password": password},
        )
        auth.raise_for_status()

        _probe_route_month(http, route, month_first)


if __name__ == "__main__":
    main()
