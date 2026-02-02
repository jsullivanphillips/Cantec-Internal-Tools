import os
# app/scripts/scheduling_attack_update_v2.py
import requests
import logging
from datetime import datetime, timedelta, timezone
from app.services.scheduling_diff import BaselineState, compute_scheduling_diffs


from app import create_app
from app.db_models import db, JobsSchedulingState, WeeklySchedulingStats

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
api_session = requests.Session()
api_session.headers.update({"Accept": "application/json"})

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger("backfill")

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
        params["page"] = page  # ServiceTrade pagination

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


def _week_window_utc(anchor: datetime) -> tuple[datetime, datetime]:
    """
    Returns (period_start, period_end) for the work week bucket.
    Uses Monday 00:00 UTC → next Monday 00:00 UTC.
    """
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=timezone.utc)
    anchor = anchor.astimezone(timezone.utc)

    start = anchor - timedelta(days=anchor.weekday())
    period_start = datetime(start.year, start.month, start.day, tzinfo=timezone.utc)
    period_end = period_start + timedelta(days=7)
    return period_start, period_end


def run_weekly_scheduling_snapshot(job_type: str = "inspection,reinspection,planned_maintenance"):
    now = datetime.now(timezone.utc)
    week_start, week_end = _week_window_utc(now)

    # -------- 1) Load baseline --------
    baseline_rows = db.session.query(JobsSchedulingState).all()
    baseline_by_id = {
        r.job_id: BaselineState(job_id=r.job_id, scheduled_date=r.scheduled_date)
        for r in baseline_rows
    }

    # -------- 2) Fetch live from ServiceTrade --------
    tomorrow = now + timedelta(days=1)

    scheduled_jobs = fetch_all_jobs_paginated({
        "limit": 1000,
        "type": job_type,
        "status": "scheduled",
        "scheduleDateFrom": int(tomorrow.timestamp()),
    })

    unscheduled_jobs = fetch_all_jobs_paginated({
        "limit": 1000,
        "type": job_type,
        "status": "new",
    })

    jobs_by_id = {}
    for j in scheduled_jobs:
        if j.get("id"):
            jobs_by_id[j["id"]] = j
    for j in unscheduled_jobs:
        if j.get("id") and j["id"] not in jobs_by_id:
            jobs_by_id[j["id"]] = j

    all_jobs = list(jobs_by_id.values())

    live_jobs_normalized = [
        {"id": j["id"], "scheduled_date": _parse_scheduled_date(j)}
        for j in all_jobs
        if j.get("id")
    ]

    # -------- Bootstrap (first run) --------
    # If baseline is empty, don't record stats (or you’ll count everything).
    if not baseline_by_id:
        # Write baseline only
        db.session.query(JobsSchedulingState).delete()
        for j in live_jobs_normalized:
            db.session.add(JobsSchedulingState(
                job_id=j["id"],
                scheduled_date=j["scheduled_date"],
                last_seen_at=now,
                job_type=job_type,
            ))
        db.session.commit()
        log.info("BOOTSTRAP: baseline created, no weekly stats written.")
        return

    # -------- 3) Diff baseline vs live --------
    scheduled_count, rescheduled_count = compute_scheduling_diffs(
        baseline_by_id=baseline_by_id,
        live_jobs=live_jobs_normalized,
    )

    # -------- 4) Insert 1 weekly stats row --------
    # If you have a UNIQUE constraint (period_start, period_end, job_type),
    # you can upsert/overwrite; here we overwrite if it exists.
    stats_row = (
        db.session.query(WeeklySchedulingStats)
        .filter(WeeklySchedulingStats.period_start == week_start)
        .filter(WeeklySchedulingStats.period_end == week_end)
        .filter(WeeklySchedulingStats.job_type == job_type)
        .one_or_none()
    )

    if stats_row is None:
        stats_row = WeeklySchedulingStats(
            period_start=week_start,
            period_end=week_end,
            job_type=job_type,
            scheduled_count=scheduled_count,
            rescheduled_count=rescheduled_count,
            generated_at=now,
        )
        db.session.add(stats_row)
    else:
        stats_row.scheduled_count = scheduled_count
        stats_row.rescheduled_count = rescheduled_count
        stats_row.generated_at = now

    # -------- 5) Update baseline to live snapshot --------
    # Replace/prune baseline to exactly match live.
    db.session.query(JobsSchedulingState).delete()

    for j in live_jobs_normalized:
        db.session.add(JobsSchedulingState(
            job_id=j["id"],
            scheduled_date=j["scheduled_date"],
            last_seen_at=now,
            job_type=job_type,
        ))

    db.session.commit()

    log.info(
        f"WEEKLY SNAPSHOT ({week_start.date()} → {week_end.date()}): "
        f"scheduled={scheduled_count}, rescheduled={rescheduled_count}, live_jobs={len(live_jobs_normalized)}"
    )

def weekly_stats_already_recorded(now: datetime, job_type: str) -> bool:
    week_start, week_end = _week_window_utc(now)

    return (
        db.session.query(WeeklySchedulingStats.id)
        .filter(WeeklySchedulingStats.period_start == week_start)
        .filter(WeeklySchedulingStats.period_end == week_end)
        .filter(WeeklySchedulingStats.job_type == job_type)
        .first()
        is not None
    )


def main():
    app = create_app()
    with app.app_context():
        username = os.getenv("PROCESSING_USERNAME")
        password = os.getenv("PROCESSING_PASSWORD")
        if not username or not password:
            raise SystemExit("Missing PROCESSING_USERNAME/PROCESSING_PASSWORD environment vars.")
        authenticate(username, password)

        now = datetime.now(timezone.utc)
        job_type = "inspection,reinspection,planned_maintenance"

        if now.weekday() != 6:  # Sunday
            log.info("Not the preferred weekly run day (Sunday), but running guard-based check.")

        if weekly_stats_already_recorded(now, job_type):
            log.info(
                "Weekly scheduling stats already recorded for this week. Exiting."
            )
            return
        

        run_weekly_scheduling_snapshot(job_type=job_type)

        

if __name__ == "__main__":
    main()