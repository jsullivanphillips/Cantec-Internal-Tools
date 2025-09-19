# scripts/update_service_events.py
import os
import argparse
import logging
import time
import re
import requests
from tqdm import tqdm
from datetime import datetime, timezone, timedelta, date
from collections import defaultdict
from sqlalchemy.dialects.postgresql import insert as pg_insert
from zoneinfo import ZoneInfo
import json

from app import create_app
from app.db_models import db, Location, ServiceOccurrence


logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger("backfill")

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
api_session = requests.Session()
api_session.headers.update({"Accept": "application/json"})

SPRINKLER_TECHS_NAMES = ["Colin Peterson", "Justin Walker"]

JOB_SEARCH_RANGE = datetime.now(timezone.utc).replace(year=datetime.now(timezone.utc).year - 1)

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

def stream_jobs_for_location(location_id: int, limit: int = 500):
    """Yield job dicts for one location; stops when page returns < limit."""
    page = 0
    while True:
        params = {"locationId": str(location_id), "page": page, "limit": limit, 
                  "scheduleDateFrom": JOB_SEARCH_RANGE.timestamp(), "scheduleDateTo": datetime.now(timezone.utc).timestamp(),
                  "status": "completed"
        }
        data = call_service_trade_api("job", params=params)
        jobs = (data.get("jobs")
                or data.get("data", {}).get("jobs")
                or [])
        if not jobs:
            break
        for j in jobs:
            yield j
        if len(jobs) < limit:
            break
        page += 1


def epoch_to_aware(epoch: int, tz=ZoneInfo("America/Vancouver")) -> datetime:
    return datetime.fromtimestamp(int(epoch), tz=timezone.utc).astimezone(tz)


def stream_canceled_inspection_jobs_for_location(location_id: int, limit: int = 500):
    """Yield canceled inspection job dicts for one location; stops when page returns < limit."""
    page = 0
    while True:
        params = {"locationId": str(location_id), "page": page, "limit": limit, 
                  "scheduleDateFrom": JOB_SEARCH_RANGE.replace(year=datetime.now(timezone.utc).year - 2).timestamp(), "scheduleDateTo": datetime.now(timezone.utc),
                  "status": "canceled",
                  "type": "inspection"
        }
        data = call_service_trade_api("job", params=params)
        jobs = (data.get("jobs")
                or data.get("data", {}).get("jobs")
                or [])
        if not jobs:
            break
        for j in jobs:
            yield j
        if len(jobs) < limit:
            break
        page += 1

def stream_old_inspection_jobs_for_location(location_id: int, limit: int = 500):
    """Yield job dicts for one location; stops when page returns < limit."""
    page = 0
    while True:
        params = {"locationId": str(location_id), "page": page, "limit": limit, 
                  "scheduleDateFrom": JOB_SEARCH_RANGE.replace(year=datetime.now(timezone.utc).year - 2).timestamp(), "scheduleDateTo": JOB_SEARCH_RANGE.timestamp(),
                  "status": "completed",
                  "type": "inspection"
        }
        data = call_service_trade_api("job", params=params)
        jobs = (data.get("jobs")
                or data.get("data", {}).get("jobs")
                or [])
        if not jobs:
            break
        for j in jobs:
            yield j
        if len(jobs) < limit:
            break
        page += 1


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

def stream_appointments_for_job(job_id: int, limit: int = 500):
    """Yield appointment dicts for one job; stops when page returns < limit."""
    page = 0
    while True:
        params = {"jobId": str(job_id), "page": page, "limit": limit}
        data = call_service_trade_api("appointment", params=params)
        appts = (data.get("appointments")
                or data.get("data", {}).get("appointments")
                or [])
        if not appts:
            break
        for a in appts:
            yield a
        if len(appts) < limit:
            break
        page += 1

def stream_clockevents_for_job(job_id: int, limit: int = 500):
    """Yield clockevent dicts for one job; stops when page returns < limit."""
    page = 0
    while True:
        params = {"page": page, "limit": limit}
        data = call_service_trade_api(f"job/{job_id}/clockevent", params=params)
        events = (data.get("pairedEvents")
                or data.get("data", {}).get("pairedEvents")
                or [])
        if not events:
            break
        for e in events:
            yield e
        if len(events) < limit:
            break
        page += 1


def _travel_time_for_location(location_id: int) -> int | None:
    """
    GET /location/{locationId}
    Tags are dicts with a 'name' field.
    Pattern: ... 't' <hours>, where hours may use underscore as decimal (e.g., t1_5 = 1.5h).
    Returns one-way travel time in MINUTES (int), not roundtrip.
    """
    r = api_session.get(f"{SERVICE_TRADE_API_BASE}/location/{location_id}")
    r.raise_for_status()
    payload = r.json()
    tags = payload.get("data", {}).get("tags") or payload.get("tags") or []
    if not isinstance(tags, list):
        return None

    candidates_min = []

    for tag in tags:
        name = (tag.get("name") or "").strip().lower()
        if not name:
            continue

        # Find t<hours> where hours is N or N_M (underscore as decimal, max 2 decimals)
        # Examples matched: "t2", "t0_5", "something_123_t1_5", "t10_25"
        for m in re.finditer(r"(?<![a-z])t(\d+(?:_\d{1,2})?)(?!\d)", name):
            tok = m.group(1)  # e.g., "1_5" or "2"
            if "_" in tok:
                whole, frac = tok.split("_", 1)
                try:
                    hours = float(f"{int(whole)}.{frac}")
                except Exception:
                    continue
            else:
                try:
                    hours = float(tok)
                except Exception:
                    continue

            minutes = int(round(hours * 60))
            # sanity: 1 min .. 12h (720 min)
            if 1 <= minutes <= 720:
                candidates_min.append(minutes)

    if not candidates_min:
        return 30
    return max(candidates_min)

