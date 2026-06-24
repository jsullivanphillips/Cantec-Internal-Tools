"""
Persist ServiceTrade annual schedule cache on monthly_location_month for all routes.

Requires PROCESSING_USERNAME / PROCESSING_PASSWORD.

Env:
  MONTHLY_ANNUAL_SCHEDULE_LOOKBACK — Pacific months through current (default 1 = current only).
  MONTHLY_ANNUAL_SCHEDULE_LOOKAHEAD — Pacific months after current (default 1 = next month).

CLI:
  python -m app.scripts.sync_monthly_route_annual_schedules
  python -m app.scripts.sync_monthly_route_annual_schedules --route-number 5
  python -m app.scripts.sync_monthly_route_annual_schedules --month 2026-06-01
  python -m app.scripts.sync_monthly_route_annual_schedules --lookahead 0
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date, datetime
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv
from sqlalchemy import func

from app import create_app, db
from app.db_models import MonthlyLocation, MonthlyRoute
from app.monthly.service_trade_annual_schedule import (
    build_route_annual_schedule_snapshot,
    persist_route_annual_schedule_snapshot,
)
from app.monthly.service_trade_site_match import SERVICE_TRADE_API_BASE

load_dotenv()

PACIFIC = ZoneInfo("America/Vancouver")


def pacific_month_range(*, lookback: int, lookahead: int) -> list[date]:
    """Oldest-first month-first dates from lookback through current Pacific month + lookahead."""
    if lookback < 1:
        lookback = 1
    if lookahead < 0:
        lookahead = 0

    current = datetime.now(PACIFIC).date().replace(day=1)

    backward: list[date] = []
    cur = current
    for _ in range(lookback):
        backward.append(cur)
        if cur.month == 1:
            cur = date(cur.year - 1, 12, 1)
        else:
            cur = date(cur.year, cur.month - 1, 1)
    backward.reverse()

    forward: list[date] = []
    cur = current
    for _ in range(lookahead):
        if cur.month == 12:
            cur = date(cur.year + 1, 1, 1)
        else:
            cur = date(cur.year, cur.month + 1, 1)
        forward.append(cur)

    return backward + forward


def _active_routes(*, route_number: int | None = None) -> list[MonthlyRoute]:
    count_rows = (
        db.session.query(
            MonthlyLocation.monthly_route_id.label("route_id"),
            func.count(MonthlyLocation.id).label("loc_count"),
        )
        .filter(MonthlyLocation.status_normalized == "active")
        .group_by(MonthlyLocation.monthly_route_id)
        .all()
    )
    active_ids = {
        int(row.route_id)
        for row in count_rows
        if row.route_id is not None and row.loc_count > 0
    }
    if not active_ids:
        return []

    query = MonthlyRoute.query.filter(MonthlyRoute.id.in_(active_ids))
    if route_number is not None:
        query = query.filter(MonthlyRoute.route_number == route_number)
    return query.order_by(MonthlyRoute.route_number.asc()).all()


def _authenticate(http: requests.Session, *, username: str, password: str) -> None:
    resp = http.post(
        f"{SERVICE_TRADE_API_BASE}/auth",
        json={"username": username, "password": password},
    )
    resp.raise_for_status()


def sync_all_route_annual_schedules(
    *,
    month_first_list: list[date],
    route_number: int | None = None,
    max_routes: int | None = None,
) -> int:
    username = os.getenv("PROCESSING_USERNAME")
    password = os.getenv("PROCESSING_PASSWORD")
    if not username or not password:
        raise SystemExit("Missing PROCESSING_USERNAME/PROCESSING_PASSWORD environment vars.")

    app = create_app()
    failures = 0
    with app.app_context():
        routes = _active_routes(route_number=route_number)
        if route_number is not None and not routes:
            raise SystemExit(f"No active MonthlyRoute with route_number={route_number}.")

        http = requests.Session()
        http.headers.setdefault("Accept", "application/json")
        _authenticate(http, username=username, password=password)
        print(f"Authenticated with ServiceTrade ({len(routes)} route(s), {len(month_first_list)} month(s))")

        processed_routes = 0
        for route in routes:
            if max_routes is not None and processed_routes >= max_routes:
                break
            processed_routes += 1
            route_id = int(route.id)

            for month_first in month_first_list:
                label = f"R{route.route_number} {month_first.isoformat()}"
                try:
                    snapshot = build_route_annual_schedule_snapshot(
                        route_id,
                        month_first,
                        username=username,
                        password=password,
                        session=http,
                    )
                    persist_route_annual_schedule_snapshot(route_id, month_first, snapshot)
                except Exception as exc:
                    failures += 1
                    print(f"  FAIL {label}: {exc}", file=sys.stderr)
                    continue

                locations = snapshot.get("locations") or {}
                skip_count = sum(
                    1
                    for row in locations.values()
                    if isinstance(row, dict) and row.get("annual_skip_recommended")
                )
                warning_count = int(snapshot.get("warning_count") or 0)
                print(
                    f"  OK   {label}: {len(locations)} site(s), "
                    f"{skip_count} annual skip, {warning_count} warning(s)"
                )

    return failures


def _parse_month(value: str) -> date:
    raw = value.strip()
    if len(raw) >= 10:
        raw = raw[:10]
    parts = raw.split("-")
    if len(parts) != 3:
        raise argparse.ArgumentTypeError("Use YYYY-MM-01")
    try:
        year, month, day = (int(parts[0]), int(parts[1]), int(parts[2]))
        parsed = date(year, month, day)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Invalid month date") from exc
    if parsed.day != 1:
        raise argparse.ArgumentTypeError("Month must be the first of the month (YYYY-MM-01)")
    return parsed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Sync ServiceTrade annual schedule cache for all active monthly routes.",
    )
    parser.add_argument(
        "--route-number",
        type=int,
        default=None,
        metavar="R",
        help="Sync only this Excel route_number.",
    )
    parser.add_argument(
        "--month",
        type=_parse_month,
        default=None,
        metavar="YYYY-MM-01",
        help="Sync only this Pacific calendar month (overrides lookback/lookahead).",
    )
    parser.add_argument(
        "--lookback",
        type=int,
        default=None,
        metavar="N",
        help="Pacific months through current month (default: env or 1).",
    )
    parser.add_argument(
        "--lookahead",
        type=int,
        default=None,
        metavar="N",
        help="Pacific months after current month (default: env or 1).",
    )
    parser.add_argument(
        "--max-routes",
        type=int,
        default=None,
        metavar="N",
        help="Process at most N routes (debug; order follows route_number).",
    )
    args = parser.parse_args(argv)

    if args.month is not None:
        month_first_list = [args.month]
    else:
        lookback = args.lookback
        if lookback is None:
            lookback = int(os.getenv("MONTHLY_ANNUAL_SCHEDULE_LOOKBACK") or "1")
        lookahead = args.lookahead
        if lookahead is None:
            lookahead = int(os.getenv("MONTHLY_ANNUAL_SCHEDULE_LOOKAHEAD") or "1")
        month_first_list = pacific_month_range(lookback=lookback, lookahead=lookahead)

    print("Months:", ", ".join(m.isoformat() for m in month_first_list))
    failures = sync_all_route_annual_schedules(
        month_first_list=month_first_list,
        route_number=args.route_number,
        max_routes=args.max_routes,
    )
    if failures:
        print(f"Finished with {failures} failure(s).", file=sys.stderr)
        return 1
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
