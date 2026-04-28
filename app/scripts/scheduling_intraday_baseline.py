import os
import logging
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests

from app import create_app
from app.db_models import db, JobsSchedulingDayBaseline

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
LOCAL_TZ = ZoneInfo("America/Vancouver")
JOB_TYPE = "inspection,reinspection,planned_maintenance"

api_session = requests.Session()
api_session.headers.update({"Accept": "application/json"})

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger("sched-intraday-baseline")


def authenticate(username: str, password: str) -> None:
    auth_url = f"{SERVICE_TRADE_API_BASE}/auth"
    resp = api_session.post(auth_url, json={"username": username, "password": password})
    resp.raise_for_status()


def call_service_trade_api(endpoint: str, params=None):
    url = f"{SERVICE_TRADE_API_BASE}/{endpoint}"
    resp = api_session.get(url, params=params or {})
    resp.raise_for_status()
    return resp.json()


def fetch_all_jobs_paginated(base_params: dict) -> list[dict]:
    jobs: list[dict] = []
    page = 1
    while True:
        params = dict(base_params)
        params["page"] = page
        resp = call_service_trade_api("job", params=params)
        data = resp.get("data", {}) or {}
        page_jobs = data.get("jobs", []) or []
        jobs.extend(page_jobs)

        total_pages = int(data.get("totalPages") or 1)
        current_page = int(data.get("page") or page)
        if current_page >= total_pages:
            break
        page += 1
    return jobs


def _parse_scheduled_date(job: dict):
    raw = job.get("scheduledDate") or job.get("scheduledOn") or job.get("scheduled_date")
    if not raw:
        return None
    if isinstance(raw, (int, float)):
        return datetime.fromtimestamp(raw, tz=timezone.utc)
    if isinstance(raw, str):
        s = raw.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            return None
        return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return None


def _today_local_date():
    return datetime.now(timezone.utc).astimezone(LOCAL_TZ).date()


def ensure_today_baseline() -> dict:
    baseline_date_local = _today_local_date()
    existing = (
        db.session.query(JobsSchedulingDayBaseline.id)
        .filter(JobsSchedulingDayBaseline.baseline_date_local == baseline_date_local)
        .first()
    )
    if existing:
        return {"baseline_date_local": baseline_date_local.isoformat(), "created": False, "rows_inserted": 0}

    scheduled_jobs = fetch_all_jobs_paginated(
        {
            "limit": 1000,
            "type": JOB_TYPE,
            "status": "scheduled",
            "scheduleDateFrom": int(datetime.now(timezone.utc).timestamp()),
        }
    )
    unscheduled_jobs = fetch_all_jobs_paginated(
        {
            "limit": 1000,
            "type": JOB_TYPE,
            "status": "new",
        }
    )

    jobs_by_id = {}
    for j in scheduled_jobs:
        if j.get("id"):
            jobs_by_id[int(j["id"])] = j
    for j in unscheduled_jobs:
        if j.get("id") and int(j["id"]) not in jobs_by_id:
            jobs_by_id[int(j["id"])] = j

    now_utc = datetime.now(timezone.utc)
    baseline_rows = []
    for job in jobs_by_id.values():
        jid = job.get("id")
        if not jid:
            continue
        baseline_rows.append(
            JobsSchedulingDayBaseline(
                baseline_date_local=baseline_date_local,
                job_id=int(jid),
                scheduled_date=_parse_scheduled_date(job),
                job_type=job.get("type"),
                captured_at=now_utc,
            )
        )

    if baseline_rows:
        db.session.bulk_save_objects(baseline_rows)
    db.session.commit()
    return {
        "baseline_date_local": baseline_date_local.isoformat(),
        "created": True,
        "rows_inserted": len(baseline_rows),
    }


def main():
    app = create_app()
    with app.app_context():
        username = os.getenv("PROCESSING_USERNAME")
        password = os.getenv("PROCESSING_PASSWORD")
        if not username or not password:
            raise SystemExit("Missing PROCESSING_USERNAME/PROCESSING_PASSWORD environment vars.")
        authenticate(username, password)
        result = ensure_today_baseline()
        log.info("Intraday baseline result: %s", result)


if __name__ == "__main__":
    main()
