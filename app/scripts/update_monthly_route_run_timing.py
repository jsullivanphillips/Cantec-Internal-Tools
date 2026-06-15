"""
Upsert MonthlyRouteRunTimingMonth from ServiceTrade testing-job clock events.

Requires PROCESSING_USERNAME / PROCESSING_PASSWORD.

Env:
  MONTHLY_ROUTE_RUN_TIMING_LOOKBACK — Pacific months to refresh (default 24).

CLI:
  python -m app.scripts.update_monthly_route_run_timing --route-number 1
    Refresh only MonthlyRoute.route_number == 1.
"""
from __future__ import annotations

import argparse
import os
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert

from app import create_app, db
from app.db_models import MonthlyLocation, MonthlyRoute, MonthlyRouteRunTimingMonth
from app.monthly.service_trade_route_run_timing import (
    SERVICE_TRADE_API_BASE,
    sync_route_month_timing,
)

load_dotenv()

PACIFIC = ZoneInfo("America/Vancouver")

api_session = requests.Session()
api_session.headers.update({"Accept": "application/json"})


def authenticate(username: str, password: str) -> None:
    auth_url = f"{SERVICE_TRADE_API_BASE}/auth"
    resp = api_session.post(auth_url, json={"username": username, "password": password})
    resp.raise_for_status()
    print("Authenticated with Service Trade")


def pacific_month_starts(lookback: int) -> list[date]:
    """Oldest-first month-first dates covering `lookback` months through current Pacific month."""
    cur = datetime.now(PACIFIC).date().replace(day=1)
    buf: list[date] = []
    for _ in range(lookback):
        buf.append(cur)
        if cur.month == 1:
            cur = date(cur.year - 1, 12, 1)
        else:
            cur = date(cur.year, cur.month - 1, 1)
    return list(reversed(buf))


def _active_routes(*, route_number: int | None = None) -> list[MonthlyRoute]:
    """Routes with at least one active library location."""
    count_rows = (
        db.session.query(
            MonthlyLocation.monthly_route_id.label("route_id"),
            func.count(MonthlyLocation.id).label("loc_count"),
        )
        .filter(MonthlyLocation.status_normalized == "active")
        .group_by(MonthlyLocation.monthly_route_id)
        .all()
    )
    active_ids = {int(row.route_id) for row in count_rows if row.route_id is not None and row.loc_count > 0}
    if not active_ids:
        return []

    query = MonthlyRoute.query.filter(MonthlyRoute.id.in_(active_ids))
    if route_number is not None:
        query = query.filter(MonthlyRoute.route_number == route_number)
    return query.order_by(MonthlyRoute.route_number.asc()).all()


def monthly_route_run_timing(
    *,
    max_routes: int | None = None,
    route_number: int | None = None,
) -> None:
    lookback = int(os.getenv("MONTHLY_ROUTE_RUN_TIMING_LOOKBACK") or "24")
    if lookback < 1:
        lookback = 1

    app = create_app()
    with app.app_context():
        username = os.getenv("PROCESSING_USERNAME")
        password = os.getenv("PROCESSING_PASSWORD")
        if not username or not password:
            raise SystemExit("Missing PROCESSING_USERNAME/PROCESSING_PASSWORD environment vars.")
        authenticate(username, password)

        print("Pacific month lookback:", lookback)

        routes = _active_routes(route_number=route_number)
        if route_number is not None and not routes:
            raise SystemExit(f"No active MonthlyRoute with route_number={route_number}.")

        month_first_list = pacific_month_starts(lookback)
        oldest_month = month_first_list[0]
        now = datetime.now(timezone.utc)

        processed = 0
        for route in routes:
            if max_routes is not None and processed >= max_routes:
                break
            processed += 1

            mr_id = int(route.id)
            st_route_id = route.service_trade_route_location_id
            st_route_id_int = int(st_route_id) if st_route_id is not None else None

            deleted = MonthlyRouteRunTimingMonth.query.filter(
                MonthlyRouteRunTimingMonth.monthly_route_id == mr_id,
                MonthlyRouteRunTimingMonth.month_first < oldest_month,
            ).delete(synchronize_session=False)
            if deleted:
                print(
                    f"  R{route.route_number}: pruned {deleted} run-timing row(s) before "
                    f"{oldest_month.isoformat()}"
                )

            for mf in month_first_list:
                result = sync_route_month_timing(
                    api_session,
                    st_route_id=st_route_id_int,
                    month_first=mf,
                )
                stmt = insert(MonthlyRouteRunTimingMonth).values(
                    monthly_route_id=mr_id,
                    month_first=mf,
                    service_trade_job_id=result.service_trade_job_id,
                    clock_in_at=result.clock_in_at,
                    clock_out_at=result.clock_out_at,
                    duration_minutes=result.duration_minutes,
                    sync_status=result.sync_status,
                    last_updated_at=now,
                )
                stmt = stmt.on_conflict_do_update(
                    constraint="uq_monthly_route_run_timing_month_route_month",
                    set_={
                        "service_trade_job_id": stmt.excluded.service_trade_job_id,
                        "clock_in_at": stmt.excluded.clock_in_at,
                        "clock_out_at": stmt.excluded.clock_out_at,
                        "duration_minutes": stmt.excluded.duration_minutes,
                        "sync_status": stmt.excluded.sync_status,
                        "last_updated_at": stmt.excluded.last_updated_at,
                    },
                )
                db.session.execute(stmt)

            db.session.commit()
            print(
                f"\n------\nR{route.route_number} — run timing months refreshed "
                f"(ST location_id={st_route_id_int}).\n------\n"
            )


def main() -> None:
    parser = argparse.ArgumentParser(description="Update monthly route run timing caches.")
    parser.add_argument(
        "--max-routes",
        type=int,
        default=None,
        metavar="N",
        help="Process at most N routes (debug; order follows route_number).",
    )
    parser.add_argument(
        "--route-number",
        type=int,
        default=None,
        metavar="R",
        help="Sync only this Excel route_number.",
    )
    args = parser.parse_args()
    monthly_route_run_timing(max_routes=args.max_routes, route_number=args.route_number)


if __name__ == "__main__":
    main()