import re

def parse_fa_techs_tag(location_id: int) -> int:
    """
    Query ServiceTrade for a location's tags and extract number of Fire Alarm techs.

    Tag patterns supported (case-insensitive, underscores or hyphens allowed):
      - "1_Tech", "2_Tech", "3_Tech"
      - Variants: "fa-2_tech", "prep 3-tech", etc.

    Returns the number of techs (int). If multiple matches exist, returns the max.
    If no valid FA tech tag is found, returns 0.
    """
    r = api_session.get(f"{SERVICE_TRADE_API_BASE}/location/{location_id}")
    r.raise_for_status()
    payload = r.json()
    tags = payload.get("data", {}).get("tags") or payload.get("tags") or []
    if not isinstance(tags, list):
        return 0

    candidates: list[int] = []
    tech_pat = re.compile(r"(\d+)[_-]?tech", re.IGNORECASE)

    for tag in tags:
        name = (tag.get("name") or "").strip().lower()
        if not name:
            continue

        for m in tech_pat.finditer(name):
            try:
                techs = int(m.group(1))
            except Exception:
                continue
            if 1 <= techs <= 20:  # sanity check, unlikely to have >20 techs
                candidates.append(techs)

    if not candidates:
        return 0
    return max(candidates)


def _to_aware_utc(ts):
    """
    Accepts Unix seconds (int/float) or ISO8601 string; returns tz-aware UTC datetime.
    Returns None if input is None.
    """
    if ts is None:
        return None
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    if isinstance(ts, str):
        # Try ISO8601; fall back to int seconds if string is purely digits
        s = ts.strip()
        if s.isdigit():
            return datetime.fromtimestamp(int(s), tz=timezone.utc)
        # naive parse -> assume UTC
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except Exception:
            # last resort: treat as seconds
            return datetime.fromtimestamp(float(s), tz=timezone.utc)
        # If still naive, set UTC
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt
    # If already datetime -> force UTC
    if isinstance(ts, datetime):
        if ts.tzinfo is None:
            return ts.replace(tzinfo=timezone.utc)
        return ts.astimezone(timezone.utc)
    return None

def _month_floor_utc(ts):
    """
    Given a unix ts / string / datetime, return date(year, month, 1) in UTC.
    Returns None if ts is None.
    """
    dt = _to_aware_utc(ts)
    if dt is None:
        return None
    return date(dt.year, dt.month, 1)


def parse_fa_timing_tag(location_id: int) -> tuple[float, float]:
    """
    Query ServiceTrade for a location's tags and extract Fire Alarm timing.

    Tag patterns supported (case-insensitive, underscores as decimals):
      - DAY-based: "<N>d|day|days" with optional "+/-<H>h|hour|hours" and optional "t<F>"
        where 't<F>' is *extra fractional day* only if the day part isn't already fractional.
        Examples: "FA_1day", "1day-2hours", "fa_1dayt0_5", "prep 2days+1hour"

      - HOUR-only: "<N>[h|hour|hours]"  
        We also accept hour-only without the 'h' *if* the tag contains 'fa' somewhere.
        Examples: "fa_1_5h", "fa-2hours", "fa_1_5"

    Returns:
        (days, hours) as a tuple of floats.
        If no valid FA timing is found, returns (0.0, 0.0).
    """
    r = api_session.get(f"{SERVICE_TRADE_API_BASE}/location/{location_id}")
    r.raise_for_status()
    payload = r.json()
    tags = payload.get("data", {}).get("tags") or payload.get("tags") or []
    if not isinstance(tags, list):
        return (0.0, 0.0)

    candidates: list[tuple[float, float]] = []

    # DAY-based pattern
    day_pat = re.compile(
        r"(?<![a-z])"                          # not letter before
        r"(\d+(?:_\d{1,2})?)\s*d(?:ay)?s?"     # days
        r"(?:\s*([+-]?\d+(?:_\d{1,2})?)\s*h(?:our)?s?)?"  # optional +/- hours
        r"(?:\s*t(\d+(?:_\d{1,2})?))?",        # optional t<fraction-of-day>
        re.IGNORECASE,
    )

    # Hour-only with explicit unit
    hour_with_unit_pat = re.compile(
        r"(?<![a-z])(\d+(?:_\d{1,2})?)\s*h(?:our)?s?(?![a-z])",
        re.IGNORECASE,
    )

    # Hour-only numeric (no unit) but only if the tag looks FA-related
    hour_numeric_pat = re.compile(
        r"(?<![a-z])(\d+(?:_\d{1,2})?)(?![a-z0-9])",
        re.IGNORECASE,
    )

    for tag in tags:
        name = (tag.get("name") or "").strip().lower()
        if not name:
            continue

        # 1) DAY-based matches
        for m in day_pat.finditer(name):
            day_part = m.group(1).replace("_", ".")
            try:
                days = float(day_part)
            except Exception:
                continue

            # Add trailing fraction-of-day only if day part isn't already fractional
            if m.group(3) and "." not in day_part:
                try:
                    days += float(m.group(3).replace("_", "."))
                except Exception:
                    pass

            hours = days * 8.0

            if m.group(2):
                try:
                    hours += float(m.group(2).replace("_", "."))
                except Exception:
                    pass

            if 0.0 <= hours <= 720.0:
                candidates.append((days, hours))

        # 2) Hour-only with unit
        for m in hour_with_unit_pat.finditer(name):
            tok = m.group(1).replace("_", ".")
            try:
                hours = float(tok)
            except Exception:
                continue
            if 0.0 <= hours <= 720.0:
                candidates.append((0.0, hours))

        # 3) Hour-only numeric without unit (only if FA-related)
        if "fa" in name:
            for m in hour_numeric_pat.finditer(name):
                tok = m.group(1).replace("_", ".")
                try:
                    hours = float(tok)
                except Exception:
                    continue
                if 0.0 <= hours <= 720.0:
                    candidates.append((0.0, hours))

    if not candidates:
        return (0.0, 0.0)

    # Return the candidate with the largest hours
    return max(candidates, key=lambda x: x[1])


