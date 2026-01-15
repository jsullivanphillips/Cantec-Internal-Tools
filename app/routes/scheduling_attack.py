from flask import Blueprint, render_template, jsonify, session, request, current_app, has_request_context
import requests, os, csv, logging
import json
import re
from datetime import datetime, timezone, timedelta, date
from dateutil.relativedelta import relativedelta
from zoneinfo import ZoneInfo  # Python 3.9+
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import or_, func, cast, Float, case
from app.db_models import db, ServiceOccurrence, Location, ServiceRecurrence
from tqdm import tqdm 
from collections import Counter
from collections import defaultdict
import calendar

log = logging.getLogger("month-conflicts")
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

scheduling_attack_bp = Blueprint('scheduling_attack', __name__, template_folder='templates')
api_session = requests.Session()
api_session.headers.update({"Accept": "application/json"})

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"

BUSINESS_TZ = ZoneInfo("America/Vancouver")  # or a per-location tz if you have one

APPOINTMENT_SERVICE_LINE_IDS = [168, 3, 1, 2, 556] 

#--SERVICE LINE IDS--:
    # {168: 'Fire Protection', 
    # 3: 'Portable Extinguishers', 
    # 5: 'Sprinkler', 
    # 1: 'Alarm Systems', 
    # 2: 'Emergency / Exit Lights', 
    # 556: 'Smoke Alarm', 
    # 702: 'Vehicle Maintenance', 
    # 13: 'Fire Hydrant', 
    # 704: '5-year Sprinkler', 
    # 83: 'Stand Pipe', 
    # 699: 'Office Clerical', 
    # 703: '3-Year Sprinkler'}


## -----
## Helpers
## ------
def _get_st_creds():
    if has_request_context():  # running in a real HTTP request
        return session.get("username"), session.get("password")
    # running from a script/CLI
    return os.getenv("PROCESSING_USERNAME"), os.getenv("PROCESSING_PASSWORD")

def authenticate():
    username, password = _get_st_creds()
    if not username or not password:
        raise RuntimeError("Missing ServiceTrade creds. Set PROCESSING_USERNAME/PROCESSING_PASSWORD.")
    resp = api_session.post(f"{SERVICE_TRADE_API_BASE}/auth",
                            json={"username": username, "password": password})
    resp.raise_for_status()
    return True

def to_business_month(dt):
    if not dt:
        return None
    return dt.astimezone(BUSINESS_TZ).month

def parse_fa_timing_tag(tag_str):
    tag_str = tag_str.strip()
    # If the tag contains "day" (in any case), process it as a day format.
    if re.search(r"day", tag_str, re.IGNORECASE):
        # Updated regex to capture:
        #   Group 1: the day part (e.g. "1" or "1_5")
        #   Group 2: an optional hour adjustment (e.g. "-2" from "-2Hours")
        #   Group 3: an optional trailing fraction after 't' (e.g. "0_5" from "t0_5")
        m = re.match(
            r"^(\d+(?:_\d+)?)[dD]ay(?:s)?(?:(-?\d+(?:_\d+)?)[Hh]our(?:s)?)?(?:t(\d+(?:_\d+)?))?$",
            tag_str
        )
        if m:
            day_part = m.group(1).replace('_', '.')
            # If the day part is already fractional, ignore the trailing fraction.
            if '.' in day_part:
                total_days = float(day_part)
            else:
                total_days = float(day_part)
                if m.group(3):
                    additional = m.group(3).replace('_', '.')
                    total_days += float(additional)
            # Convert days to hours.
            hours = total_days * 8
            # Apply hour adjustment if present.
            if m.group(2):
                hour_adjustment = float(m.group(2).replace('_', '.'))
                hours += hour_adjustment
            return hours
        else:
            return 0.0
    else:
        # Original hour format: split on 't' if present.
        if 't' in tag_str:
            fa_time_str = tag_str.split('t')[0]
        else:
            fa_time_str = tag_str
        fa_time_str = fa_time_str.replace('_', '.')
        try:
            return float(fa_time_str)
        except ValueError:
            return 0.0

def parse_spr_tag(tag_str):
    """
    For Sprinkler tags, we assume a format like "Spr_1x5_5" or "Spr_2x6".
    After removing the "Spr_" prefix, the part before 'x' is the number of techs
    and the part after 'x' (with underscores for decimals) is the number of hours.
    """
    spr_str = tag_str.replace("Spr_", "")
    parts = spr_str.split("x")
    if len(parts) != 2:
        return 0, 0.0
    try:
        num_techs = int(parts[0])
    except ValueError:
        num_techs = 0
    hours_str = parts[1].replace('_', '.')
    try:
        hours = float(hours_str)
    except ValueError:
        hours = 0.0
    return num_techs, hours
    
def call_service_trade_api(endpoint, params=None):
    url = f"{SERVICE_TRADE_API_BASE}/{endpoint}"
    try:
        response = api_session.get(url, params=params)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        current_app.logger.error(f"API call failed: {e}")
        return None


def get_all_locations_with_params(params=None):
    all_locations = []
    endpoint = "location"
    page = 1
    while True:
        print("\nFetching page", page, "for", endpoint)
        paged_params = params.copy() if params else {}
        paged_params['page'] = page
    
        response = call_service_trade_api(endpoint, params=paged_params)
        if not response or 'data' not in response:
            break
    
        data = response.get("data", {})
        locations = data.get('locations', [])

        if not locations:
            break

        all_locations.extend(locations)

        if len(locations) < params.get("limit", 2000):
            break
        page += 1
    
    return all_locations


def get_all_locations_with_tag(tag):
    params = {
        "tag": tag,
        "status": "active",
        "limit": 500
    }
    return get_all_locations_with_params(params=params)


def get_all_jobs_with_params(params=None):
    all_jobs = []
    endpoint = "job"
    page = 1
    while True:
        paged_params = params.copy() if params else {}
        paged_params['page'] = page
    
        response = call_service_trade_api(endpoint, params=paged_params)
        if not response or 'data' not in response:
            break
    
        data = response.get("data", {})
        jobs = data.get('jobs', [])

        if not jobs:
            break

        all_jobs.extend(jobs)

        if len(jobs) < params.get("limit", 2000):
            break
        page += 1
    
    return all_jobs


