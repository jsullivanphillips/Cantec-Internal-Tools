"""Probe ServiceTrade quote/job fields for SLA metric fix."""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone

import requests
from dotenv import load_dotenv
from zoneinfo import ZoneInfo

from app import create_app
from app.db_models import Quote, db

load_dotenv("app/.env")

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
PACIFIC = ZoneInfo("America/Vancouver")


def auth_session() -> requests.Session:
    username = os.getenv("PROCESSING_USERNAME")
    password = os.getenv("PROCESSING_PASSWORD")
    if not username or not password:
        raise SystemExit("Set PROCESSING_USERNAME and PROCESSING_PASSWORD in app/.env")

    session = requests.Session()
    resp = session.post(f"{SERVICE_TRADE_API_BASE}/auth", json={"username": username, "password": password})
    resp.raise_for_status()
    return session


def fetch_quotes(session: requests.Session, **params) -> list[dict]:
    resp = session.get(f"{SERVICE_TRADE_API_BASE}/quote", params=params)
    resp.raise_for_status()
    data = resp.json().get("data", {})
    quotes = list(data.get("quotes", []))
    total_pages = data.get("totalPages", 1)
    for page in range(2, total_pages + 1):
        p = {**params, "page": page}
        r = session.get(f"{SERVICE_TRADE_API_BASE}/quote", params=p)
        r.raise_for_status()
        quotes.extend(r.json().get("data", {}).get("quotes", []))
    return quotes


def fetch_job(session: requests.Session, job_id: int) -> dict | None:
    resp = session.get(f"{SERVICE_TRADE_API_BASE}/job/{job_id}")
    if not resp.ok:
        return None
    return resp.json().get("data", {})


def summarize_quote(q: dict) -> dict:
    jobs = q.get("jobs") or []
    job0 = jobs[0] if jobs else {}
    qr = q.get("quoteRequest") or {}
    keys = [
        "id",
        "status",
        "created",
        "accepted",
        "acceptedOn",
        "statusChanged",
        "updated",
        "approvedOn",
        "approved",
    ]
    out = {k: q.get(k) for k in keys if k in q}
    out["quoteRequest_status"] = qr.get("status")
    out["quoteRequest_approvedOn"] = qr.get("approvedOn") or qr.get("approved")
    out["job_count"] = len(jobs)
    out["job_id"] = job0.get("id")
    out["job_status"] = job0.get("status")
    out["job_scheduledDate"] = job0.get("scheduledDate")
    out["job_created"] = job0.get("created")
    return out


def main() -> None:
    app = create_app()
    with app.app_context():
        sample_ids = [
            q.quote_id
            for q in Quote.query.filter(Quote.status == "accepted", Quote.job_created.is_(True))
            .order_by(Quote.quote_created_on.desc())
            .limit(5)
            .all()
        ]

    if not sample_ids:
        print("No accepted quotes with jobs in DB")
        sys.exit(1)

    session = auth_session()
    end = datetime.now(PACIFIC)
    start = end - timedelta(days=180)
    list_quotes = fetch_quotes(
        session,
        createdAfter=int(start.timestamp()),
        createdBefore=int(end.timestamp()),
        status="accepted",
        limit=5,
    )

    print("=== List endpoint (status=accepted, last 6mo, first 5) ===")
    for q in list_quotes[:5]:
        print(json.dumps(summarize_quote(q), indent=2, default=str))

    print("\n=== Detail endpoint for DB sample accepted+job quotes ===")
    for qid in sample_ids[:3]:
        resp = session.get(f"{SERVICE_TRADE_API_BASE}/quote/{qid}")
        if not resp.ok:
            print(f"quote/{qid}: HTTP {resp.status_code}")
            continue
        q = resp.json().get("data", {})
        summary = summarize_quote(q)
        print(json.dumps(summary, indent=2, default=str))
        job_id = summary.get("job_id")
        if job_id:
            job = fetch_job(session, int(job_id))
            if job:
                print(
                    "  job detail:",
                    {
                        "id": job.get("id"),
                        "status": job.get("status"),
                        "scheduledDate": job.get("scheduledDate"),
                        "scheduledOn": job.get("scheduledOn"),
                        "created": job.get("created"),
                    },
                )


if __name__ == "__main__":
    main()
