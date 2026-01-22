# backend/scripts/update_forward_schedule_week.py
from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.db_models import db, ForwardScheduleWeek
from app.routes.scheduling_attack import fetch_all_jobs_paginated, get_active_techs

# Keep consistent with the app
LOCAL_TZ = ZoneInfo("America/Vancouver")


def _local_week_start(dt_local: datetime) -> datetime:
    """
    dt_local must be tz-aware in LOCAL_TZ.
    Returns Monday 00:00 local for that ISO week.
    """
    if dt_local.tzinfo is None:
        raise ValueError("dt_local must be tz-aware")
    return (dt_local - timedelta(days=dt_local.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )


def _week_start_local_from_utc(dt_utc: datetime) -> datetime:
    if dt_utc.tzinfo is None:
        raise ValueError("dt_utc must be tz-aware")
    return _local_week_start(dt_utc.astimezone(LOCAL_TZ))


@dataclass(frozen=True)
class WeeklyAgg:
    booked_hours: float = 0.0
    unavailable_hours: float = 0.0
    released_appointments: int = 0


def compute_weekly_booked_vs_available(
    scheduled_jobs: list[dict],
    active_techs: list,
    *,
    now_utc: datetime,
) -> dict:
    """
    Returns:
      {
        "weeks": [
          {
            "week_start_local": datetime (tz-aware local),
            "week_end_local": datetime (tz-aware local),
            "booked_hours": float,
            "unavailable_hours": float,
            "available_hours": float,
            "utilization_pct": float,
            "released_appointments": int,
          },
          ...
        ]
      }
    """

    weekly = defaultdict(lambda: {"booked_hours": 0.0, "unavailable_hours": 0.0, "released_appointments": 0})

    now_ts = now_utc.timestamp()

    # ---- aggregate booked/unavailable hours into local-week buckets ----
    for job in scheduled_jobs:
        job_type = (job.get("type") or "").strip()

        for appt in (job.get("appointments") or []):
            start_ts = appt.get("windowStart")
            end_ts = appt.get("windowEnd")
            if not start_ts or not end_ts:
                continue

            # skip past appointments
            if start_ts < now_ts:
                continue

            techs = appt.get("techs") or []
            num_techs = len(techs)
            if num_techs <= 0:
                continue

            released = bool(appt.get("released", False))

            # ServiceTrade timestamps are unix seconds (UTC)
            start_utc = datetime.fromtimestamp(start_ts, tz=timezone.utc)
            end_utc = datetime.fromtimestamp(end_ts, tz=timezone.utc)
            if end_utc <= start_utc:
                continue

            start_local = start_utc.astimezone(LOCAL_TZ)
            week_start_local = _local_week_start(start_local)

            duration_hours = (end_utc - start_utc).total_seconds() / 3600.0
            hours = duration_hours * num_techs

            # Your rules: admin/unknown counts as "unavailable"
            if job_type not in ("administrative", "unknown"):
                weekly[week_start_local]["booked_hours"] += hours
                if released:
                    weekly[week_start_local]["released_appointments"] += 1
            else:
                weekly[week_start_local]["unavailable_hours"] += hours

    # ---- compute available hours and finalize sparse list ----
    tech_count = len(active_techs)
    # 7.5h/day * 5 weekdays per tech
    base_week_capacity = (tech_count * 7.5) * 5

    weeks_out = []
    for week_start_local in sorted(weekly.keys()):
        unavailable = float(weekly[week_start_local]["unavailable_hours"])
        booked = float(weekly[week_start_local]["booked_hours"])
        released_count = int(weekly[week_start_local]["released_appointments"])

        available = max(0.0, base_week_capacity - unavailable)
        util_pct = (booked / available * 100.0) if available > 0 else 0.0

        weeks_out.append(
            {
                "week_start_local": week_start_local,
                "week_end_local": week_start_local + timedelta(days=7),
                "booked_hours": round(booked, 2),
                "unavailable_hours": round(unavailable, 2),
                "available_hours": round(available, 2),
                "utilization_pct": round(util_pct, 1),
                "released_appointments": released_count,
            }
        )

    return {"weeks": weeks_out}


def _build_continuous_weeks(
    sparse_weeks: list[dict],
    *,
    start_week_local: datetime,
    lookahead_weeks: int,
) -> list[dict]:
    """
    Ensures you always get exactly lookahead_weeks rows, even if sparse is missing weeks.
    Missing weeks become zeros (but keep computed available_hours etc. if present in sparse).
    """
    by_start = {w["week_start_local"]: w for w in sparse_weeks}

    out = []
    for i in range(lookahead_weeks):
        ws = start_week_local + timedelta(days=7 * i)
        we = ws + timedelta(days=7)

        row = by_start.get(ws)
        if row:
            out.append(row)
        else:
            # If a week is missing entirely, treat as 0 booked, 0 unavailable, 0 released.
            # available_hours cannot be derived here unless you pass tech_count/capacity through;
            # so we store 0s and let the updater compute sparse for all weeks it sees.
            out.append(
                {
                    "week_start_local": ws,
                    "week_end_local": we,
                    "booked_hours": 0.0,
                    "unavailable_hours": 0.0,
                    "available_hours": 0.0,
                    "utilization_pct": 0.0,
                    "released_appointments": 0,
                }
            )

    return out


def upsert_forward_schedule_weeks(rows: list[dict], *, generated_at_utc: datetime) -> int:
    """
    Upsert by week_start_local (unique).
    Returns count of rows written (inserted or updated).
    """
    if generated_at_utc.tzinfo is None:
        raise ValueError("generated_at_utc must be tz-aware")

    written = 0
    for r in rows:
        ws = r["week_start_local"]
        we = r["week_end_local"]

        existing = ForwardScheduleWeek.query.filter_by(week_start_local=ws).first()
        if existing:
            existing.week_end_local = we
            existing.booked_hours = float(r.get("booked_hours") or 0.0)
            existing.unavailable_hours = float(r.get("unavailable_hours") or 0.0)
            existing.available_hours = float(r.get("available_hours") or 0.0)
            existing.released_appointments = int(r.get("released_appointments") or 0)
            existing.utilization_pct = float(r.get("utilization_pct") or 0.0)
            existing.generated_at = generated_at_utc
        else:
            db.session.add(
                ForwardScheduleWeek(
                    week_start_local=ws,
                    week_end_local=we,
                    booked_hours=float(r.get("booked_hours") or 0.0),
                    unavailable_hours=float(r.get("unavailable_hours") or 0.0),
                    available_hours=float(r.get("available_hours") or 0.0),
                    released_appointments=int(r.get("released_appointments") or 0),
                    utilization_pct=float(r.get("utilization_pct") or 0.0),
                    generated_at=generated_at_utc,
                )
            )

        written += 1

    db.session.commit()
    return written


def run_update(*, lookahead_weeks: int, start_next_week: bool) -> dict:
    now = datetime.now(timezone.utc)
    generated_at = now

    # Fetch live jobs from ServiceTrade (scheduled forward)
    scheduled_jobs = fetch_all_jobs_paginated(
        {
            "limit": 1000,
            "type": (
                "inspection,service_call,planned_maintenance,preventative_maintenance,"
                "inspection_repair,repair,installation,replacement,upgrade,reinspection,"
                "administrative,unknown"
            ),
            "status": "scheduled,completed",
            "scheduleDateFrom": int(now.timestamp()),
        }
    )

    active_techs = get_active_techs()

    sparse = compute_weekly_booked_vs_available(scheduled_jobs, active_techs, now_utc=now)
    sparse_weeks = sparse.get("weeks", [])

    # Determine starting week bucket (current week or next week)
    cur_week = _week_start_local_from_utc(now)
    start_week = (cur_week + timedelta(days=7)) if start_next_week else cur_week

    # NOTE: compute_weekly_booked_vs_available only returns weeks that appear in the data.
    # We store a continuous series for consistent charting.
    continuous = _build_continuous_weeks(sparse_weeks, start_week_local=start_week, lookahead_weeks=lookahead_weeks)

    written = upsert_forward_schedule_weeks(continuous, generated_at_utc=generated_at)

    return {
        "generated_at": generated_at.isoformat(),
        "start_week_local": start_week.isoformat(),
        "lookahead_weeks": lookahead_weeks,
        "rows_written": written,
    }


def main():
    parser = argparse.ArgumentParser(description="Update forward_schedule_week table.")
    parser.add_argument("--weeks", type=int, default=12)
    parser.add_argument("--start-next-week", action="store_true", help="Start series at next local week.")
    args = parser.parse_args()

    # Import your app factory (adjust if different)
    from app import create_app

    app = create_app()
    with app.app_context():
        result = run_update(lookahead_weeks=args.weeks, start_next_week=args.start_next_week)
        print(result)


if __name__ == "__main__":
    main()