def parse_dt(v):
    """Accept ISO string, epoch seconds, or epoch milliseconds."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        ts = float(v)
        if ts > 1e12:  # likely milliseconds
            ts = ts / 1000.0
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    if isinstance(v, str):
        # try ISO first
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00")).astimezone(timezone.utc)
        except Exception:
            # maybe it's a numeric string
            try:
                ts = float(v)
                if ts > 1e12:
                    ts = ts / 1000.0
                return datetime.fromtimestamp(ts, tz=timezone.utc)
            except Exception:
                return None
    return None


def end_of_month(dt: datetime) -> datetime:
    first_next = (dt.replace(day=1) + relativedelta(months=1))
    return first_next - timedelta(seconds=1)


def window_for(sr: ServiceRecurrence):
    """
    18-month lookback ending at end-of-month of sr.first_start (your recurrence anchor).
    """
    assert sr.first_start, "first_start required on ServiceRecurrence"
    end = end_of_month(sr.first_start)
    start = end.replace(day=1) - relativedelta(months=18)
    return start, end

def job_loc_meta(j: dict):
    loc = j.get("location") or {}
    return (loc.get("id"), (loc.get("name") or "").strip())

def list_jobs_for_location(location_id: int, start: datetime, end: datetime, debug: bool=False) -> list[dict]:
    page, limit = 1, 500
    out = []

    while True:
        params = {
            # ⚠️ Use singular for jobs
            "locationId": str(location_id),
            "page": page,
            "limit": limit,
            "status": "completed",  # only need completed or canceled jobs
            "type": "inspection,replacement,installation,upgrade",
            # Prefer schedule-date window if your account supports it:
            # "scheduleDateFrom": int(start.timestamp()),
            # "scheduleDateTo": int(end.timestamp()),
            # Fallback (comment out if not supported on your tenant):
            # "createdAfter": int(start.timestamp()),
            # "createdBefore": int(end.timestamp()),
        }
        r = call_service_trade_api("job", params=params)
        data = r.get("data", {}) if r else {}
        if debug:
            log.info(f"[loc {location_id}] data: {json.dumps(data)[:200]}...")
        jobs = data.get("jobs") or []
        if not jobs:
            if debug:
                log.info(f"[loc {location_id}] no more jobs found at page {page}")
            break

        # Defensive filter: keep only jobs that actually belong to this location
        filtered = []
        extras = []
        for j in jobs:
            loc_id, loc_name = job_loc_meta(j)
            if loc_id == location_id:
                filtered.append(j)
            else:
                extras.append((j.get("id"), loc_id, loc_name))

        if debug and extras:
            # If the API returned jobs for other locations, show a few to diagnose
            log.warning(
                "[loc %s] API returned %s jobs; %s did not match location. Examples: %s",
                location_id, len(jobs), len(extras),
                extras[:3]
            )

        out.extend(filtered)
        if len(jobs) < limit:
            break
        page += 1

    if debug:
        log.info("[loc %s] jobs kept after filter: %s", location_id, len(out))
    return out


def is_annual_job(job: dict) -> bool:
    # Add any filtering to jobs here
    return True  # Placeholder; customize as needed

def appointment_when(appt: dict):
    """
    Return (dt, key) picking the best timestamp from an appointment.
    Handles ISO strings, epoch seconds, and epoch ms.
    """
    # Try likely "done" fields first, then fall back:
    candidate_keys = [
        # PREFERRED "done" / end-ish
        "windowEnd", "windowStart",
        # fallback "start-ish"
        "actualStart", "start", "startTime", "startOn", "scheduledOn", "scheduledStart",
        # absolute fallback
        "created", "updated"
    ]
    for key in candidate_keys:
        dt = parse_dt(appt.get(key))
        if dt:
            return dt, key
    return None, None

def job_when_with_key(j: dict):
    for key in ["completedOn", "completed", "completedDate", "scheduledOn", "scheduledDate", "created"]:
        dt = parse_dt(j.get(key))
        if dt:
            return dt, key
    return None, None

def list_appointments_for_job(job_id: int, debug: bool = False) -> list[dict]:
    """
    Fetch appointments for a job, filtered to specific serviceLineIds.
    """
    page, limit, all_appts = 1, 500, []
    while True:
        params = {
            "jobId": int(job_id),
            "serviceLineIds": ",".join(map(str, APPOINTMENT_SERVICE_LINE_IDS)),
            "page": page,
            "limit": limit,
        }
        r = call_service_trade_api("appointment", params=params)
        data = r.get("data", {}) if r else {}
        appts = data.get("appointments")
        all_appts.extend(appts)
        if len(appts) < limit: break
        page += 1

    if debug:
        log.info(f"[job {job_id}] appointments fetched={len(all_appts)}")
        # show a peek at date-ish keys for first few appts
        for a in all_appts[:3]:
            keys = [k for k in a.keys() if "time" in k.lower() or "on" in k.lower() or k in ("start","end","created","updated")]
            sample = {k: a.get(k) for k in keys}
            sl = (a.get("serviceLine") or {})
            log.debug(f"  appt peek sl='{sl.get('name')}' keys={sample}")

    return all_appts

def job_completed_dt_via_appointments(job_id: int, debug: bool = False):
    """
    Define job 'completed' time as the earliest non-clerical appointment timestamp.
    """
    appts = list_appointments_for_job(job_id, debug=debug)
    earliest = None

    for a in appts:
        sl = (a.get("serviceLine") or {})
        if (sl.get("name") or "").strip().lower() == "office clerical":
            continue
        dt, key = appointment_when(a)
        if not dt:
            continue
        if debug and earliest is None:
            log.debug(f"[job {job_id}] first usable appt key={key} dt_utc={dt.isoformat()}")

        if earliest is None or dt < earliest[0]:
            earliest = (dt, key, sl.get("name"))

    if earliest:
        dt, key, sl_name = earliest
        if debug:
            log.info(f"[job {job_id}] completed via appt key={key} dt_utc={dt.isoformat()} "
                     f"local={dt.astimezone(BUSINESS_TZ).isoformat()} sl='{sl_name}'")
        return dt

    if debug:
        log.info(f"[job {job_id}] no usable appointment timestamps found")
    return None

def recent_annual_job_for(sr: ServiceRecurrence, debug: bool = False):
    start, end = window_for(sr)
    jobs = list_jobs_for_location(sr.location_id, start, end)
    if debug and len(jobs) > 0:
        log.info(f"[loc {sr.location_id}] found {len(jobs)} jobs in window {start.date()} to {end.date()}")
    
    # --- detect most recent job overall (any type) ---
    most_recent_any = []
    for j in jobs:
        dt, key = job_when_with_key(j)  # uses parse_dt; no extra API calls
        if dt:
            most_recent_any.append((j, dt, key))
        
    most_recent_any.sort(key=lambda t: t[1], reverse=True)
    cancelled_meta = None
    if most_recent_any:
        last_job, last_dt, last_key = most_recent_any[0]
        status = (last_job.get("status") or "").lower()
        if status in ("canceled", "cancelled"):
            cancelled_meta = {
                "job_id": last_job.get("id"),
                "when": last_dt,
                "when_key": last_key,
                "status": status,
            }

    

    # --- pick most recent ANNUAL job (using appointments to define completion time) ---
    candidates = []
    for j in jobs:
        if not is_annual_job(j):  # your predicate
            continue
        when = job_completed_dt_via_appointments(j["id"], debug=debug)
        if debug and when:
            log.debug(f"  annual candidate job={j.get('id')} when_utc={when.isoformat()} "
                      f"biz_month={to_business_month(when)} "
                      f"text='{(f'{j.get('name','')} {j.get('description','')}'.strip()[:100])}'")
        if when:
            candidates.append((j, when))
            if debug and len(candidates) <= 3:
                log.debug(f"  candidate job={j.get('id')} when_utc={when.isoformat()} "
                          f"biz_month={to_business_month(when)} "
                          f"text='{(f'{j.get('name','')} {j.get('description','')}'.strip()[:100])}'")

    if not candidates:
        if debug:
            log.info(f"  no annual candidates for loc_id: {sr.location_id} (jobs_fetched={len(jobs)})")
        # Return cancel info so caller can log it even if no annual was found
        return None, None, cancelled_meta

    candidates.sort(key=lambda t: t[1], reverse=True)
    picked, when = candidates[0]
    picked_month = to_business_month(when)

    if debug:
        log.info(f"  picked job={picked.get('id')} when_utc={when.isoformat()} "
                 f"when_local={when.astimezone(BUSINESS_TZ).isoformat()} biz_month={picked_month}")

    # If the most recent ANY job is canceled and is newer than the picked annual job, surface that fact
    if cancelled_meta and cancelled_meta["when"] >= when:
        if debug:
            log.info(f"  note: most recent job (id={cancelled_meta['job_id']}) is CANCELED and "
                     f"is newer than the picked annual job.")
        # Caller can decide how to log; we still return the picked annual for comparison
        return picked, picked_month, cancelled_meta

    return picked, picked_month, None


# NOTE: We need to run a scheduled updater for our locations table!
# Find recent annual inspection for location
# log location_id if no annual inspection found 
# or if annual inspection is not in the same month listed in the service_recurrence table
# --- main checker
def check_month_conflicts(output_csv="recurrence_month_conflicts.csv", only_problems=True) -> dict:
    authenticate()
    q = (db.session.query(ServiceRecurrence)
         .join(Location, Location.location_id == ServiceRecurrence.location_id)
         .filter(Location.status == "active"))
    total, missing, mismatches, canceled = q.count(), [], [], []

    with open(output_csv, "w", newline="", encoding="utf-8") as f, \
         tqdm(total=total, desc="Checking month conflicts", unit="loc", mininterval=0.5) as pbar:
        w = csv.writer(f)
        w.writerow(["location_id","recurrence_month","last_job_month","job_id",
                    "job_completed_local","note"])

        for sr in q.yield_per(500):
            picked, picked_month, cancel_meta = recent_annual_job_for(sr, debug=False)

            if cancel_meta and not picked:
                canceled.append(sr.location_id)
                w.writerow([sr.location_id, int(sr.month or 0), None,
                            cancel_meta["job_id"],
                            cancel_meta["when"].astimezone(BUSINESS_TZ).isoformat(),
                            "LAST JOB CANCELED"])
            elif not picked:
                missing.append(sr.location_id)
                w.writerow([sr.location_id, int(sr.month or 0), None, None, None, "NO ANNUAL FOUND"])
            else:
                when = job_completed_dt_via_appointments(picked["id"], debug=False)
                biz_month = to_business_month(when)
                if biz_month != int(sr.month or 0):
                    mismatches.append(sr.location_id)
                    w.writerow([sr.location_id, int(sr.month or 0), int(biz_month or 0),
                                picked["id"],
                                when.astimezone(BUSINESS_TZ).isoformat() if when else None,
                                "MONTH MISMATCH" + (" | LAST JOB CANCELED" if cancel_meta else "")])

            pbar.update(1)
            pbar.set_postfix(missing=len(missing), mismatches=len(mismatches), canceled=len(canceled))

    return {"checked": total, "missing": len(missing), "mismatches": len(mismatches),
            "canceled": len(canceled), "csv": output_csv}


def check_month_conflict_for_location(location_id: int) -> dict:
    sr = (db.session.query(ServiceRecurrence)
          .join(Location, Location.location_id == ServiceRecurrence.location_id)
          .filter(ServiceRecurrence.location_id == location_id, Location.status == "active")
          .one_or_none())
    if not sr:
        print(f"[loc {location_id}] No active ServiceRecurrence row.")
        return {"location_id": location_id, "status": "no_sr"}

    start_dt, end_dt = window_for(sr)                 # local/business TZ
    start_ts, end_ts = window_for(sr)   # unix (for ST)

    print(f"\n[loc {location_id}] Recurrence month={sr.month} "
          f"first_start_local={sr.first_start.astimezone(BUSINESS_TZ).isoformat()}")
    print(f"[loc {location_id}] Window local: {start_dt.isoformat()} → {end_dt.isoformat()}")
    print(f"[loc {location_id}] Window unix : {start_ts} → {end_ts}")

    jobs = list_jobs_for_location(location_id, start_dt, end_dt, debug=True)
    print(f"[loc {location_id}] Jobs returned (post-filter): {len(jobs)}")

    # List each job with appointment-derived time
    for j in jobs:
        jid = j.get("id"); status = (j.get("status") or "").lower()
        loc_meta = (j.get("location") or {})
        when = job_completed_dt_via_appointments(jid, debug=True)
        when_local = when.astimezone(BUSINESS_TZ).isoformat() if when else "-"
        print(f"  • job={jid} status={status:>9} annual={'Y' if is_annual_job(j) else 'N'} "
              f"appt_time_local={when_local} job_loc={loc_meta.get('id')}:{loc_meta.get('name')}")

    # Choose annual job (via appointments)
    picked, picked_month, cancel_note = recent_annual_job_for(sr, debug=True)
    if not picked:
        note = "LAST JOB CANCELED" if cancel_note else "NO ANNUAL FOUND"
        print(f"[loc {location_id}] RESULT: {note}")
        return {"location_id": location_id, "status": note}

    when = job_completed_dt_via_appointments(picked.get("id"), debug=True)
    biz_month = to_business_month(when)
    conflict = (biz_month != int(sr.month or 0))

    print(f"[loc {location_id}] Picked annual job id={picked.get('id')} "
          f"local={when.astimezone(BUSINESS_TZ).isoformat() if when else '-'} "
          f"job_month={biz_month} vs recurrence_month={int(sr.month or 0)}")
    print(f"[loc {location_id}] RESULT: {'MONTH MISMATCH' if conflict else 'OK'}")
    return {
        "location_id": location_id,
        "recurrence_month": int(sr.month or 0),
        "picked_job_id": picked.get("id"),
        "picked_job_month": int(biz_month or 0) if biz_month else None,
        "conflict": bool(conflict),
    }

def _norm_seconds(v):
    """Accept seconds or ms; return seconds as float or None."""
    if v is None:
        return None
    try:
        s = float(v)
    except (TypeError, ValueError):
        return None
    # If absurdly large, assume milliseconds
    if s > 1_000_000:  # ~11.6 days in seconds; too big for a single onsite stint
        s = s / 1000.0
    return s

# Updating tech time
def _clock_hours_for_job(job_id: int) -> float | None:
    """
    GET /job/{jobId}/clockevent, sum durations (hours) for pairedEvents
    where either start.activity or end.activity == 'onsite'.
    Prefer reported elapsedTime when sane; otherwise use computed delta.
    """
    r = api_session.get(f"{SERVICE_TRADE_API_BASE}/job/{job_id}/clockevent")
    r.raise_for_status()
    payload = r.json()
    pairs = (
        payload.get("pairedEvents")
        or payload.get("data", {}).get("pairedEvents")
        or []
    )

    total_sec = 0.0
    for p in pairs:
        s = (p.get("start") or {})
        e = (p.get("end") or {})
        act_s = (s.get("activity") or "").lower()
        act_e = (e.get("activity") or "").lower()
        if act_s != "onsite" and act_e != "onsite":
            continue

        # reported duration (preferred when sane)
        secs_reported = _norm_seconds(p.get("elapsedTime"))

        # computed duration from timestamps (fallback / cross-check)
        dt_s = parse_dt(s.get("eventTime"))
        dt_e = parse_dt(e.get("eventTime"))
        secs_calc = (dt_e - dt_s).total_seconds() if (dt_s and dt_e) else None

        # choose duration with sanity checks
        chosen = None
        if secs_reported and 0 < secs_reported < 20 * 3600:
            chosen = secs_reported
            # cross-check if we also have computed
            if secs_calc and secs_calc > 0:
                diff = abs(secs_reported - secs_calc)
                if diff > 60 and diff / max(secs_calc, 1) > 0.10:
                    log.warning(
                        "clockevent mismatch job=%s pair_id=%s reported=%.1fs calc=%.1fs start=%s end=%s",
                        job_id, p.get("id"), secs_reported, secs_calc, s.get("eventTime"), e.get("eventTime")
                    )
        elif secs_calc and 0 < secs_calc < 20 * 3600:
            chosen = secs_calc

        if chosen:
            total_sec += chosen

    hours = round(total_sec / 3600.0, 2)
    return hours if hours > 0 else None


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
        return None
    return max(candidates_min)



def update_service_recurrence_time(
    *, force: bool = False, commit_every: int = 200, location_id: int | None = None
) -> dict:
    """
    Update tech hours (clock events) and travel minutes (location tags).
    Optional: restrict to a single ServiceTrade location_id.
    Uses ID prefetch to avoid invalidating server-side cursors on commit.
    """
    authenticate()

    # Prefetch IDs only (safe to commit later without killing a streaming cursor)
    id_q = (
        db.session.query(ServiceRecurrence.id)
        .join(Location, Location.location_id == ServiceRecurrence.location_id)
        .filter(Location.status == "active")
        .order_by(ServiceRecurrence.location_id.asc())
    )
    if location_id is not None:
        id_q = id_q.filter(ServiceRecurrence.location_id == location_id)

    id_rows = id_q.all()
    sr_ids = [r[0] for r in id_rows]
    total = len(sr_ids)

    updated = skipped = processed = failures = 0
    log.info(
        "Starting SR hours update (force=%s, commit_every=%s, location_id=%s, total=%s)",
        force, commit_every, location_id, total,
    )

    with tqdm(total=total, desc="Updating SR hours", unit="loc", mininterval=0.5) as pbar:
        for sr_id in sr_ids:
            # SQLAlchemy 1.4+: session.get; fallback to Query.get for older versions
            try:
                try:
                    sr = db.session.get(ServiceRecurrence, sr_id)  # type: ignore[attr-defined]
                except AttributeError:
                    sr = ServiceRecurrence.query.get(sr_id)
                if sr is None:
                    skipped += 1
                    pbar.update(1)
                    pbar.set_postfix(upd=updated, skip=skipped, err=failures, loc="-", act="missing")
                    continue

                action = "skip"
                last_tm = sr.travel_minutes
                last_hrs = sr.est_on_site_hours

                # Travel (one-way). Fill if missing or forcing.
                if force or sr.travel_minutes is None:
                    tm = _travel_time_for_location(sr.location_id)
                    if tm is not None:
                        sr.travel_minutes = tm
                        sr.travel_minutes_is_roundtrip = False
                        last_tm = tm

                # Tech hours
                if not force and sr.est_on_site_hours is not None and sr.basis_job_id is not None:
                    skipped += 1
                    action = "skip"
                else:
                    picked_job, _picked_month, _cancel_note = recent_annual_job_for(sr, debug=False)
                    if not picked_job:
                        skipped += 1
                        action = "nojob"
                    else:
                        job_id = picked_job.get("id")
                        completed_dt = job_completed_dt_via_appointments(job_id, debug=False)
                        hours = _clock_hours_for_job(job_id)
                        if hours is None:
                            skipped += 1
                            action = "nohours"
                        else:
                            sr.est_on_site_hours = hours
                            sr.hours_basis = "clockevents"
                            sr.basis_job_id = job_id
                            sr.basis_inspection_date = completed_dt
                            sr.basis_clock_events_hours = hours
                            sr.basis_sample_size = 1
                            last_hrs = hours
                            action = "updated"
                            updated += 1

                processed += 1
                if processed % commit_every == 0:
                    db.session.commit()

                pbar.update(1)
                pbar.set_postfix(
                    upd=updated, skip=skipped, err=failures,
                    loc=sr.location_id, tm=(last_tm if last_tm is not None else "-"),
                    hrs=(last_hrs if last_hrs is not None else "-"),
                    act=action
                )

            except Exception as e:
                failures += 1
                log.exception("Failed updating sr_id=%s: %s", sr_id, e)
                pbar.update(1)
                pbar.set_postfix(upd=updated, skip=skipped, err=failures, loc="-", act="error")

    db.session.commit()
    summary = {
        "processed": processed,
        "updated": updated,
        "skipped": skipped,
        "errors": failures,
        "location_id": location_id,
    }
    log.info("SR hours update complete: %s", summary)
    return summary


def get_active_techs():
    
    # Authenticate and call the ServiceTrade API for active tech users
    tech_response = call_service_trade_api("user", params={"isTech": "true", "status": "active"})
    
    # Safely extract data
    data = tech_response.get("data", {}) if tech_response else {}
    techs = data.get("users", []) if isinstance(data.get("users"), list) else []
    
    # Remove unwanted techs by name
    exclude_names = {"Sub Contractors", "Jordan Zwicker", "Shop Tech"}
    techs = [tech for tech in techs if tech.get("name") not in exclude_names]
    
    return techs


# -----------------------
# Helpers
# -----------------------
def _month_range(year, month):
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)

def _iter_workdays(start_dt, end_dt):
    cur = start_dt
    while cur <= end_dt:
        if cur.weekday() < 5:  # Mon-Fri
            yield cur
        cur += timedelta(days=1)

def _nth_weekday_of_month(year, month, weekday, n):
    # weekday: Mon=0..Sun=6, n>=1
    first, last = _month_range(year, month)
    count, cur = 0, first
    while cur <= last:
        if cur.weekday() == weekday:
            count += 1
            if count == n:
                return cur
        cur += timedelta(days=1)
    return None

def _weekday_before(year, month, day, weekday):
    # e.g., Monday before May 25 (Victoria Day): weekday=0 (Mon)
    target = date(year, month, day)
    cur = target - timedelta(days=1)
    while cur.weekday() != weekday:
        cur -= timedelta(days=1)
    return cur

def _observed(dt):
    # If holiday falls on weekend, observe on weekday (Mon for Sat/Sun)
    if dt.weekday() == 5:  # Sat -> Friday (some orgs) or Monday; Canada often Monday
        return dt + timedelta(days=2)
    if dt.weekday() == 6:  # Sun -> Monday
        return dt + timedelta(days=1)
    return dt

# Minimal “company 9” stat set (matches your previous total = 9 days)
def _company_9_holidays(year):
    # New Year’s, Family Day (BC 3rd Mon Feb), Good Friday, Victoria Day,
    # Canada Day, Labour Day, Thanksgiving, Remembrance Day, Christmas.
    # (No BC Day, Truth & Reconciliation, Boxing Day to keep it at 9.)
    # ---- Good Friday requires Easter calculation (Computus) ----
    # Anonymous Gregorian computus:
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19*a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2*e + 2*i - h - k) % 7
    m = (a + 11*h + 22*l) // 451
    easter_month = (h + l - 7*m + 114) // 31  # 3=Mar, 4=Apr
    easter_day = ((h + l - 7*m + 114) % 31) + 1
    easter = date(year, easter_month, easter_day)
    good_friday = easter - timedelta(days=2)

    holidays = {
        "New Year's Day": _observed(date(year, 1, 1)),
        "Family Day (BC)": _nth_weekday_of_month(year, 2, 0, 3),   # 3rd Monday Feb
        "Good Friday": good_friday,
        "Victoria Day": _weekday_before(year, 5, 25, 0),          # Monday before May 25
        "Canada Day": _observed(date(year, 7, 1)),
        "Labour Day": _nth_weekday_of_month(year, 9, 0, 1),       # 1st Monday Sept
        "Thanksgiving": _nth_weekday_of_month(year, 10, 0, 2),    # 2nd Monday Oct
        "Remembrance Day": _observed(date(year, 11, 11)),
        "Christmas Day": _observed(date(year, 12, 25)),
    }
    # Ensure no Nones (in pathological calendar cases)
    return {name: dt for name, dt in holidays.items() if dt is not None}

# Optional richer BC set (+ BC Day, Truth & Reconciliation, Boxing Day)
def _bc_richer_holidays(year):
    h = _company_9_holidays(year).copy()
    h.update({
        "BC Day": _nth_weekday_of_month(year, 8, 0, 1),                   # 1st Monday Aug
        "National Day for Truth and Reconciliation": _observed(date(year, 9, 30)),
        "Boxing Day": _observed(date(year, 12, 26)),
    })
    return h

# -----------------------
# Main calculator
# -----------------------

def calculate_monthly_available_hours(
    active_techs,
    year=None,
    holiday_policy="bc_richer",  # "company9" or "bc_richer"
    dec_shutdown=True,          # Dec 25–31 assigned to December only
    vacation_days=10,
    sick_days=5,
    lunch_hours_per_day=0.5,
    meeting_hours_per_month=0.5,
    inventory_months=(4, 7, 10, 1),  # +1 hr per month listed
    loadups_by_mondays=True,   # 1 hr per Monday (≈ weeks in month)
):
    """
    Returns { 'January': hours_for_all_techs, ... } for the given year.
    """
    number_of_techs = len(active_techs)
    # Pick a year if none passed (use current)
    from datetime import datetime, timezone
    if year is None:
        year = datetime.now(timezone.utc).astimezone().year

    # Build holiday set by month
    if holiday_policy == "bc_richer":
        hol = _bc_richer_holidays(year)
    else:
        hol = _company_9_holidays(year)

    holidays_by_month = {}
    for name, dt in hol.items():
        holidays_by_month.setdefault(dt.month, []).append((name, dt))

    monthly_hours = {}
    # Track totals to validate toward your 1656 baseline (per tech)
    per_tech_total = 0.0

    for month in range(1, 13):
        start, end = _month_range(year, month)

        # Base workdays (Mon–Fri)
        workdays = list(_iter_workdays(start, end))
        workday_set = set(workdays)

        # Subtract stat holidays in this month
        for name_dt in holidays_by_month.get(month, []):
            _, hdt = name_dt
            if hdt in workday_set:
                workday_set.remove(hdt)
        workdays = sorted(workday_set)

        # Subtract Dec 25–31 shutdown into December only (if enabled)
        if dec_shutdown and month == 12:
            cur = date(year, 12, 25)
            while cur <= date(year, 12, 31):
                if cur in workday_set:
                    workday_set.remove(cur)
                cur += timedelta(days=1)
            workdays = sorted(workday_set)

        # Hours from workdays (8h/day)
        base_hours = len(workdays) * 8.0

        # Lunch per actual working day
        lunch_hours = len(workdays) * lunch_hours_per_day

        # Load-ups: 1 hr per Monday (≈ weeks)
        if loadups_by_mondays:
            mondays = sum(1 for d in workdays if d.weekday() == 0)
            loadup_hours = float(mondays) * 1.0
        else:
            loadup_hours = 52.0 / 12.0

        # Meetings: flat per month
        meeting_hours = meeting_hours_per_month

        # Inventory hours if this is a quarter-end month
        inventory_hours = 1.0 if month in set(inventory_months) else 0.0

        # Vacation & sick: spread by workday share of the year (if not tracking exact dates)
        # Compute annual working days (to spread fairly across months)
        # Recompute once (cacheable), but okay here for clarity.
        annual_workdays = 0
        for m in range(1, 13):
            s, e = _month_range(year, m)
            wd = list(_iter_workdays(s, e))
            # remove holidays
            wd_set = set(wd)
            for _, hdt in holidays_by_month.get(m, []):
                if hdt in wd_set:
                    wd_set.remove(hdt)
            # shutdown only in December
            if dec_shutdown and m == 12:
                cur2 = date(year, 12, 25)
                while cur2 <= date(year, 12, 31):
                    if cur2 in wd_set:
                        wd_set.remove(cur2)
                    cur2 += timedelta(days=1)
            annual_workdays += len(wd_set)

        share = (len(workdays) / annual_workdays) if annual_workdays else 0.0
        vac_hours = vacation_days * 8.0 * share
        sick_hours = sick_days * 8.0 * share

        per_tech_month = base_hours - (lunch_hours + loadup_hours + meeting_hours + inventory_hours + vac_hours + sick_hours)
        per_tech_month = max(per_tech_month, 0.0)  # safety

        monthly_hours[calendar.month_name[month]] = round(per_tech_month * number_of_techs, 2)
        per_tech_total += per_tech_month

    # Optional: sanity check (close to prior 1656 if using “company9” set)
    # print(f"Per-tech annual total (computed): {per_tech_total:.2f}")

    return monthly_hours



def calculate_weekly_available_hours(
    active_techs,
    week_start_local_dt,              # tz-aware datetime at local midnight Monday
    holiday_policy="bc_richer",
    dec_shutdown=True,
    vacation_days=10,
    sick_days=5,
    lunch_hours_per_day=0.5,
    meeting_hours_per_month=0.5,      # spread across that month's workdays
    inventory_months=(4, 7, 10, 1),   # spread across that month's workdays
    loadups_by_mondays=True,
):
    """
    Returns:
      days: list of dicts [{date, available_hours}, ...] for Mon..Sun
      totals: {available_hours}
    available_hours are for ALL techs combined.
    """
    tz = week_start_local_dt.tzinfo
    number_of_techs = len(active_techs)

    # Week boundaries (Mon 00:00 to next Mon 00:00)
    week_start_date = week_start_local_dt.date()
    week_end_date = (week_start_local_dt + timedelta(days=6)).date()  # Sunday

    year = week_start_date.year  # good enough for holidays; week won't span years often, but still fine for checks below
    hol = _bc_richer_holidays(year) if holiday_policy == "bc_richer" else _company_9_holidays(year)
    holiday_dates = set(hol.values())

    # ---- annual_workdays calc (same as your monthly function) ----
    holidays_by_month = {}
    for _, dt in hol.items():
        holidays_by_month.setdefault(dt.month, []).append(dt)

    annual_workdays = 0
    for m in range(1, 13):
        s, e = _month_range(year, m)
        wd = list(_iter_workdays(s, e))
        wd_set = set(wd)

        for hdt in holidays_by_month.get(m, []):
            if hdt in wd_set:
                wd_set.remove(hdt)

        if dec_shutdown and m == 12:
            cur = date(year, 12, 25)
            while cur <= date(year, 12, 31):
                wd_set.discard(cur)
                cur += timedelta(days=1)

        annual_workdays += len(wd_set)

    # Build per-day available hours
    days = []
    total_available_all_techs = 0.0

    cur = week_start_date
    while cur <= week_end_date:
        # default: 0 for weekends / non-workdays
        available_per_tech = 0.0

        # is it a normal workday (Mon-Fri)?
        if cur.weekday() < 5:
            # holiday?
            is_holiday = cur in holiday_dates

            # dec shutdown day?
            is_shutdown = dec_shutdown and (cur.month == 12) and (date(cur.year, 12, 25) <= cur <= date(cur.year, 12, 31))

            if (not is_holiday) and (not is_shutdown):
                # --- base day ---
                base = 8.0

                # lunch
                lunch = lunch_hours_per_day

                # loadup: 1 hr per Monday
                loadup = 1.0 if (loadups_by_mondays and cur.weekday() == 0) else 0.0

                # meetings: spread across workdays in this month (after holiday/shutdown removal)
                month_first, month_last = _month_range(cur.year, cur.month)
                month_workdays = list(_iter_workdays(month_first, month_last))
                month_wd_set = set(month_workdays)
                # remove holidays
                for hdt in holidays_by_month.get(cur.month, []):
                    month_wd_set.discard(hdt)
                # remove shutdown in Dec
                if dec_shutdown and cur.month == 12:
                    c2 = date(cur.year, 12, 25)
                    while c2 <= date(cur.year, 12, 31):
                        month_wd_set.discard(c2)
                        c2 += timedelta(days=1)
                month_workdays = sorted(month_wd_set)
                month_workday_count = len(month_workdays) or 1

                meeting = float(meeting_hours_per_month) / month_workday_count

                # inventory: 1 hour in certain months, spread across month workdays
                inventory = (1.0 / month_workday_count) if cur.month in set(inventory_months) else 0.0

                # vacation/sick: spread by workday share of the year (same approach as monthly)
                # Each actual working day counts as 1 "share unit"
                share = (1.0 / annual_workdays) if annual_workdays else 0.0
                vac = vacation_days * 8.0 * share
                sick = sick_days * 8.0 * share

                available_per_tech = base - (lunch + loadup + meeting + inventory + vac + sick)
                if available_per_tech < 0:
                    available_per_tech = 0.0

        available_all_techs = available_per_tech * number_of_techs
        total_available_all_techs += available_all_techs

        days.append({
            "date": cur.isoformat(),
            "available_hours": round(available_all_techs, 2),
        })

        cur += timedelta(days=1)

    return {
        "days": days,
        "totals": {"available_hours": round(total_available_all_techs, 2)},
    }




# "frequency": "yearly",
# "interval": 1,
# "firstStart": 1775026800, -> Start of the month of the service (i.e. April 1, 2026)
# "firstEnd": 1777532400, -> End of the month of the service (i.e. April 30, 2026)
#  For some reason service trade creates a NEW service recurrence each time one is updated.
#  To make a usable schedule we need to create a database of all locations and their service recurrences
#  and then only keep the most recent one for each location.
#  The database needs to be updated anytime a service recurrence is updated or created via webhook.
#  This will allow us to see the correct service recurrence for each location.


## -----
## Routes
## ------
@scheduling_attack_bp.route('/scheduling_attack', methods=['GET'])
def scheduling_attack():
    return render_template("scheduling_attack.html")


# ---------- Helpers (drop these near your other helpers) ----------

def _to_unix_seconds(x):
    if x is None:
        return None
    n = int(x)
    # If value is in ms (very large), convert to seconds
    return n // 1000 if n > 10_000_000_000 else n

def _pair_clock_events(clock_events):
    """
    Pair clock-in -> next clock-out per (user, job, appointment, activity).
    Returns list of intervals:
      [{user_id, job_id, appointment_id, activity, start_ts, end_ts, seconds}, ...]
    """
    buckets = defaultdict(list)

    for ev in clock_events or []:
        user = ev.get("user") or {}
        job = ev.get("job") or {}
        appt = ev.get("appointment") or {}

        user_id = user.get("id")
        if not user_id:
            continue

        ts = _to_unix_seconds(ev.get("eventTime"))
        if not ts:
            continue

        key = (
            user_id,
            job.get("id"),
            appt.get("id"),
            ev.get("activity"),
        )

        buckets[key].append({"ts": ts, "type": ev.get("eventType")})

    paired = []

    for key, items in buckets.items():
        items.sort(key=lambda x: x["ts"])

        open_start = None
        for it in items:
            etype = it["type"]
            ts = it["ts"]

            if etype == "clock-in":
                # If multiple clock-ins in a row, keep the first
                if open_start is None:
                    open_start = ts

            elif etype == "clock-out":
                # Ignore clock-out without a prior clock-in
                if open_start is None:
                    continue

                start_ts = open_start
                end_ts = ts
                if end_ts > start_ts:
                    user_id, job_id, appt_id, activity = key
                    paired.append({
                        "user_id": user_id,
                        "job_id": job_id,
                        "appointment_id": appt_id,
                        "activity": activity,
                        "start_ts": start_ts,
                        "end_ts": end_ts,
                        "seconds": end_ts - start_ts,
                    })

                open_start = None

        # Dangling open_start (missing clock-out) is ignored

    return paired

# routes/scheduling_attack.py
from sqlalchemy import func, cast, Float
@scheduling_attack_bp.route('/scheduling_attack/status', methods=["GET", "POST"])
def scheduling_status():
    """
    Return all (location_id, job_type) rows from service_occurrence
    that are recurring and attributed to the selected month.

    Request query:
      ?month=YYYY-MM   (e.g., 2025-09)

    Response JSON:
      {
        "month": "2025-09",
        "observed_month": "2025-09-01",
        "rows": [{"location_id": 123, "job_type": "inspection"}, ...],
        "counts_by_job_type": {"inspection": 10, "planned_maintenance": 3, ...},
        "distinct_locations": [123, 456, ...],
        "num_distinct_locations": 17
      }
    """
    sel = (request.args.get("month") or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})$", sel)
    if not m:
        return jsonify({"error": "month must be in YYYY-MM format"}), 400

    year = int(m.group(1))
    month = int(m.group(2))
    try:
        month_floor = date(year, month, 1)  # observed_month is stored as first-of-month
    except ValueError:
        return jsonify({"error": "invalid month"}), 400

    # Query the service_occurrence table
    q = (
        db.session.query(
            ServiceOccurrence.location_id,
            ServiceOccurrence.job_type
        )
        .filter(
            ServiceOccurrence.is_recurring.is_(True),
            ServiceOccurrence.observed_month == month_floor
        )
        .order_by(ServiceOccurrence.location_id.asc(), ServiceOccurrence.job_type.asc())
    )
    rows = q.all()

    # Build response lists / aggregates
    rows_json = [{"location_id": loc_id, "job_type": (job_type or "unknown")}
                 for (loc_id, job_type) in rows]

    counts = Counter([r["job_type"] for r in rows_json])
    counts_by_job_type = dict(counts)

    distinct_locations = sorted({r["location_id"] for r in rows_json})

    print("count: ", counts)

    return jsonify({
        "month": sel,
    })


MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

@scheduling_attack_bp.route('/scheduling_attack/metrics', methods=["GET", "POST"])
def scheduled_jobs_metrics():
    # Active locations subquery
    active_locs = (
        db.session.query(Location.location_id)
        .filter(Location.status == "active")
        .subquery()
    )

    include_travel = request.args.get("include_travel", "true").lower() == "true"

    # Years / month extractors
    now_utc = datetime.now(timezone.utc)
    cur_year = now_utc.year
    prev_year = cur_year - 1
    m = func.extract('month', ServiceOccurrence.observed_month).label("m")
    y = func.extract('year', ServiceOccurrence.observed_month).label("y")

    # Base hours (onsite)
    fa_h   = func.coalesce(ServiceOccurrence.fa_hours_actual, 0.0)
    spr_h  = func.coalesce(ServiceOccurrence.spr_hours_actual, 0.0)

    # Travel minutes per-appt (coalesced)
    tpa    = func.coalesce(ServiceOccurrence.travel_minutes_per_appt, 0)

    # Factors
    fa_days   = func.coalesce(ServiceOccurrence.number_of_fa_days, 0)
    fa_techs  = func.coalesce(ServiceOccurrence.number_of_fa_techs, 0)
    spr_days  = func.coalesce(ServiceOccurrence.number_of_spr_days, 0)
    spr_techs = func.coalesce(ServiceOccurrence.number_of_spr_techs, 0)

    # Travel minutes -> hours
    fa_travel_h  = cast(tpa * fa_techs * fa_days, Float) / 60.0
    spr_travel_h = cast(tpa * spr_techs * spr_days, Float) / 60.0

    # Totals include travel
    if include_travel:
        fa_total_h  = fa_h  + fa_travel_h
        spr_total_h = spr_h + spr_travel_h
    else:
        fa_total_h  = fa_h
        spr_total_h = spr_h

    # Discipline job-counters (count as job if onsite hours > 0)
    fa_job  = case((fa_h  > 0, 1), else_=0)
    spr_job = case((spr_h > 0, 1), else_=0)

    is_rec    = ServiceOccurrence.is_recurring.is_(True)
    is_nonrec = ~ServiceOccurrence.is_recurring

    # One query grouped by year + month; we’ll split to cur/prev in Python
    rows = (
        db.session.query(
            y, m,
            # Recurring
            func.sum(case((is_rec,    fa_total_h), else_=0.0)).label("rec_fa_hours"),
            func.sum(case((is_rec,    fa_job),     else_=0)).label("rec_fa_jobs"),
            func.sum(case((is_rec,    spr_total_h), else_=0.0)).label("rec_spr_hours"),
            func.sum(case((is_rec,    spr_job),     else_=0)).label("rec_spr_jobs"),
            # Non-recurring
            func.sum(case((is_nonrec, fa_total_h), else_=0.0)).label("nonrec_fa_hours"),
            func.sum(case((is_nonrec, fa_job),     else_=0)).label("nonrec_fa_jobs"),
            func.sum(case((is_nonrec, spr_total_h), else_=0.0)).label("nonrec_spr_hours"),
            func.sum(case((is_nonrec, spr_job),     else_=0)).label("nonrec_spr_jobs"),
        )
        .join(active_locs, ServiceOccurrence.location_id == active_locs.c.location_id)
        .filter(
            ServiceOccurrence.observed_month.isnot(None),
            func.extract('year', ServiceOccurrence.observed_month).in_([prev_year, cur_year]),
        )
        .group_by(y, m)
        .order_by(y.asc(), m.asc())
        .all()
    )

    # Build 12 arrays for each year set
    def zeros_f(): return [0.0] * 12
    def zeros_i(): return [0]   * 12

    cur = {
        "recurring_fa_hours": zeros_f(), "recurring_fa_jobs": zeros_i(),
        "recurring_spr_hours": zeros_f(), "recurring_spr_jobs": zeros_i(),
        "nonrecurring_fa_hours": zeros_f(), "nonrecurring_fa_jobs": zeros_i(),
        "nonrecurring_spr_hours": zeros_f(), "nonrecurring_spr_jobs": zeros_i(),
    }
    prev = {
        "recurring_fa_hours": zeros_f(), "recurring_fa_jobs": zeros_i(),
        "recurring_spr_hours": zeros_f(), "recurring_spr_jobs": zeros_i(),
        "nonrecurring_fa_hours": zeros_f(), "nonrecurring_fa_jobs": zeros_i(),
        "nonrecurring_spr_hours": zeros_f(), "nonrecurring_spr_jobs": zeros_i(),
    }

    # Totals for KPI cards (we'll sum what we actually display later on the client)
    # but we also send raw yearly totals if you want.
    yearly_totals = {
        "cur":  {k: 0.0 for k in cur if "hours" in k} | {k: 0 for k in cur if "jobs" in k},
        "prev": {k: 0.0 for k in prev if "hours" in k} | {k: 0 for k in prev if "jobs" in k},
    }

    for row in rows:
        year = int(row.y)
        mi   = int(row.m)
        if not (1 <= mi <= 12):
            continue
        idx = mi - 1
        bucket = cur if year == cur_year else prev
        # Fill arrays
        bucket["recurring_fa_hours"][idx]      = float(row.rec_fa_hours or 0.0)
        bucket["recurring_fa_jobs"][idx]       = int(row.rec_fa_jobs or 0)
        bucket["recurring_spr_hours"][idx]     = float(row.rec_spr_hours or 0.0)
        bucket["recurring_spr_jobs"][idx]      = int(row.rec_spr_jobs or 0)
        bucket["nonrecurring_fa_hours"][idx]   = float(row.nonrec_fa_hours or 0.0)
        bucket["nonrecurring_fa_jobs"][idx]    = int(row.nonrec_fa_jobs or 0)
        bucket["nonrecurring_spr_hours"][idx]  = float(row.nonrec_spr_hours or 0.0)
        bucket["nonrecurring_spr_jobs"][idx]   = int(row.nonrec_spr_jobs or 0)

    # Tech capacity helpers (unchanged)
    active_techs = get_active_techs()
    number_of_techs = len(active_techs)
    monthly_available_hours = calculate_monthly_available_hours(active_techs)

    return jsonify({
        "labels": MONTH_NAMES,
        "year": cur_year,
        "prev_year": prev_year,

        # Full datasets for both years. Frontend will decide which to show per month.
        "cur": cur,
        "prev": prev,

        # Capacity, meta
        "monthly_available_hours": monthly_available_hours,
        "num_active_techs": number_of_techs,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    })


@scheduling_attack_bp.route("/scheduling_attack/efficiency", methods=["GET"])
def scheduling_efficiency():
    week_start = request.args.get("week_start")  # "YYYY-MM-DD"
    authenticate()

    if not week_start:
        return {"error": "Missing week_start (YYYY-MM-DD)"}, 400

    tz = ZoneInfo("America/Vancouver")

    try:
        # Local midnight Monday
        start_local = datetime.strptime(week_start, "%Y-%m-%d").replace(tzinfo=tz)
    except ValueError:
        return {"error": "Invalid week_start format. Expected YYYY-MM-DD."}, 400

    end_local = start_local + timedelta(days=7)

    week_start_dt = start_local
    week_end_dt = end_local

    # ServiceTrade /clock uses unix seconds
    schedule_date_from = int(week_start_dt.timestamp())
    schedule_date_to = int(week_end_dt.timestamp())

    # Active tech roster (you already wrote this)
    active_techs = get_active_techs()

    # 1) Available hours per day (ALL techs)
    avail = calculate_weekly_available_hours(
        active_techs=active_techs,
        week_start_local_dt=start_local,
        holiday_policy="bc_richer",
        dec_shutdown=True,
        vacation_days=10,
        sick_days=5,
        lunch_hours_per_day=0.5,
        meeting_hours_per_month=0.5,
        inventory_months=(4, 7, 10, 1),
        loadups_by_mondays=True,
    )

    # 2) Clocked hours per day from ServiceTrade (/clock)
    endpoint = "clock"
    params = {
        "startTime": schedule_date_from,
        "endTime": schedule_date_to,
        "activity": "onsite",
    }
    resp = call_service_trade_api(endpoint, params=params)
    clock_events = (resp or {}).get("data", {}).get("events", [])
    if not isinstance(clock_events, list):
        clock_events = []

    # Debug (optional)
    # print("clock events found:", len(clock_events))
    # print("clock event sample:", clock_events[:2])

    total_events = len(clock_events)

    paired_intervals = _pair_clock_events(clock_events)
    total_intervals = len(paired_intervals)

    clocked_by_date = defaultdict(float)
    skipped_events = 0  # skipped intervals after clipping

    for interval in paired_intervals:
        start_ts = interval["start_ts"]
        end_ts = interval["end_ts"]

        start_time = datetime.fromtimestamp(start_ts, tz=tz)
        end_time = datetime.fromtimestamp(end_ts, tz=tz)

        # Clip to week window (safe even if API ever includes boundary events)
        effective_start = max(start_time, week_start_dt)
        effective_end = min(end_time, week_end_dt)

        if effective_end <= effective_start:
            skipped_events += 1
            continue

        hrs = (effective_end - effective_start).total_seconds() / 3600.0
        day_key = effective_start.date().isoformat()
        clocked_by_date[day_key] += hrs

    # 3) Build days payload + totals
    days_payload = []
    total_clocked = 0.0
    total_available = 0.0

    for d in avail["days"]:
        day = d["date"]  # "YYYY-MM-DD"
        available_hours = float(d["available_hours"])
        clocked_hours = float(clocked_by_date.get(day, 0.0))

        total_clocked += clocked_hours
        total_available += available_hours

        eff = (clocked_hours / available_hours * 100.0) if available_hours else 0.0
        
        if available_hours == float(0.0):
            print("skipping")
            continue
        print(day, clocked_hours, available_hours, eff)
        days_payload.append({
            "date": day,
            "clocked_hours": round(clocked_hours, 2),
            "available_hours": round(available_hours, 2),
            "efficiency_pct": round(eff, 1),
        })

    efficiency_pct = (total_clocked / total_available * 100.0) if total_available else 0.0

    # 4) Nice label (Mon–Sun) (Windows-safe)
    week_end_inclusive = week_end_dt - timedelta(days=1)
    if week_start_dt.month == week_end_inclusive.month:
        week_label = (
            f"{week_start_dt.strftime('%b')} {week_start_dt.day}–"
            f"{week_end_inclusive.day}, {week_end_inclusive.year}"
        )
    else:
        week_label = (
            f"{week_start_dt.strftime('%b')} {week_start_dt.day}–"
            f"{week_end_inclusive.strftime('%b')} {week_end_inclusive.day}, {week_end_inclusive.year}"
        )

    return {
        "week_start": week_start_dt.date().isoformat(),
        "week_label": week_label,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "totals": {
            "clocked_hours": round(total_clocked, 2),
            "available_hours": round(total_available, 2),
            "efficiency_pct": round(efficiency_pct, 1),
            "total_events": total_events,          # raw /clock events
            "skipped_events": skipped_events,      # skipped paired intervals after clipping
            "active_tech_count": len(active_techs),
            "total_intervals": total_intervals,    # helpful debug (optional)
        },
        "days": days_payload,
    }
    

    

#region Ingest
def epoch_to_aware(epoch: int, tz=BUSINESS_TZ) -> datetime:
    return datetime.fromtimestamp(int(epoch), tz=timezone.utc).astimezone(tz)





def coalesce_updated_on(rec: dict) -> datetime:
    iso = rec.get("updatedOn") or rec.get("modifiedOn") or rec.get("updated") or rec.get("modified") or rec.get("created")
    if isinstance(iso, str):
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(timezone.utc)
    created_epoch = rec.get("created")
    return datetime.fromtimestamp(int(created_epoch), tz=timezone.utc) if created_epoch else datetime.now(timezone.utc)


    # 2: 'Emergency / Exit Lights', 
    # 556: 'Smoke Alarm',
    # 3: 'Portable Extinguishers', 
    # 168: 'Fire Protection', 
    # 1: 'Alarm Systems'
    # 6: 'Backflows'
def is_relevant_annual_recurrence(rec: dict) -> bool:
    if rec.get("frequency") != "yearly" or int(rec.get("interval", 0)) != 1:
        return False
    # Optional: tighten to fire alarm only (uncomment/customize)
    sl_id = (rec.get("serviceLine") or {}).get("id", "")  # e.g., "Fire Alarm", "Fire Sprinkler", "Fire Suppression"
    if sl_id not in {1, 2, 3, 168, 556}:
        return False
    return True

def ingest_service_recurrence(rec: dict, *, session=db.session):
    """
    Idempotently upsert the *latest* recurrence per location.
    Conflicts on location_id; updates only if incoming updated_on_st is newer.
    Keeps any previously computed est_on_site_hours / travel fields.
    """
    if not is_relevant_annual_recurrence(rec):
        return None  # skip non-annual

    loc = rec.get("location") or {}
    loc_id = int(loc.get("id") or 0)
    if not loc_id:
        return None

    st_id = int(rec["id"])

    fs = rec.get("firstStart")
    fe = rec.get("firstEnd")
    if fs is None or fe is None:
        return None  # need these to compute month

    first_start = epoch_to_aware(fs)
    first_end   = epoch_to_aware(fe)
    month       = first_start.month
    updated_on  = coalesce_updated_on(rec)

    insert_vals = {
        "location_id":       loc_id,
        "st_recurrence_id":  st_id,
        "service_id":        (rec.get("serviceLine") or {}).get("id") or rec.get("serviceId"),
        "service_name":      (rec.get("serviceLine") or {}).get("name") or rec.get("serviceName") or rec.get("description"),
        "frequency":         rec.get("frequency"),
        "interval":          rec.get("interval"),
        "first_start":       first_start,
        "first_end":         first_end,
        "month":             month,
        "updated_on_st":     updated_on,
        # NOTE: we intentionally do NOT include hours/travel here;
        # they'll be preserved on conflict.
    }

    ins = insert(ServiceRecurrence).values(**insert_vals)

    # Only overwrite when the incoming row is newer OR existing updated_on_st is NULL.
    update_vals = {
        "st_recurrence_id": ins.excluded.st_recurrence_id,
        "service_id":       ins.excluded.service_id,
        "service_name":     ins.excluded.service_name,
        "frequency":        ins.excluded.frequency,
        "interval":         ins.excluded.interval,
        "first_start":      ins.excluded.first_start,
        "first_end":        ins.excluded.first_end,
        "month":            ins.excluded.month,
        "updated_on_st":    ins.excluded.updated_on_st,
        # deliberately NOT updating:
        # est_on_site_hours, travel_minutes, travel_minutes_is_roundtrip,
        # hours_basis, basis_job_id, basis_inspection_date,
        # basis_clock_events_hours, basis_sample_size
    }

    stmt = ins.on_conflict_do_update(
        index_elements=[ServiceRecurrence.location_id],  # requires a UNIQUE on location_id
        set_=update_vals,
        where=or_(
            ServiceRecurrence.updated_on_st.is_(None),
            ins.excluded.updated_on_st > ServiceRecurrence.updated_on_st,
        )
    )

    session.execute(stmt)
    # optional: return the current snapshot row
    return ServiceRecurrence.query.filter_by(location_id=loc_id).one()
#endregion