def parse_spr_tag(location_id: int) -> tuple[int, float]:
    """
    Query ServiceTrade for a location's tags and extract Sprinkler staffing.

    Pattern (case-insensitive, underscores as decimals), found *anywhere*:
      - "spr_<techs>x<hours>"
        Examples: "Spr_1x5_5", "note-spr_2x6", "prep_spr-3x1_25"

    Returns (num_techs, hours). If no valid SPR tag is found, returns (0, 0.0).
    If multiple matches exist, returns the one with the largest hours (tie-breaker: larger techs).
    """
    r = api_session.get(f"{SERVICE_TRADE_API_BASE}/location/{location_id}")
    r.raise_for_status()
    payload = r.json()
    tags = payload.get("data", {}).get("tags") or payload.get("tags") or []
    if not isinstance(tags, list):
        return (0, 0.0)

    best_techs, best_hours = 0, 0.0
    spr_pat = re.compile(r"spr[_-]?(\d+)x(\d+(?:_\d{1,2})?)", re.IGNORECASE)

    for tag in tags:
        name = (tag.get("name") or "").strip().lower()
        if not name:
            continue

        for m in spr_pat.finditer(name):
            try:
                techs = int(m.group(1))
            except Exception:
                techs = 0
            try:
                hours = float(m.group(2).replace("_", "."))
            except Exception:
                hours = 0.0

            if (hours, techs) > (best_hours, best_techs):
                best_techs, best_hours = techs, hours

    return (best_techs, best_hours)

    
# -------------------- Selection logic --------------------

def get_location_ids_to_process(include_inactive: bool, max_locations: int | None):
    q = db.session.query(Location.location_id)
    if not include_inactive:
        q = q.filter(Location.status == "active")

    if max_locations:
        q = q.limit(max_locations)

    for (loc_id,) in q.yield_per(1000):
        yield loc_id

def _safe_ts(appt):
    return appt.get("event_time") or appt.get("scheduled_on") or 0

def _fmt_ts(ts: int | None, fmt: str = "%Y-%m-%d") -> str:
    """Format a unix timestamp or return a placeholder if None."""
    if ts is None:
        return "Not Completed"
    return datetime.fromtimestamp(ts).strftime(fmt)

def is_relevant_annual_recurrence(rec: dict) -> bool:
    if rec.get("frequency") != "yearly" or int(rec.get("interval", 0)) != 1:
        return False
    # Optional: tighten to fire alarm only (uncomment/customize)
    sl_id = (rec.get("serviceLine") or {}).get("id", "")  # e.g., "Fire Alarm", "Fire Sprinkler", "Fire Suppression"
    if sl_id not in {1, 2, 3, 168, 556}:
        return False
    return True


def upsert_service_occurrences(rows: list[dict]) -> int:
    """
    Bulk UPSERT into service_occurrence on (job_id).
    Returns number of rows attempted (inserted or updated).
    """
    if not rows:
        return 0

    # Map the incoming dicts onto the table columns with normalization
    normalized = []
    for r in rows:
        normalized.append({
            # Required
            "job_id":                      r["job_id"],
            "location_id":                 r["location_id"],
            "observed_month":              _month_floor_utc(r.get("observed_month")),

            # Identity / helpful labels
            "job_type":                    r.get("job_type"),

            # Lifecycle (tz-aware UTC)
            "job_created_at":              _to_aware_utc(r.get("job_created_at")),
            "scheduled_for":               _to_aware_utc(r.get("scheduled_for")),
            "completed_at":                _to_aware_utc(r.get("completed_at")),

            # Classification
            "is_recurring":                bool(r.get("is_recurring")),

            # Hours
            "spr_hours_actual":            r.get("spr_hours_actual"),
            "fa_hours_actual":             r.get("fa_hours_actual"),

            # Scheduling meta
            "number_of_fa_days":           int(r.get("number_of_fa_days") or 0),
            "number_of_spr_days":          int(r.get("number_of_spr_days") or 0),
            "number_of_fa_techs":          int(r.get("number_of_fa_techs") or 0),
            "number_of_spr_techs":          int(r.get("number_of_spr_techs") or 0),

            # Travel
            "travel_minutes_per_appt":     r.get("travel_minutes_per_appt"),
            "travel_minutes_total":        r.get("travel_minutes_total"),

            # Status snapshot
            "status":                      r.get("status") or "created",

            # Location mark
            "location_on_hold":            bool(r.get("location_on_hold")),

            # Provenance / extras (optional)
            "source":                      r.get("source") or "servicetrade",
            "tags_json":                   r.get("tags_json"),
            "meta":                        r.get("meta"),
        })

    table = ServiceOccurrence.__table__

    # Build ON CONFLICT (job_id) DO UPDATE SET ...
    stmt = pg_insert(table).values(normalized)
    # Columns we want to update on conflict (skip PK and server-maintained cols)
    excluded = stmt.excluded
    update_cols = {
        c.name: getattr(excluded, c.name)
        for c in table.columns
        if c.name not in ("id", "row_inserted_at")  # do not touch PK or inserted-at
    }
    # Keep row_updated_at via server_default/onupdate

    stmt = stmt.on_conflict_do_update(
        index_elements=["job_id"],
        set_=update_cols,
    )

    db.session.execute(stmt)
    db.session.commit()
    return len(normalized)


