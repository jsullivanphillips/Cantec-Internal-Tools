"""
List completed jobs where the latest ServiceTrade job.status.changed -> Completed
row credits a given user — same rule as ProcessorMetrics / get_jobs_processed_by_processor.

Requires PROCESSING_USERNAME and PROCESSING_PASSWORD in the environment (same as
update_processing_data.py).

Example (repo root):

    python app/scripts/find_jobs_by_processor_completion.py
    python app/scripts/find_jobs_by_processor_completion.py --processor "Verena Heinrich" --since 2026-01-01
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any

import requests
from dotenv import load_dotenv
from zoneinfo import ZoneInfo

from app import create_app
from app.routes.processing_attack import (
    SERVICE_TRADE_API_BASE,
    _latest_job_completion_attribution,
    api_session,
    authenticate,
)

load_dotenv()
app = create_app()

# Same job types as get_jobs_processed / get_jobs_processed_by_processor
JOB_TYPES_PARAM = (
    "repair,upgrade,service_call,emergency_service_call,inspection,reinpsection,"
    "planned_maintenance,preventative_maintenance,inspection_repair,delivery,pickup,"
    "installation,training,testing,replacement"
)


def _job_street(job: dict[str, Any]) -> str:
    return (
        job.get("location", {})
        .get("address", {})
        .get("street", "")
        or ""
    )


def _completed_on_display(job: dict[str, Any]) -> str:
    raw = job.get("completedOn")
    if raw is None:
        return ""
    try:
        if isinstance(raw, (int, float)):
            return datetime.fromtimestamp(int(raw), tz=timezone.utc).isoformat()
        return str(raw)
    except (OSError, OverflowError, ValueError):
        return str(raw)


def fetch_completed_jobs_page(
    begin_ts: int,
    end_ts: int,
    page: int,*,
    limit: int,
) -> tuple[list[dict[str, Any]], int]:
    job_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    job_params: dict[str, Any] = {
        "completedOnBegin": begin_ts,
        "completedOnEnd": end_ts,
        "status": "completed",
        "sort": "scheduleStart",
        "type": JOB_TYPES_PARAM,
        "limit": limit,
        "page": page,
    }
    response = api_session.get(job_endpoint, params=job_params)
    response.raise_for_status()
    data = response.json().get("data", {}) or {}
    jobs = data.get("jobs", []) or []
    total_pages = int(data.get("totalPages") or 1)
    return jobs, total_pages


def find_processor_completions(
    processor_name: str,*,
    since_local: datetime,
    end_local: datetime,
    limit: int,
) -> list[dict[str, Any]]:
    """since_local and end_local must be timezone-aware (same zone)."""
    begin_ts = int(since_local.timestamp())
    end_ts = int(end_local.timestamp())

    target = processor_name.strip().casefold()
    results: list[dict[str, Any]] = []
    all_jobs: list[dict[str, Any]] = []

    page = 1
    while True:
        jobs, total_pages = fetch_completed_jobs_page(begin_ts, end_ts, page=page, limit=limit)
        all_jobs.extend(jobs)
        if page >= total_pages:
            break
        page += 1

    num_jobs = len(all_jobs)
    for i, job in enumerate(all_jobs, start=1):
        job_id = job.get("id")
        if job_id is None:
            continue
        history_endpoint = f"{SERVICE_TRADE_API_BASE}/history"
        history_params = {"entityId": job_id, "entityType": 3}
        try:
            response = api_session.get(history_endpoint, params=history_params)
            response.raise_for_status()
        except requests.RequestException as exc:
            print(f"[warn] history failed for job {job_id}: {exc}", file=sys.stderr)
            continue

        history_response = response.json().get("data", {}) or {}
        histories = history_response.get("histories", []) or []
        sys.stdout.write(f"\rscanned history {i}/{num_jobs}")
        sys.stdout.flush()

        attribution = _latest_job_completion_attribution(histories)
        if not attribution:
            continue
        event_dt, credited_name = attribution
        if (credited_name or "").strip().casefold() != target:
            continue

        results.append(
            {
                "job_id": job_id,
                "job_type": job.get("type"),
                "customer": job.get("customerName") or job.get("customer", {}).get("name"),
                "address": _job_street(job),
                "job_completed_on": _completed_on_display(job),
                "latest_completion_attribution": {
                    "credited_user": credited_name,
                    "history_event_time": event_dt.isoformat() if event_dt else None,
                },
            }
        )

    sys.stdout.write("\n")
    sys.stdout.flush()
    return results


def main() -> None:
    argp = argparse.ArgumentParser(
        description=(
            "Jobs completed in a date range where the latest Completed history row credits the given processor."
        ),
    )
    argp.add_argument(
        "--processor",
        default="Verena Heinrich",
        help="Full name as it appears on the job.status.changed / Completed history event (default: Verena Heinrich).",
    )
    argp.add_argument(
        "--since",
        default="2026-01-01",
        help="Local date YYYY-MM-DD; range starts at midnight in --timezone (default: 2026-01-01).",
    )
    argp.add_argument(
        "--timezone",
        default="America/Vancouver",
        help="IANA timezone for interpreting --since and the end of the range (default: America/Vancouver).",
    )
    argp.add_argument(
        "--page-size",
        type=int,
        default=100,
        help="ServiceTrade job API page size (default: 100).",
    )
    argp.add_argument(
        "--json",
        action="store_true",
        help="Print JSON array instead of a text table.",
    )
    args = argp.parse_args()

    tz = ZoneInfo(args.timezone)
    since_naive = datetime.strptime(args.since, "%Y-%m-%d")
    since_local = since_naive.replace(tzinfo=tz)
    end_local = datetime.now(tz)

    if not os.environ.get("PROCESSING_USERNAME") or not os.environ.get("PROCESSING_PASSWORD"):
        print("Set PROCESSING_USERNAME and PROCESSING_PASSWORD.", file=sys.stderr)
        sys.exit(1)

    with app.app_context():
        from flask import session

        with app.test_request_context():
            session["username"] = os.environ.get("PROCESSING_USERNAME")
            session["password"] = os.environ.get("PROCESSING_PASSWORD")
            auth_result = authenticate()
            if auth_result is not None:
                print("Authentication failed (check credentials).", file=sys.stderr)
                sys.exit(1)

            rows = find_processor_completions(
                args.processor,
                since_local=since_local,
                end_local=end_local,
                limit=args.page_size,
            )

    if args.json:
        print(json.dumps(rows, indent=2))
        return

    print(
        f"Jobs whose latest Completed history row credits {args.processor!r}; "
        f"completedOn between {since_local.isoformat()} and {end_local.isoformat()} ({args.timezone}).\n"
    )
    print(f"Total matching jobs: {len(rows)}\n")
    for row in rows:
        jid = row["job_id"]
        ev = row["latest_completion_attribution"]
        print(
            f"  job_id={jid} type={row.get('job_type')} completedOn={row.get('job_completed_on')} "
            f"history_time={ev.get('history_event_time')}"
        )
        if row.get("customer") or row.get("address"):
            print(f"    customer={row.get('customer')!r} address={row.get('address')!r}")


if __name__ == "__main__":
    main()
