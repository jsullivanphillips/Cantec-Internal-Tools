"""
Upsert MonthlyRouteSnapshot (last 100 completed jobs per route) and
MonthlyRouteSpecialistMonth (Pacific calendar months, paginated completed jobs).

Requires PROCESSING_USERNAME / PROCESSING_PASSWORD.

Env:
  MONTHLY_SPECIALIST_MONTH_LOOKBACK — number of Pacific months to refresh (default 24).
"""
from __future__ import annotations

import argparse
import os
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import requests
from dotenv import load_dotenv
from sqlalchemy.dialects.postgresql import insert

from app import create_app, db
from app.db_models import MonthlyRoute, MonthlyRouteSnapshot, MonthlyRouteSpecialistMonth
from app.routes.scheduling_attack import get_active_techs, parse_dt

load_dotenv()

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
PACIFIC = ZoneInfo("America/Vancouver")
JOB_PAGE_LIMIT = 100

api_session = requests.Session()
api_session.headers.update({"Accept": "application/json"})


def authenticate(username: str, password: str) -> None:
    auth_url = f"{SERVICE_TRADE_API_BASE}/auth"
    resp = api_session.post(auth_url, json={"username": username, "password": password})
    resp.raise_for_status()
    print("Authenticated with Service Trade")


def safe_str(v: object) -> str:
    return (v or "").strip()


def _norm_name(s: str) -> str:
    return " ".join((s or "").strip().split()).casefold()


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


def job_route_test_date_pacific(job: dict[str, Any]) -> date | None:
    """
    Latest calendar day (Pacific) for this job from ServiceTrade:
    non–Office Clerical appointment window / actual start, else job completion fields.
    """
    candidates: list[datetime] = []
    for appt in job.get("appointments", []) or []:
        sl = (appt.get("serviceLine") or {})
        if (sl.get("name") or "").strip().lower() == "office clerical":
            continue
        for key in ("windowEnd", "windowStart", "actualStart"):
            dt = parse_dt(appt.get(key))
            if dt:
                candidates.append(dt)
    if not candidates:
        for key in ("completedOn", "completed", "completedDate"):
            dt = parse_dt(job.get(key))
            if dt:
                candidates.append(dt)
                break
    if not candidates:
        return None
    return max(candidates).astimezone(PACIFIC).date()


def completed_on_range_unix(month_first: date) -> tuple[int, int]:
    start = datetime(month_first.year, month_first.month, month_first.day, 0, 0, 0, tzinfo=PACIFIC)
    if month_first.month == 12:
        end_exclusive = datetime(month_first.year + 1, 1, 1, 0, 0, 0, tzinfo=PACIFIC)
    else:
        end_exclusive = datetime(month_first.year, month_first.month + 1, 1, 0, 0, 0, tzinfo=PACIFIC)
    return int(start.timestamp()), int(end_exclusive.timestamp()) - 1


def tech_increment_names_for_job(job: dict[str, Any], active_name_set: set[str]) -> list[str]:
    """
    Display names to attribute for this job (may repeat), mirroring legacy snapshot logic:
    single appointment → techs on it; multiple → per non–Office Clerical service request × techs.
    """
    names: list[str] = []
    appointments = job.get("appointments", []) or []
    if not appointments:
        return names

    if len(appointments) == 1:
        for tech in appointments[0].get("techs", []) or []:
            name = safe_str(tech.get("name"))
            if not name or _norm_name(name) not in active_name_set:
                continue
            names.append(name)
        return names

    appointment_ids = [str(a.get("id")) for a in appointments if a.get("id")]
    for i, appt_id in enumerate(appointment_ids):
        techs = (appointments[i].get("techs", []) or []) if i < len(appointments) else []

        appt_response = api_session.get(f"{SERVICE_TRADE_API_BASE}/appointment/{appt_id}")
        appt_response.raise_for_status()
        appt_data = appt_response.json().get("data", {}) or {}

        service_requests = appt_data.get("serviceRequests", []) or []
        for sr in service_requests:
            service_line = sr.get("serviceLine") or {}
            service_line_name = safe_str(service_line.get("name"))

            if service_line_name == "Office Clerical":
                continue

            for tech in techs:
                name = safe_str(tech.get("name"))
                if not name or _norm_name(name) not in active_name_set:
                    continue
                names.append(name)

    return names


