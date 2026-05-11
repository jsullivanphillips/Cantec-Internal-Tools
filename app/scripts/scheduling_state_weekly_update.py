import os
# app/scripts/scheduling_attack_update_v2.py
import requests
import logging
import argparse
import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from collections import defaultdict
from app.services.scheduling_diff import BaselineState, compute_scheduling_diffs


from app import create_app
from app.db_models import db, JobsSchedulingState, WeeklySchedulingStats

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
api_session = requests.Session()
api_session.headers.update({"Accept": "application/json"})

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger("backfill")
LOCAL_TZ = ZoneInfo("America/Vancouver")

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


def _week_window_local(anchor: datetime) -> tuple[datetime, datetime]:
    """
    Returns (period_start, period_end) for the work week bucket.
    Uses Monday 00:00 America/Vancouver → next Monday 00:00 America/Vancouver.
    """
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=timezone.utc)
    anchor_local = anchor.astimezone(LOCAL_TZ)

    start = anchor_local - timedelta(days=anchor_local.weekday())
    period_start = start.replace(hour=0, minute=0, second=0, microsecond=0)
    period_end = period_start + timedelta(days=7)
    return period_start, period_end


def _weekly_stats_bucket_for_run(now: datetime) -> tuple[datetime, datetime]:
    """
    Vancouver Mon→Mon bucket that the snapshot counts should be stored under.

    Uses the week containing (now - 1 day) in local time so that:
      - A run on Sunday still maps to the in-progress week (Mon..Sun).
      - A run just after Monday 00:00 maps to the week that ended at that
        Monday, not the new week (fixes stats written under the next period_*).
    """
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return _week_window_local(now - timedelta(days=1))


def run_weekly_scheduling_snapshot(job_type: str = "inspection,reinspection,planned_maintenance"):
    now = datetime.now(timezone.utc)
    week_start, week_end = _weekly_stats_bucket_for_run(now)

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
    week_start, week_end = _weekly_stats_bucket_for_run(now)

    return (
        db.session.query(WeeklySchedulingStats.id)
        .filter(WeeklySchedulingStats.period_start == week_start)
        .filter(WeeklySchedulingStats.period_end == week_end)
        .filter(WeeklySchedulingStats.job_type == job_type)
        .first()
        is not None
    )


def _default_backup_name() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return f"weekly_scheduling_stats_backup_{stamp}"


def _validate_backup_name(name: str) -> str:
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")
    if not name or any(ch not in allowed for ch in name):
        raise ValueError("backup name may only contain letters, numbers, and underscores")
    return name


def _create_weekly_stats_backup(backup_name: str) -> str:
    backup_name = _validate_backup_name(backup_name)
    create_sql = (
        f"CREATE TABLE {backup_name} AS "
        "SELECT * FROM weekly_scheduling_stats"
    )
    with db.engine.begin() as conn:
        conn.exec_driver_sql(create_sql)
    return backup_name


def repair_week_bucket_alignment(*, dry_run: bool = True, backup_name: str | None = None) -> dict:
    """
    Non-destructive repair:
      - Reads all legacy rows.
      - Computes corrected Vancouver-local week bucket.
      - Writes corrected bucket rows (upsert by unique key).
      - Leaves original rows untouched.
      - Requires a full-table backup before any mutation.
    """
    rows = db.session.query(WeeklySchedulingStats).all()

    # Aggregate only rows that need shifting. This keeps the operation idempotent.
    aggregated = defaultdict(lambda: {"scheduled": 0, "rescheduled": 0, "generated_at": None})
    rows_scanned = len(rows)
    rows_needing_shift = 0

    for row in rows:
        corrected_start, corrected_end = _week_window_local(row.period_start)
        needs_shift = (corrected_start != row.period_start) or (corrected_end != row.period_end)
        if not needs_shift:
            continue

        rows_needing_shift += 1
        key = (corrected_start, corrected_end, row.job_type)
        agg = aggregated[key]
        agg["scheduled"] += int(row.scheduled_count or 0)
        agg["rescheduled"] += int(row.rescheduled_count or 0)
        existing_generated = agg["generated_at"]
        if existing_generated is None or (row.generated_at and row.generated_at > existing_generated):
            agg["generated_at"] = row.generated_at

    summary = {
        "rows_scanned": rows_scanned,
        "rows_needing_shift": rows_needing_shift,
        "rows_written": 0,
        "conflict_merges": 0,
        "backup_table": None,
        "dry_run": dry_run,
    }

    if dry_run or not aggregated:
        return summary

    backup_table = _create_weekly_stats_backup(backup_name or _default_backup_name())
    summary["backup_table"] = backup_table

    rows_written = 0
    conflict_merges = 0
    for (period_start, period_end, job_type), vals in aggregated.items():
        stats_row = (
            db.session.query(WeeklySchedulingStats)
            .filter(WeeklySchedulingStats.period_start == period_start)
            .filter(WeeklySchedulingStats.period_end == period_end)
            .filter(WeeklySchedulingStats.job_type == job_type)
            .one_or_none()
        )

        if stats_row is None:
            db.session.add(
                WeeklySchedulingStats(
                    period_start=period_start,
                    period_end=period_end,
                    job_type=job_type,
                    scheduled_count=vals["scheduled"],
                    rescheduled_count=vals["rescheduled"],
                    generated_at=vals["generated_at"] or datetime.now(timezone.utc),
                )
            )
        else:
            conflict_merges += 1
            stats_row.scheduled_count = vals["scheduled"]
            stats_row.rescheduled_count = vals["rescheduled"]
            stats_row.generated_at = vals["generated_at"] or stats_row.generated_at
        rows_written += 1

    db.session.commit()
    summary["rows_written"] = rows_written
    summary["conflict_merges"] = conflict_merges
    return summary


def main():
    parser = argparse.ArgumentParser(description="Update weekly scheduling stats and baseline.")
    parser.add_argument("--job-type", default="inspection,reinspection,planned_maintenance")
    parser.add_argument("--repair-week-buckets", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--backup-name", default=None)
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        if args.repair_week_buckets:
            result = repair_week_bucket_alignment(dry_run=args.dry_run, backup_name=args.backup_name)
            print(json.dumps(result, default=str))
            return

        now = datetime.now(timezone.utc)
        job_type = args.job_type

        username = os.getenv("PROCESSING_USERNAME")
        password = os.getenv("PROCESSING_PASSWORD")
        if not username or not password:
            raise SystemExit("Missing PROCESSING_USERNAME/PROCESSING_PASSWORD environment vars.")
        authenticate(username, password)

        if now.astimezone(LOCAL_TZ).weekday() != 6:  # Sunday in Vancouver
            log.info("Not the preferred weekly run day (Sunday), but running guard-based check.")

        if weekly_stats_already_recorded(now, job_type):
            log.info(
                "Weekly scheduling stats already recorded for this week. Exiting."
            )
            return
        

        run_weekly_scheduling_snapshot(job_type=job_type)

        

if __name__ == "__main__":
    main()