def _flush_occurrence_rows(buffer: list[dict], *, test_mode: bool) -> int:
    """
    Flush pending ServiceOccurrence rows using upsert_service_occurrences.
    Returns number of rows flushed. Does nothing in test_mode.
    """
    if not buffer:
        return 0
    rows = buffer[:]
    buffer.clear()
    if test_mode:
        return len(rows)
    try:
        upserted = upsert_service_occurrences(rows)  # this commits internally
        return upserted
    except Exception:
        db.session.rollback()
        raise


def main():
    parser = argparse.ArgumentParser(description="Update service events for all locations or a specific location from ServiceTrade.")
    parser.add_argument("--location-id", type=int, help="Single ServiceTrade locationId to backfill")
    parser.add_argument("--force", action="store_true", help="Force fetch even if a row already exists for the location")
    parser.add_argument("--include-inactive", action="store_true", help="Include inactive locations")
    parser.add_argument("--max-locations", type=int, help="Process at most N locations")
    parser.add_argument("--commit-every", type=int, default=200, help="Commit after this many locations")
    parser.add_argument("--no-progress", action="store_true", help="Disable progress bar (useful for CI)")
    parser.add_argument("--sleep", type=float, default=0.0, help="Seconds to sleep between locations (rate limit)")
    parser.add_argument("--test", action="store_true", help="Test mode: fetch but do not write to DB")
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        username = os.getenv("PROCESSING_USERNAME")
        password = os.getenv("PROCESSING_PASSWORD")
        if not username or not password:
            raise SystemExit("Missing PROCESSING_USERNAME/PROCESSING_PASSWORD environment vars.")
        authenticate(username, password)


        if args.location_id:
            loc_ids = [args.location_id]
        else:
            loc_ids = list(get_location_ids_to_process(
                    include_inactive=args.include_inactive,
                    max_locations=args.max_locations,
                ))
        
        total = len(loc_ids)
        log.info("Locations to process: %s", total)


        loc_processed = 0
        job_processed = 0
        skipped = 0
        errors = 0
        insert_vals_list = []
        # Main progress bar
        with tqdm(loc_ids, total=total, disable=args.no_progress, desc="Backfilling locations", mininterval=0.5) as pbar:
            for loc_id in pbar:
                resp = call_service_trade_api(f"location/{loc_id}")
                location_name = resp.get("data").get("address").get("street")
                jobs_at_location = []
                inspection_job_found = False
                is_location_on_hold = False

                resp = call_service_trade_api(f"location/{loc_id}")
                tags = resp.get("data").get("tags")
                for tag in tags:
                    if tag.get("name") == "On_Hold":
                        is_location_on_hold = True

                try:
                    for jobs in stream_jobs_for_location(loc_id):
                        appointments_data = {}
                        job_type = jobs.get("type")
                        scheduled_on = jobs.get("scheduledDate")
                        job_id = jobs.get("id")
                        created_at = jobs.get("created")
                        completed_on = jobs.get("completedOn")
                        travel_time = _travel_time_for_location(loc_id)
                        num_unique_tech_appt = 0
                        status = jobs.get("status")
                        location_name = jobs.get("location").get("address").get("street")

                        if job_type == "inspection":
                            inspection_job_found = True

                        is_recurring = False
                        if job_type in ["inspection", "planned_maintenance", "preventive_maintenance"]:
                            is_recurring = True

                        num_appts = 0
                        appointments_iter = iter(stream_appointments_for_job(job_id))
                        first_appt = next(appointments_iter, None)
                        if first_appt is None:
                            # No appointments: keep all minutes & streaks at 0; still emit a record if you want
                            # or skip this job entirely:
                            log.info("Job %s has no appointments; skipping streak/time calc.", job_id)
                            # Consider skipping:
                            skipped += 1
                            continue
                            # Or, if you want to process anyway: seed the loop with an empty list
                            appts_source = []
                        else:
                            appts_source = [first_appt]
                            appts_source.extend(appointments_iter)

                        earliest_appt_ts = None
                        for appts in appts_source:
                            is_spr_appt = False
                            services_on_appt = appts.get("serviceRequests", []) or []
                            techs_on_appt = appts.get("techs", []) or []
                            if not techs_on_appt:
                                # No techs yet → keep FA/SPR sets empty; still record appointment so day aggregation works
                                log.debug("Job %s appt %s has no techs assigned yet.", job_id, appts.get("id"))

                            # classify appointment type and collect techs by role
                            for service in services_on_appt:
                                if service.get("serviceLine", {}).get("id") == 6:  # Backflows - (sprinkler)
                                    is_spr_appt = True

                            fa_techs = set()
                            spr_techs = set()
                            for tech in techs_on_appt:
                                name = (tech.get("name") or "").strip()
                                num_unique_tech_appt += 1
                                if not name:
                                    continue
                                if name in SPRINKLER_TECHS_NAMES:
                                    spr_techs.add(name)
                                else:
                                    fa_techs.add(name)
                            
                            appt_scheduled_on = appts.get("windowStart")
                            if appt_scheduled_on is not None:
                                earliest_appt_ts = appt_scheduled_on if earliest_appt_ts is None else min(earliest_appt_ts, appt_scheduled_on)

                            appointments_data[appts.get("id")] = {
                                "scheduled_on": scheduled_on,
                                "is_spr_appt": is_spr_appt,
                                "elapsed_time": 0,
                                "only_spr_techs_on_appt": (len(fa_techs) == 0 and len(spr_techs) > 0),
                                "fa_techs": fa_techs,
                                "spr_techs": spr_techs,
                                # event_time filled in later from clockevents
                            }

                            num_appts += 1

                        # If multiple appts and one has only spr techs on it → that appt is sprinkler
                        if num_appts > 1:
                            for appt_id in appointments_data.keys():
                                if appointments_data[appt_id]["only_spr_techs_on_appt"]:
                                    appointments_data[appt_id]["is_spr_appt"] = True
                        
                        if earliest_appt_ts is not None:
                            scheduled_on = earliest_appt_ts

                        # Accumulate time + stamp event_time
                        had_clockevents = False
                        if num_appts > 0:
                            for ce in stream_clockevents_for_job(job_id):
                                if not ce:
                                    continue
                                start = ce.get("start") or {}
                                if start.get("activity") != "onsite":
                                    continue

                                appt_info = start.get("appointment") or {}
                                appt_id = appt_info.get("id")
                                if appt_id not in appointments_data:
                                    # Defensive: clockevent references appt we didn't collect (rare but possible)
                                    log.debug("Job %s clockevent refers to unknown appt id %s", job_id, appt_id)
                                    continue

                                
                                appointments_data[appt_id]["elapsed_time"] += ce.get("elapsedTime", 0) or 0
                                appointments_data[appt_id]["event_time"] = start.get("eventTime")
                                had_clockevents = True
                        
                        if not had_clockevents:
                            log.debug("Job %s has no onsite clock events.", job_id)
                            # Ensure each appt has a fallback event_time so sorting and day logic works
                            for appt in appointments_data.values():
                                if appt.get("event_time") is None:
                                    appt["event_time"] = appt.get("scheduled_on")  # fallback to scheduled timestamp (unix)


                        # ---------- NEW: compute required FA/SPR tech counts ----------
                        fa_techs_by_day = defaultdict(set)
                        spr_techs_by_day = defaultdict(set)

                        for appt_id, appt in appointments_data.items():
                            # prefer event_time; fallback to scheduled_on if missing
                            ts = appt.get("event_time")
                            if ts is not None:
                                day = datetime.fromtimestamp(ts).date()
                            else:
                                day = datetime.fromtimestamp(appt["scheduled_on"]).date()

                            # Aggregate unique tech names per day
                            if appt.get("fa_techs"):
                                fa_techs_by_day[day].update(appt["fa_techs"])
                            if appt.get("spr_techs"):
                                spr_techs_by_day[day].update(appt["spr_techs"])
                        
                        fa_techs_required = max((len(s) for s in fa_techs_by_day.values()), default=0)
                        

                        # SPR: take max unique sprinkler techs seen on any single day (no cap; add min(2, ...) if you want symmetry)
                        spr_techs_required = max((len(s) for s in spr_techs_by_day.values()), default=0)
                        
                        num_fa_minutes = 0.0
                        num_spr_minutes = 0.0

                        num_consecutive_fa_days = 0   # longest FA streak in days
                        num_consecutive_spr_days = 0  # longest SPR streak in days
                        cur_fa_streak = 0
                        cur_spr_streak = 0
                        prev_fa_day = None
                        prev_spr_day = None

                        # iterate in chronological order
                        for appt_id in sorted(appointments_data, key=lambda k: _safe_ts(appointments_data[k])):
                            appt = appointments_data[appt_id]
                            ts = _safe_ts(appt)
                            if not ts:
                                # nothing to work with; skip safely
                                log.debug("Job %s appt %s has no usable timestamp.", job_id, appt_id)
                                continue
                            day = datetime.fromtimestamp(ts).date()

                            if appt["is_spr_appt"]:
                                num_spr_minutes += appt["elapsed_time"]

                                if prev_spr_day is None:
                                    cur_spr_streak = 1
                                else:
                                    if day == prev_spr_day:                      # same calendar day → don't change streak
                                        pass
                                    elif day == prev_spr_day + timedelta(days=1):# consecutive next day
                                        cur_spr_streak += 1
                                    else:                                        # gap → reset
                                        cur_spr_streak = 1

                                prev_spr_day = day
                                num_consecutive_spr_days = max(num_consecutive_spr_days, cur_spr_streak)

                            else:
                                num_fa_minutes += appt["elapsed_time"]

                                if prev_fa_day is None:
                                    cur_fa_streak = 1
                                else:
                                    if day == prev_fa_day:
                                        pass
                                    elif day == prev_fa_day + timedelta(days=1):
                                        cur_fa_streak += 1
                                    else:
                                        cur_fa_streak = 1

                                prev_fa_day = day
                                num_consecutive_fa_days = max(num_consecutive_fa_days, cur_fa_streak)
                        

                        
                        
                        insert_vals = {
                            "location_name": location_name,
                            "job_id": job_id,
                            "location_id": loc_id,
                            "job_type": job_type,
                            "job_created_at": created_at,
                            "scheduled_for": scheduled_on,
                            "completed_at": completed_on,
                            "observed_month": scheduled_on, # convert to first of month
                            "is_recurring": is_recurring,
                            "spr_hours_actual": num_spr_minutes/3600,
                            "fa_hours_actual": num_fa_minutes/3600,
                            "number_of_fa_days": num_consecutive_fa_days,
                            "number_of_spr_days": num_consecutive_spr_days,
                            "number_of_fa_techs": fa_techs_required,
                            "number_of_spr_techs": spr_techs_required,
                            "travel_minutes_per_appt": travel_time,
                            "travel_minutes_total": travel_time * num_unique_tech_appt,
                            "status": status,
                            "meta": "timing from past job",
                            "location_on_hold": is_location_on_hold
                        }
                        insert_vals_list.append(insert_vals)
                        job_processed += 1
                        pbar.set_postfix(last_loc=loc_id, jobs=job_processed, skipped=skipped, errors=errors)

                except requests.HTTPError as http_err:
                    db.session.rollback()
                    errors += 1
                    log.error("HTTP error on location %s: %s", loc_id, http_err)
                    pbar.set_postfix(last_loc=loc_id, jobs=job_processed, skipped=skipped, errors=errors)

                except Exception as e:
                    db.session.rollback()
                    errors += 1
                    log.exception("Error processing location %s: %s", loc_id, e)
                    pbar.set_postfix(last_loc=loc_id, jobs=job_processed, skipped=skipped, errors=errors)
                
                # Logic branch for checking if there are no past annual inspections jobs for the location
                # Step 1 - Check if the last annual inspection was cancelled - we will want to flag this location
                if not inspection_job_found:
                    try:
                        for jobs in stream_canceled_inspection_jobs_for_location(loc_id):
                            if jobs is not None:
                                print("found a cancelled annual!")
                                is_location_on_hold = True

                    except requests.HTTPError as http_err:
                        db.session.rollback()
                        errors += 1
                        log.error("HTTP error on location %s: %s", loc_id, http_err)
                        pbar.set_postfix(last_loc=loc_id, jobs=job_processed, skipped=skipped, errors=errors)

                    except Exception as e:
                        db.session.rollback()
                        errors += 1
                        log.exception("Error processing location %s: %s", loc_id, e)
                        pbar.set_postfix(last_loc=loc_id, jobs=job_processed, skipped=skipped, errors=errors)

                # Step 2 - Expand search to 2 years just for inspection jobs
                if not inspection_job_found:
                    try:
                        for jobs in stream_old_inspection_jobs_for_location(loc_id):
                            appointments_data = {}
                            job_type = jobs.get("type")
                            scheduled_on = jobs.get("scheduledDate")
                            job_id = jobs.get("id")
                            created_at = jobs.get("created")
                            completed_on = jobs.get("completedOn")
                            travel_time = _travel_time_for_location(loc_id)
                            num_unique_tech_appt = 0
                            status = jobs.get("status")
                            

                            if job_type == "inspection":
                                inspection_job_found = True


                            is_recurring = False
                            if job_type in ["inspection", "planned_maintenance", "preventive_maintenance"]:
                                is_recurring = True

                            num_appts = 0
                            appointments_iter = iter(stream_appointments_for_job(job_id))
                            first_appt = next(appointments_iter, None)
                            if first_appt is None:
                                # No appointments: keep all minutes & streaks at 0; still emit a record if you want
                                # or skip this job entirely:
                                log.info("Job %s has no appointments; skipping streak/time calc.", job_id)
                                # Consider skipping:
                                skipped += 1
                                continue
                                # Or, if you want to process anyway: seed the loop with an empty list
                                appts_source = []
                            else:
                                appts_source = [first_appt]
                                appts_source.extend(appointments_iter)

                            earliest_appt_ts = None
                            for appts in appts_source:
                                is_spr_appt = False
                                services_on_appt = appts.get("serviceRequests", []) or []
                                techs_on_appt = appts.get("techs", []) or []
                                if not techs_on_appt:
                                    # No techs yet → keep FA/SPR sets empty; still record appointment so day aggregation works
                                    log.debug("Job %s appt %s has no techs assigned yet.", job_id, appts.get("id"))

                                # classify appointment type and collect techs by role
                                for service in services_on_appt:
                                    if service.get("serviceLine", {}).get("id") == 6:  # Backflows - (sprinkler)
                                        is_spr_appt = True

                                fa_techs = set()
                                spr_techs = set()
                                for tech in techs_on_appt:
                                    name = (tech.get("name") or "").strip()
                                    num_unique_tech_appt += 1
                                    if not name:
                                        continue
                                    if name in SPRINKLER_TECHS_NAMES:
                                        spr_techs.add(name)
                                    else:
                                        fa_techs.add(name)
                                
                                appt_scheduled_on = appts.get("windowStart")
                                if appt_scheduled_on is not None:
                                    earliest_appt_ts = appt_scheduled_on if earliest_appt_ts is None else min(earliest_appt_ts, appt_scheduled_on)

                                appointments_data[appts.get("id")] = {
                                    "scheduled_on": scheduled_on,
                                    "is_spr_appt": is_spr_appt,
                                    "elapsed_time": 0,
                                    "only_spr_techs_on_appt": (len(fa_techs) == 0 and len(spr_techs) > 0),
                                    "fa_techs": fa_techs,
                                    "spr_techs": spr_techs,
                                    # event_time filled in later from clockevents
                                }

                                num_appts += 1

                            # If multiple appts and one has only spr techs on it → that appt is sprinkler
                            if num_appts > 1:
                                for appt_id in appointments_data.keys():
                                    if appointments_data[appt_id]["only_spr_techs_on_appt"]:
                                        appointments_data[appt_id]["is_spr_appt"] = True
                            
                            if earliest_appt_ts is not None:
                                scheduled_on = earliest_appt_ts

                            # Accumulate time + stamp event_time
                            had_clockevents = False
                            if num_appts > 0:
                                for ce in stream_clockevents_for_job(job_id):
                                    if not ce:
                                        continue
                                    start = ce.get("start") or {}
                                    if start.get("activity") != "onsite":
                                        continue

                                    appt_info = start.get("appointment") or {}
                                    appt_id = appt_info.get("id")
                                    if appt_id not in appointments_data:
                                        # Defensive: clockevent references appt we didn't collect (rare but possible)
                                        log.debug("Job %s clockevent refers to unknown appt id %s", job_id, appt_id)
                                        continue

                                    
                                    appointments_data[appt_id]["elapsed_time"] += ce.get("elapsedTime", 0) or 0
                                    appointments_data[appt_id]["event_time"] = start.get("eventTime")
                                    had_clockevents = True
                            
                            if not had_clockevents:
                                log.debug("Job %s has no onsite clock events.", job_id)
                                # Ensure each appt has a fallback event_time so sorting and day logic works
                                for appt in appointments_data.values():
                                    if appt.get("event_time") is None:
                                        appt["event_time"] = appt.get("scheduled_on")  # fallback to scheduled timestamp (unix)


                            # ---------- NEW: compute required FA/SPR tech counts ----------
                            fa_techs_by_day = defaultdict(set)
                            spr_techs_by_day = defaultdict(set)

                            for appt_id, appt in appointments_data.items():
                                # prefer event_time; fallback to scheduled_on if missing
                                ts = appt.get("event_time")
                                if ts is not None:
                                    day = datetime.fromtimestamp(ts).date()
                                else:
                                    day = datetime.fromtimestamp(appt["scheduled_on"]).date()

                                # Aggregate unique tech names per day
                                if appt.get("fa_techs"):
                                    fa_techs_by_day[day].update(appt["fa_techs"])
                                if appt.get("spr_techs"):
                                    spr_techs_by_day[day].update(appt["spr_techs"])
                            
                            fa_techs_required = max((len(s) for s in fa_techs_by_day.values()), default=0)
                            

                            # SPR: take max unique sprinkler techs seen on any single day (no cap; add min(2, ...) if you want symmetry)
                            spr_techs_required = max((len(s) for s in spr_techs_by_day.values()), default=0)
                            
                            num_fa_minutes = 0.0
                            num_spr_minutes = 0.0

                            num_consecutive_fa_days = 0   # longest FA streak in days
                            num_consecutive_spr_days = 0  # longest SPR streak in days
                            cur_fa_streak = 0
                            cur_spr_streak = 0
                            prev_fa_day = None
                            prev_spr_day = None

                            # iterate in chronological order
                            for appt_id in sorted(appointments_data, key=lambda k: _safe_ts(appointments_data[k])):
                                appt = appointments_data[appt_id]
                                ts = _safe_ts(appt)
                                if not ts:
                                    # nothing to work with; skip safely
                                    log.debug("Job %s appt %s has no usable timestamp.", job_id, appt_id)
                                    continue
                                day = datetime.fromtimestamp(ts).date()

                                if appt["is_spr_appt"]:
                                    num_spr_minutes += appt["elapsed_time"]

                                    if prev_spr_day is None:
                                        cur_spr_streak = 1
                                    else:
                                        if day == prev_spr_day:                      # same calendar day → don't change streak
                                            pass
                                        elif day == prev_spr_day + timedelta(days=1):# consecutive next day
                                            cur_spr_streak += 1
                                        else:                                        # gap → reset
                                            cur_spr_streak = 1

                                    prev_spr_day = day
                                    num_consecutive_spr_days = max(num_consecutive_spr_days, cur_spr_streak)

                                else:
                                    num_fa_minutes += appt["elapsed_time"]

                                    if prev_fa_day is None:
                                        cur_fa_streak = 1
                                    else:
                                        if day == prev_fa_day:
                                            pass
                                        elif day == prev_fa_day + timedelta(days=1):
                                            cur_fa_streak += 1
                                        else:
                                            cur_fa_streak = 1

                                    prev_fa_day = day
                                    num_consecutive_fa_days = max(num_consecutive_fa_days, cur_fa_streak)
                            

                            
                            insert_vals = {
                                "location_name": location_name,
                                "job_id": job_id,
                                "location_id": loc_id,
                                "job_type": job_type,
                                "job_created_at": created_at,
                                "scheduled_for": scheduled_on,
                                "completed_at": completed_on,
                                "observed_month": scheduled_on, # convert to first of month
                                "is_recurring": is_recurring,
                                "spr_hours_actual": num_spr_minutes/3600,
                                "fa_hours_actual": num_fa_minutes/3600,
                                "number_of_fa_days": num_consecutive_fa_days,
                                "number_of_spr_days": num_consecutive_spr_days,
                                "number_of_fa_techs": fa_techs_required,
                                "number_of_spr_techs": spr_techs_required,
                                "travel_minutes_per_appt": travel_time,
                                "travel_minutes_total": travel_time * num_unique_tech_appt,
                                "status": status,
                                "meta": "timing from past job",
                                "location_on_hold": is_location_on_hold
                            }
                            insert_vals_list.append(insert_vals)
                            job_processed += 1
                            pbar.set_postfix(last_loc=loc_id, jobs=job_processed, skipped=skipped, errors=errors)

                    except requests.HTTPError as http_err:
                        db.session.rollback()
                        errors += 1
                        log.error("HTTP error on location %s: %s", loc_id, http_err)
                        pbar.set_postfix(last_loc=loc_id, jobs=job_processed, skipped=skipped, errors=errors)

                    except Exception as e:
                        db.session.rollback()
                        errors += 1
                        log.exception("Error processing location %s: %s", loc_id, e)
                        pbar.set_postfix(last_loc=loc_id, jobs=job_processed, skipped=skipped, errors=errors)

                # Step 3 - if still no annual job found look for scheduled jobs in the future
                # and then finally service recurrences for a month
                service_found = False
                scheduled_job_found = False
                month = None
                meta = ""
                if not inspection_job_found:
                    # parse tags
                    num_spr_days = 0
                    num_days, num_fa_hours = parse_fa_timing_tag(loc_id)
                    num_spr_techs, num_spr_hours = parse_spr_tag(loc_id)
                    num_fa_techs = parse_fa_techs_tag(loc_id)
                    if num_spr_hours > 0:
                        num_spr_days = 1
                    travel_time = _travel_time_for_location(location_id=loc_id)

                    # Scheduled job in future?
                    params = {"locationId": str(loc_id), "page": 1, "limit": 500, 
                            "scheduleDateFrom": datetime.now(timezone.utc).timestamp(), "scheduleDateTo": (datetime.now(timezone.utc) + timedelta(days=365)).timestamp(),
                            "status": "scheduled",
                            "type": "inspection"
                    }

                    resp = call_service_trade_api("job", params=params)
                    data = resp.get("data")
                    jobs = data.get("jobs")
                    job_id = None
                    scheduled_for = None
                    job_created_at = None
                    if jobs is not None:
                        scheduled_job_found = True
                        meta = "timing from tags. Month from scheduled job"
                        for job in jobs:
                            job_id = job.get("id")
                            scheduled_for = job.get("scheduledDate")
                            job_created_at = job.get("created")
                            month = scheduled_for
                            

                    if not scheduled_job_found:
                        # Recurrences
                        unique_rec = {}
                        for rec in stream_recurrences_for_location(loc_id):
                            if rec.get("endsOn") is None:
                                unique_rec[rec["id"]] = rec
                    
                        for rec in unique_rec.values():
                            if not is_relevant_annual_recurrence(rec):
                                continue
                            
                            fs = rec.get("firstStart")
                            
                            if fs is not None:
                                month = fs
                            service_found = True
                            meta = "timing from tags. Month from serviceRecurrence"
                        

                    if scheduled_job_found or service_found:
                        insert_vals = {
                            "location_name": location_name,
                            "location_on_hold": is_location_on_hold,
                            "job_id": job_id,
                            "location_id": loc_id,
                            "job_type": "inspection",
                            "job_created_at": job_created_at,
                            "scheduled_for": scheduled_for,
                            "completed_at": None,
                            "observed_month": month, # convert to first of month
                            "is_recurring": True,
                            "spr_hours_actual": num_spr_hours,
                            "fa_hours_actual": num_fa_hours * num_fa_techs,
                            "number_of_fa_days": num_days,
                            "number_of_spr_days": num_spr_days,
                            "number_of_fa_techs": num_fa_techs,
                            "number_of_spr_techs": num_spr_techs,
                            "travel_minutes_per_appt": travel_time,
                            "travel_minutes_total": (travel_time * (num_fa_techs * num_days)) + (travel_time * num_spr_techs),
                            "status": "new",
                            "meta": meta,
                            "location_on_hold": is_location_on_hold
                        }
                        insert_vals_list.append(insert_vals)

                # if nothing - give up!
                
                if args.sleep:
                    time.sleep(args.sleep)
                # per Location scope
                loc_processed += 1
                do_flush = (args.commit_every and args.commit_every > 0
                            and (loc_processed % args.commit_every == 0))

                if do_flush:
                    try:
                        flushed = _flush_occurrence_rows(insert_vals_list, test_mode=args.test)
                        log.info("Upserted %s rows at location %s (buffer now %s).",
                                flushed, loc_id, len(insert_vals_list))
                    except Exception:
                        errors += 1
                        log.exception("Upsert flush failed after location %s; rolled back.", loc_id)
                    
                pbar.set_postfix(last_loc=loc_id, jobs=job_processed, skipped=skipped, errors=errors)
    
        if args.location_id:
            for insert_vals in insert_vals_list:
                print(f"""
                    {insert_vals['location_name']}
                    -----------------
                    Job ID:                  {insert_vals['job_id']}
                    Location ID:             {insert_vals['location_id']}
                    Job Type:                {insert_vals['job_type']}
                    Job Created At:          {_fmt_ts(insert_vals['job_created_at'])}
                    Scheduled For:           {_fmt_ts(insert_vals['scheduled_for'])}
                    Completed At:            {_fmt_ts(insert_vals['completed_at'])}
                    Observed Month:          {_fmt_ts(insert_vals['observed_month'], fmt="%m")}
                    Is Recurring:            {insert_vals['is_recurring']}
                    SPR Hours (actual):      {insert_vals['spr_hours_actual']}
                    FA Hours (actual):       {insert_vals['fa_hours_actual']}
                    SPR Techs:               {insert_vals['number_of_spr_techs']}
                    FA Techs:                {insert_vals['number_of_fa_techs']}
                    # of FA Days:            {insert_vals['number_of_fa_days']}
                    # of SPR Days:           {insert_vals['number_of_spr_days']}
                    Travel Minutes/Appt:     {insert_vals['travel_minutes_per_appt']}
                    Travel Minutes (total):  {insert_vals['travel_minutes_total']}
                    Status:                  {insert_vals['status']}
                    Meta:                    {insert_vals['meta']}
                    Is Location on Hold?:    {insert_vals['location_on_hold']}
                    """)

        # Final flush of any remaining rows
        try:
            flushed = _flush_occurrence_rows(insert_vals_list, test_mode=args.test)
            log.info("Final upsert flush wrote %s rows.", flushed)
        except Exception:
            errors += 1
            log.exception("Final upsert flush failed; rolled back.")

    log.info("Done. Locations processed: %s | skipped: %s | jobs processed: %s | errors: %s",
                 loc_processed, skipped, job_processed, errors)
        


        


if __name__ == "__main__":
    main()