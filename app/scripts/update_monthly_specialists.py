from datetime import datetime, timezone
import os
import requests

from app import create_app, db
from dotenv import load_dotenv
from sqlalchemy.dialects.postgresql import insert
from app.routes.scheduling_attack import get_active_techs

from app.db_models import MonthlyRouteSnapshot 

load_dotenv()

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
api_session = requests.Session()
api_session.headers.update({"Accept": "application/json"})


def authenticate(username: str, password: str) -> None:
    auth_url = f"{SERVICE_TRADE_API_BASE}/auth"
    resp = api_session.post(auth_url, json={"username": username, "password": password})
    resp.raise_for_status()
    print("Authenticated with Service Trade")


def safe_str(v) -> str:
    return (v or "").strip()

def _norm_name(s: str) -> str:
    # strip + collapse whitespace + casefold for robust matching
    return " ".join((s or "").strip().split()).casefold()

def monthly_specialists():
    MONTHLY_COMPANY_ID = 5004069

    app = create_app()
    with app.app_context():
        username = os.getenv("PROCESSING_USERNAME")
        password = os.getenv("PROCESSING_PASSWORD")
        if not username or not password:
            raise SystemExit("Missing PROCESSING_USERNAME/PROCESSING_PASSWORD environment vars.")
        authenticate(username, password)

        # ✅ Build active tech name set ONCE (filter to active + isTech)
        active_techs = get_active_techs() or []
        active_name_set = {
            _norm_name(t.get("name"))
            for t in active_techs
            if str(t.get("status", "")).lower() == "active"
            and t.get("isTech") is True
            and safe_str(t.get("name"))
        }

        print("Active techs:", len(active_name_set))

        # --- fetch routes (locations) ---
        params = {"companyId": MONTHLY_COMPANY_ID, "limit": 1000, "status": "active"}
        response = api_session.get(f"{SERVICE_TRADE_API_BASE}/location", params=params)
        response.raise_for_status()
        data = response.json().get("data", {}) or {}

        route_locations = {}
        for loc in data.get("locations", []) or []:
            loc_id = loc.get("id")
            loc_name = loc.get("name")
            if loc_id:
                route_locations[int(loc_id)] = safe_str(loc_name) or f"Location {loc_id}"

        print("Number of monthly routes:", len(route_locations))

        # --- process each route and UPSERT one row per route ---
        for route_id, route_name in route_locations.items():
            tech_counts = {}

            params = {"locationId": route_id, "status": "completed", "limit": 100}
            response = api_session.get(f"{SERVICE_TRADE_API_BASE}/job", params=params)
            response.raise_for_status()
            jobs = (response.json().get("data", {}) or {}).get("jobs", []) or []

            for job in jobs:
                appointments = job.get("appointments", []) or []
                if not appointments:
                    continue

                # If single appointment: count techs directly
                if len(appointments) == 1:
                    for tech in appointments[0].get("techs", []) or []:
                        name = safe_str(tech.get("name"))
                        if not name:
                            continue
                        if _norm_name(name) not in active_name_set:
                            continue  # ✅ filter out non-active techs BEFORE counting
                        tech_counts[name] = tech_counts.get(name, 0) + 1
                    continue

                # Multiple appointments: exclude Office Clerical service requests (per your logic)
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
                            if not name:
                                continue
                            if _norm_name(name) not in active_name_set:
                                continue  # ✅ filter out non-active techs BEFORE counting
                            tech_counts[name] = tech_counts.get(name, 0) + 1

            # Build top 5 list for JSONB (already filtered)
            top_5 = [
                {"tech_name": tech_name, "jobs": count}
                for tech_name, count in sorted(tech_counts.items(), key=lambda x: x[1], reverse=True)[:5]
            ]

            now = datetime.now(timezone.utc)

            stmt = insert(MonthlyRouteSnapshot).values(
                location_id=route_id,
                location_name=route_name,
                completed_jobs_count=len(jobs),
                top_technicians=top_5,
                last_updated_at=now,
            )

            stmt = stmt.on_conflict_do_update(
                index_elements=["location_id"],
                set_={
                    "location_name": stmt.excluded.location_name,
                    "completed_jobs_count": stmt.excluded.completed_jobs_count,
                    "top_technicians": stmt.excluded.top_technicians,
                    "last_updated_at": stmt.excluded.last_updated_at,
                },
            )

            db.session.execute(stmt)
            db.session.commit()

            print(f"\n------\n{route_name} - {len(jobs)} completed jobs.\n------\n")
            if not top_5:
                print("No ACTIVE technicians found for last 100 completed jobs.")
            else:
                for row in top_5:
                    print(f"{row['tech_name']}: {row['jobs']} jobs completed.")


def main():
    monthly_specialists()


if __name__ == "__main__":
    main()
