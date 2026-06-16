"""Backfill quote_accepted_on and job schedule dates from ServiceTrade."""
from __future__ import annotations

import os
import time

import requests
from dotenv import load_dotenv
from tqdm import tqdm

from app import create_app
from app.db_models import Quote, db
from app.routes.performance_summary import (
    SERVICE_TRADE_API_BASE,
    extract_quote_accepted_on,
    upsert_job_schedule_from_servicetrade,
)

load_dotenv("app/.env")


def auth_session() -> requests.Session:
    username = os.getenv("PROCESSING_USERNAME")
    password = os.getenv("PROCESSING_PASSWORD")
    if not username or not password:
        raise SystemExit("Set PROCESSING_USERNAME and PROCESSING_PASSWORD in app/.env")

    session = requests.Session()
    resp = session.post(f"{SERVICE_TRADE_API_BASE}/auth", json={"username": username, "password": password})
    resp.raise_for_status()
    return session


def main() -> None:
    app = create_app()
    api = auth_session()

    with app.app_context():
        quotes = (
            Quote.query.filter(Quote.status == "accepted")
            .order_by(Quote.quote_created_on.desc())
            .all()
        )
        updated_accept = 0
        updated_jobs = 0

        for quote in tqdm(quotes, desc="Backfilling accepted quotes"):
            resp = api.get(f"{SERVICE_TRADE_API_BASE}/quote/{quote.quote_id}")
            if not resp.ok:
                continue
            payload = resp.json().get("data", {})
            if not payload:
                continue

            accepted_on = extract_quote_accepted_on(payload)
            if accepted_on and quote.quote_accepted_on != accepted_on:
                quote.quote_accepted_on = accepted_on
                updated_accept += 1

            jobs = payload.get("jobs") or []
            job_id = jobs[0].get("id") if jobs else quote.job_id
            if job_id:
                quote.job_created = True
                quote.job_id = job_id
                job_resp = api.get(f"{SERVICE_TRADE_API_BASE}/job/{job_id}")
                if job_resp.ok:
                    job_payload = job_resp.json().get("data", {})
                    if job_payload:
                        upsert_job_schedule_from_servicetrade(job_payload)
                        updated_jobs += 1

            db.session.add(quote)
            time.sleep(0.05)

        db.session.commit()
        print(f"Updated quote_accepted_on on {updated_accept} quotes")
        print(f"Upserted schedule data for {updated_jobs} jobs")


if __name__ == "__main__":
    main()
