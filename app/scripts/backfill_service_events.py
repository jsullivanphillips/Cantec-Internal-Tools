# scripts/backfill_service_events.py

import os
import argparse
import logging
import time
import requests
from tqdm import tqdm
from datetime import datetime, date, timezone

from app import create_app
from app.db_models import (
    db, Location, FactServiceEvent, FactMonthlyServiceNeed,
    DimDate, DimService, DimSource,
    ServiceType, SourceKind
)
from sqlalchemy.dialects.postgresql import insert

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger("backfill_events")

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
api_session = requests.Session()
api_session.headers.update({"Accept": "application/json"})


# -------------------- ServiceTrade helpers --------------------

def authenticate(username: str, password: str) -> None:
    auth_url = f"{SERVICE_TRADE_API_BASE}/auth"
    resp = api_session.post(auth_url, json={"username": username, "password": password})
    resp.raise_for_status()
    log.info("Authenticated to ServiceTrade")


def call_service_trade_api(endpoint: str, params=None):
    url = f"{SERVICE_TRADE_API_BASE}/{endpoint}"
    resp = api_session.get(url, params=params or {})
    resp.raise_for_status()
    return resp.json()


def stream_jobs_for_location(location_id: int, limit: int = 200):
    """Yield job dicts for one location (replace endpoint if needed)."""
    page = 1
    while True:
        params = {"locationId": str(location_id), "page": page, "limit": limit}
        response = call_service_trade_api("job", params=params)
        data = response.get("data")
        jobs = data.get("jobs") or data.get("data", {}).get("jobs") or []
        if not jobs:
            break
        for j in jobs:
            yield j
        if len(jobs) < limit:
            break
        page += 1


# -------------------- Dimension helpers --------------------

def get_or_create_date(d: date) -> DimDate:
    """Ensure a DimDate row exists for this calendar date."""
    month_start = d.replace(day=1)
    row = DimDate.query.filter_by(d=d).one_or_none()
    if row:
        return row

    row = DimDate(
        d=d,
        day=d.day,
        month=d.month,
        year=d.year,
        quarter=((d.month - 1) // 3) + 1,
        month_start=month_start,
        month_name=d.strftime("%B"),
        week_of_year=int(d.strftime("%U")),
        is_month_start=(d.day == 1),
        is_month_end=False,  # can refine
    )
    db.session.add(row)
    db.session.flush()
    return row


def resolve_service(service_line: str, recurring: bool) -> DimService:
    """Get/create service dimension."""
    svc = (DimService.query
           .filter_by(service_type=ServiceType.ANNUAL, service_line=service_line)
           .one_or_none())
    if svc:
        return svc

    svc = DimService(service_type=ServiceType.ANNUAL,
                     service_line=service_line,
                     is_recurring=recurring)
    db.session.add(svc)
    db.session.flush()
    return svc


def resolve_source(kind: SourceKind) -> DimSource:
    src = DimSource.query.filter_by(source_kind=kind).one_or_none()
    if src:
        return src
    src = DimSource(source_kind=kind, priority=50)
    db.session.add(src)
    db.session.flush()
    return src


# -------------------- Fact ingestion --------------------

def ingest_job(job: dict, loc: Location):
    """
    Transform a ServiceTrade job payload into FactServiceEvent row(s).
    This is simplified — adapt to your real fields.
    """
    job_id = int(job["id"])
    svc_name = (job.get("serviceLine") or {}) or "Unknown"
    svc = resolve_service(svc_name, recurring=True)
    src = resolve_source(SourceKind.HISTORICAL_JOB)

    completed_on = job.get("scheduledDate")
    if completed_on:
        completed_on = datetime.fromtimestamp(int(completed_on) / 1000, tz=timezone.utc)
        date_row = get_or_create_date(completed_on.date())
        date_id = date_row.id
    else:
        date_id = get_or_create_date(datetime.now(timezone.utc).date()).id

    ins = insert(FactServiceEvent).values(
        location_pk=loc.id,
        service_id=svc.id,
        date_id=date_id,
        source_id=src.id,
        job_id=job_id,
        completed_on=completed_on,
        hours_actual=job.get("hoursActual"),
        tech_count=job.get("techCount"),
        multi_day=job.get("multiDay"),
        multi_tech_required=job.get("multiTech"),
    )

    stmt = ins.on_conflict_do_update(
        index_elements=[FactServiceEvent.job_id],
        set_={
            "completed_on": ins.excluded.completed_on,
            "hours_actual": ins.excluded.hours_actual,
            "tech_count": ins.excluded.tech_count,
        },
    )
    db.session.execute(stmt)


# -------------------- Main --------------------

def main():
    parser = argparse.ArgumentParser(description="Backfill FactServiceEvent from ServiceTrade jobs")
    parser.add_argument("--location-id", type=int, help="Single location to backfill")
    parser.add_argument("--max-locations", type=int)
    parser.add_argument("--sleep", type=float, default=0.0)
    parser.add_argument("--commit-every", type=int, default=100)
    parser.add_argument("--no-progress", action="store_true")
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        username = os.getenv("PROCESSING_USERNAME")
        password = os.getenv("PROCESSING_PASSWORD")
        if not username or not password:
            raise SystemExit("Missing PROCESSING_USERNAME/PROCESSING_PASSWORD env vars.")
        authenticate(username, password)

        q = Location.query.filter(Location.status == "active")
        if args.location_id:
            q = q.filter(Location.location_id == args.location_id)
        if args.max_locations:
            q = q.limit(args.max_locations)

        locs = q.all()
        log.info("Processing %s locations", len(locs))

        processed = 0
        errors = 0
        with tqdm(locs, disable=args.no_progress, desc="Backfilling events") as pbar:
            for loc in pbar:
                try:
                    for job in stream_jobs_for_location(loc.location_id):
                        ingest_job(job, loc)

                    processed += 1
                    if processed % args.commit_every == 0:
                        db.session.commit()
                    if args.sleep:
                        time.sleep(args.sleep)

                except Exception as e:
                    db.session.rollback()
                    errors += 1
                    log.exception("Error on location %s: %s", loc.location_id, e)

        db.session.commit()
        log.info("Done. Locations processed=%s errors=%s", processed, errors)


if __name__ == "__main__":
    main()
