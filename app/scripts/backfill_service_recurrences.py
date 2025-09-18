# scripts/backfill_service_recurrences.py
import os
import argparse
import logging
import time
import requests
from tqdm import tqdm  # <-- progress bar
import json

from app import create_app
from app.db_models import db, Location, ServiceRecurrence
from app.routes.scheduling_attack import ingest_service_recurrence  # adjust if needed

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger("backfill")

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

def stream_recurrences_for_location(location_id: int, limit: int = 500):
    """Yield recurrence dicts for one location; stops when page returns < limit."""
    page = 1
    while True:
        params = {"locationIds": str(location_id), "page": page, "limit": limit}
        data = call_service_trade_api("servicerecurrence", params=params)
        recs = (data.get("serviceRecurrences")
                or data.get("data", {}).get("serviceRecurrences")
                or [])
        if not recs:
            break
        for r in recs:
            yield r
        if len(recs) < limit:
            break
        page += 1

# -------------------- Selection logic --------------------

def get_location_ids_to_process(only_missing: bool, include_inactive: bool, max_locations: int | None, start_after: int | None):
    q = db.session.query(Location.location_id)
    if not include_inactive:
        q = q.filter(Location.status == "active")

    if only_missing:
        # Only locations with NO row in service_recurrence
        q = (q.outerjoin(ServiceRecurrence, ServiceRecurrence.location_id == Location.location_id)
               .filter(ServiceRecurrence.location_id.is_(None)))

    if start_after:
        q = q.filter(Location.location_id > start_after)

    if max_locations:
        q = q.limit(max_locations)

    for (loc_id,) in q.yield_per(1000):
        yield loc_id

# -------------------- Main --------------------

def main():
    parser = argparse.ArgumentParser(description="Backfill ServiceRecurrence for all or one location")
    parser.add_argument("--location-id", type=int, help="Single ServiceTrade locationId to backfill")
    parser.add_argument("--limit", type=int, default=500, help="ServiceTrade page size")
    parser.add_argument("--only-missing", action="store_true", default=True, help="Process only locations not in service_recurrence")
    parser.add_argument("--include-inactive", action="store_true", help="Include inactive locations")
    parser.add_argument("--force", action="store_true", help="Force fetch even if a row already exists for the location")
    parser.add_argument("--commit-every", type=int, default=200, help="Commit after this many locations")
    parser.add_argument("--max-locations", type=int, help="Process at most N locations")
    parser.add_argument("--start-after", type=int, help="Resume: skip locations <= this id")
    parser.add_argument("--sleep", type=float, default=0.0, help="Seconds to sleep between locations (rate limit)")
    parser.add_argument("--no-progress", action="store_true", help="Disable progress bar (useful for CI)")
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        username = os.getenv("PROCESSING_USERNAME")
        password = os.getenv("PROCESSING_PASSWORD")
        if not username or not password:
            raise SystemExit("Missing PROCESSING_USERNAME/PROCESSING_PASSWORD environment vars.")
        authenticate(username, password)

        # Determine which locations to process
        if args.location_id:
            loc_ids = [args.location_id]
            total = 1
            # quick skip check for single id
            if not args.force:
                exists = db.session.query(ServiceRecurrence.location_id).filter_by(location_id=args.location_id).first()
                if exists:
                    log.info("Skipping location %s: already present (use --force to refetch).", args.location_id)
                    return
        else:
            loc_ids = list(get_location_ids_to_process(
                only_missing=not args.force and args.only_missing,
                include_inactive=args.include_inactive,
                max_locations=args.max_locations,
                start_after=args.start_after
            ))
            total = len(loc_ids)
            log.info("Locations to process: %s", total)

        processed = 0
        fetched = 0
        skipped = 0
        errors = 0

        # Main progress bar
        with tqdm(loc_ids, total=total, disable=args.no_progress, desc="Backfilling locations", mininterval=0.5) as pbar:
            for loc_id in pbar:
                # Short-circuit skip if not forcing
                if not args.force:
                    exists = db.session.query(ServiceRecurrence.location_id).filter_by(location_id=loc_id).first()
                    if exists:
                        skipped += 1
                        pbar.set_postfix(skipped=skipped, fetched=fetched, errors=errors)
                        if args.sleep:
                            time.sleep(args.sleep)
                        processed += 1
                        if processed % args.commit_every == 0:
                            db.session.commit()
                        continue

                try:
                    count_for_loc = 0
                    unique_rec = {}
                    for rec in stream_recurrences_for_location(loc_id, limit=args.limit):
                        # recurring services appear multiple times with different id's
                        # how can i tell if a recurrence is still active?
                        # if the ends on date has passed?
                        # According to the docs, if there is an endson date the recurrence is not active.
                        if rec.get("endsOn") is None:
                            unique_rec[rec["id"]] = rec

                        # ingest_service_recurrence(rec)  # upsert-by-location; filters annual only
                        fetched += 1
                        count_for_loc += 1

                    i = 1
                    print()
                    for rec in unique_rec.values():
                        print(f"[{i}] SL: {rec['serviceLine']['name']} [id]: {rec["serviceLine"]["id"]}, \n{rec["description"]}")
                        i += 1

                    processed += 1
                    if processed % args.commit_every == 0:
                        db.session.commit()

                    # live feedback on the bar
                    pbar.set_postfix(last_loc=loc_id, recs=count_for_loc, fetched=fetched, skipped=skipped, errors=errors)

                except requests.HTTPError as http_err:
                    db.session.rollback()
                    errors += 1
                    log.error("HTTP error on location %s: %s", loc_id, http_err)
                    pbar.set_postfix(last_loc=loc_id, fetched=fetched, skipped=skipped, errors=errors)

                except Exception as e:
                    db.session.rollback()
                    errors += 1
                    log.exception("Error processing location %s: %s", loc_id, e)
                    pbar.set_postfix(last_loc=loc_id, fetched=fetched, skipped=skipped, errors=errors)

                if args.sleep:
                    time.sleep(args.sleep)

        db.session.commit()
        log.info("Done. Locations processed: %s | skipped: %s | recurrences fetched: %s | errors: %s",
                 processed, skipped, fetched, errors)

if __name__ == "__main__":
    main()