def apply_job_to_counts(job: dict[str, Any], tech_counts: dict[str, int], active_name_set: set[str]) -> None:
    for name in tech_increment_names_for_job(job, active_name_set):
        tech_counts[name] = tech_counts.get(name, 0) + 1


def fetch_completed_jobs_route_month(st_route_id: int, begin_ts: int, end_ts: int) -> list[dict[str, Any]]:
    """Paginated GET /job for one route location and completed-on window."""
    all_jobs: list[dict[str, Any]] = []
    page = 1
    while True:
        params: dict[str, Any] = {
            "locationId": st_route_id,
            "status": "completed",
            "completedOnBegin": begin_ts,
            "completedOnEnd": end_ts,
            "limit": JOB_PAGE_LIMIT,
            "page": page,
        }
        response = api_session.get(f"{SERVICE_TRADE_API_BASE}/job", params=params)
        response.raise_for_status()
        data = response.json().get("data", {}) or {}
        jobs = data.get("jobs", []) or []
        all_jobs.extend(jobs)
        total_pages = int(data.get("totalPages") or 1)
        if page >= total_pages:
            break
        page += 1
    return all_jobs


def monthly_specialists(*, max_routes: int | None = None) -> None:
    MONTHLY_COMPANY_ID = 5004069
    lookback = int(os.getenv("MONTHLY_SPECIALIST_MONTH_LOOKBACK") or "24")
    if lookback < 1:
        lookback = 1

    app = create_app()
    with app.app_context():
        username = os.getenv("PROCESSING_USERNAME")
        password = os.getenv("PROCESSING_PASSWORD")
        if not username or not password:
            raise SystemExit("Missing PROCESSING_USERNAME/PROCESSING_PASSWORD environment vars.")
        authenticate(username, password)

        active_techs = get_active_techs() or []
        active_name_set = {
            _norm_name(t.get("name"))
            for t in active_techs
            if str(t.get("status", "")).lower() == "active"
            and t.get("isTech") is True
            and safe_str(t.get("name"))
        }

        print("Active techs:", len(active_name_set))
        print("Pacific month lookback:", lookback)

        params = {"companyId": MONTHLY_COMPANY_ID, "limit": 1000, "status": "active"}
        response = api_session.get(f"{SERVICE_TRADE_API_BASE}/location", params=params)
        response.raise_for_status()
        data = response.json().get("data", {}) or {}

        route_locations: dict[int, str] = {}
        for loc in data.get("locations", []) or []:
            loc_id = loc.get("id")
            loc_name = loc.get("name")
            if loc_id:
                route_locations[int(loc_id)] = safe_str(loc_name) or f"Location {loc_id}"

        print("Number of monthly routes:", len(route_locations))

        month_first_list = pacific_month_starts(lookback)
        oldest_month = month_first_list[0]

        processed = 0
        for route_id, route_name in route_locations.items():
            if max_routes is not None and processed >= max_routes:
                break
            processed += 1

            tech_counts: dict[str, int] = {}

            snap_params = {"locationId": route_id, "status": "completed", "limit": 100}
            snap_resp = api_session.get(f"{SERVICE_TRADE_API_BASE}/job", params=snap_params)
            snap_resp.raise_for_status()
            jobs_snapshot = (snap_resp.json().get("data", {}) or {}).get("jobs", []) or []

            for job in jobs_snapshot:
                apply_job_to_counts(job, tech_counts, active_name_set)

            top_5 = [
                {"tech_name": tech_name, "jobs": count}
                for tech_name, count in sorted(tech_counts.items(), key=lambda x: x[1], reverse=True)[:5]
            ]

            now = datetime.now(timezone.utc)

            stmt_snap = insert(MonthlyRouteSnapshot).values(
                location_id=route_id,
                location_name=route_name,
                completed_jobs_count=len(jobs_snapshot),
                top_technicians=top_5,
                last_updated_at=now,
            )
            stmt_snap = stmt_snap.on_conflict_do_update(
                index_elements=["location_id"],
                set_={
                    "location_name": stmt_snap.excluded.location_name,
                    "completed_jobs_count": stmt_snap.excluded.completed_jobs_count,
                    "top_technicians": stmt_snap.excluded.top_technicians,
                    "last_updated_at": stmt_snap.excluded.last_updated_at,
                },
            )
            db.session.execute(stmt_snap)

            mr_row = MonthlyRoute.query.filter_by(service_trade_route_location_id=route_id).one_or_none()
            if mr_row is None:
                db.session.commit()
                print(
                    f"\n------\n{route_name} — snapshot OK; "
                    f"skipped specialist-month (no MonthlyRoute for ST id {route_id})\n------\n"
                )
                continue

            deleted = MonthlyRouteSpecialistMonth.query.filter(
                MonthlyRouteSpecialistMonth.monthly_route_id == mr_row.id,
                MonthlyRouteSpecialistMonth.month_first < oldest_month,
            ).delete(synchronize_session=False)

            if deleted:
                print(f"  Pruned {deleted} specialist-month row(s) before {oldest_month.isoformat()}")

            mr_id = int(mr_row.id)
            for mf in month_first_list:
                begin_ts, end_ts = completed_on_range_unix(mf)
                month_jobs = fetch_completed_jobs_route_month(route_id, begin_ts, end_ts)
                month_tech_counts: dict[str, int] = defaultdict(int)
                jobs_attributed = 0
                seen_job_ids: set[int] = set()
                route_test_dates: list[date] = []

                for job in month_jobs:
                    jid = job.get("id")
                    if jid is not None:
                        ij = int(jid)
                        if ij in seen_job_ids:
                            continue
                    inc = tech_increment_names_for_job(job, active_name_set)
                    if not inc:
                        continue
                    if jid is not None:
                        seen_job_ids.add(int(jid))
                    jobs_attributed += 1
                    td = job_route_test_date_pacific(job)
                    if td is not None:
                        route_test_dates.append(td)
                    for name in inc:
                        month_tech_counts[name] += 1

                route_tested_on = max(route_test_dates) if route_test_dates else None

                month_top = [
                    {"tech_name": tech_name, "jobs": count}
                    for tech_name, count in sorted(month_tech_counts.items(), key=lambda x: x[1], reverse=True)[:5]
                ]

                stmt_m = insert(MonthlyRouteSpecialistMonth).values(
                    monthly_route_id=mr_id,
                    month_first=mf,
                    top_technicians=month_top,
                    completed_jobs_attributed=jobs_attributed,
                    route_tested_on=route_tested_on,
                    last_updated_at=now,
                )
                stmt_m = stmt_m.on_conflict_do_update(
                    constraint="uq_monthly_route_specialist_month_route_month",
                    set_={
                        "top_technicians": stmt_m.excluded.top_technicians,
                        "completed_jobs_attributed": stmt_m.excluded.completed_jobs_attributed,
                        "route_tested_on": stmt_m.excluded.route_tested_on,
                        "last_updated_at": stmt_m.excluded.last_updated_at,
                    },
                )
                db.session.execute(stmt_m)

            db.session.commit()

            print(f"\n------\n{route_name} — snapshot: {len(jobs_snapshot)} jobs; specialist months refreshed.\n------\n")
            if not top_5:
                print("No ACTIVE technicians found for last 100 completed jobs (snapshot).")
            else:
                for row in top_5:
                    print(f"{row['tech_name']}: {row['jobs']} jobs completed.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Update monthly route specialist caches.")
    parser.add_argument(
        "--max-routes",
        type=int,
        default=None,
        metavar="N",
        help="Process at most N ServiceTrade route locations (debug).",
    )
    args = parser.parse_args()
    monthly_specialists(max_routes=args.max_routes)


if __name__ == "__main__":
    main()
