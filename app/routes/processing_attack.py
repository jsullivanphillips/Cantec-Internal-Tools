from flask import Blueprint, jsonify, session, request, current_app
import requests
import json
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from dateutil import parser  # Use dateutil for flexible datetime parsing
from collections import Counter
from sqlalchemy import inspect
from app.db_models import (
    db,
    JobSummary,
    ProcessorMetrics,
    ProcessingStatus,
    ProcessingStatusDaily,
    ProcessingStatusIntraday,
)
import sys
from flask import redirect, url_for

from app.spa import send_spa_index
from app.routes.pink_folder import get_pink_folder_data as get_pink_folder_page_detail
from app.response_cache import cached_json_response

processing_attack_bp = Blueprint('processing_attack', __name__)
api_session = requests.Session()

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
VANCOUVER_TZ = ZoneInfo("America/Vancouver")
INTRADAY_CAPTURE_START_HOUR = 8
INTRADAY_CAPTURE_START_MINUTE = 30
INTRADAY_CAPTURE_END_HOUR = 16
INTRADAY_CAPTURE_END_MINUTE = 30
INTRADAY_WRITE_THROTTLE_MINUTES = 15
INTRADAY_RETENTION_DAYS = 7


def _job_summary_table_exists() -> bool:
    try:
        return inspect(db.engine).has_table(JobSummary.__table__.name)
    except Exception:
        return False


def _processor_metrics_table_exists() -> bool:
    try:
        return inspect(db.engine).has_table(ProcessorMetrics.__table__.name)
    except Exception:
        return False


def _as_processing_status_date(d):
    """DB columns are Date, but guard against datetimes/nulls."""
    if d is None:
        return None
    if isinstance(d, datetime):
        return d.date()
    return d


def _processing_kpi_history_entry(record, ref_date, *, period_key: str, period_value):
    """
    Shared JSON shape for weekly (week_start) and daily (snapshot_date) KPI history.
    ref_date: date used for oldest-job and earliest-conversion thresholds.
    period_key: 'week_start' or 'snapshot_date'.
    period_value: the model's date field (for ISO string in output).
    """
    ref = _as_processing_status_date(ref_date)
    jobs_count = record.jobs_to_be_marked_complete
    hit_goal = None
    if jobs_count is not None:
        hit_goal = jobs_count <= 50

    jobs_to_be_invoiced = record.jobs_to_be_invoiced
    hit_goal_jobs_to_be_invoiced = None
    if jobs_to_be_invoiced is not None:
        hit_goal_jobs_to_be_invoiced = jobs_to_be_invoiced < 30

    jobs_to_be_converted = record.jobs_to_be_converted
    hit_goal_jobs_to_be_converted = None
    if jobs_to_be_converted is not None:
        hit_goal_jobs_to_be_converted = jobs_to_be_converted < 10

    pink_count = record.number_of_pink_folder_jobs
    hit_goal_pink_folder = None
    if pink_count is not None:
        hit_goal_pink_folder = pink_count < 10

    oldest_job_date = _as_processing_status_date(record.oldest_job_date)
    oldest_job_address = record.oldest_job_address
    oldest_job_type = record.oldest_job_type
    hit_goal_oldest_job = None
    if oldest_job_date is not None and ref is not None:
        diff_days = (ref - oldest_job_date).days
        hit_goal_oldest_job = diff_days <= 42

    earliest_job_to_be_converted_date = _as_processing_status_date(
        record.earliest_job_to_be_converted_date
    )
    earliest_job_to_be_converted_address = record.earliest_job_to_be_converted_address
    earliest_job_to_be_converted_job_id = record.earliest_job_to_be_converted_job_id

    hit_goal_earliest_job_to_be_converted = None
    if earliest_job_to_be_converted_date is not None and ref is not None:
        threshold_date = ref + timedelta(days=14)
        hit_goal_earliest_job_to_be_converted = (
            earliest_job_to_be_converted_date >= threshold_date
        )

    period_iso = period_value.isoformat() if period_value else None
    return {
        period_key: period_iso,
        "jobs_to_be_marked_complete": jobs_count,
        "hit_goal": hit_goal,
        "jobs_to_be_invoiced": jobs_to_be_invoiced,
        "hit_goal_jobs_to_be_invoiced": hit_goal_jobs_to_be_invoiced,
        "jobs_to_be_converted": jobs_to_be_converted,
        "hit_goal_jobs_to_be_converted": hit_goal_jobs_to_be_converted,
        "oldest_job_date": oldest_job_date.isoformat() if oldest_job_date else None,
        "oldest_job_address": oldest_job_address,
        "oldest_job_type": oldest_job_type,
        "hit_goal_oldest_job": hit_goal_oldest_job,
        "earliest_job_to_be_converted_date": earliest_job_to_be_converted_date.isoformat()
        if earliest_job_to_be_converted_date
        else None,
        "earliest_job_to_be_converted_address": earliest_job_to_be_converted_address,
        "earliest_job_to_be_converted_job_id": earliest_job_to_be_converted_job_id,
        "hit_goal_earliest_job_to_be_converted": hit_goal_earliest_job_to_be_converted,
        "number_of_pink_folder_jobs": pink_count,
        "hit_goal_pink_folder": hit_goal_pink_folder,
    }


def _collect_processing_status_payload():
    """Fetch the shared KPI snapshot fields used by daily processing history."""
    jobs_to_be_marked_complete, oldest_job_ids, _ = get_jobs_to_be_marked_complete()
    if jobs_to_be_marked_complete and oldest_job_ids:
        oldest_job_date, oldest_job_address, oldest_job_type = get_oldest_job_data(oldest_job_ids[0])
    else:
        oldest_job_date = oldest_job_address = oldest_job_type = None

    jobs_to_be_invoiced = get_jobs_to_be_invoiced()

    _num_locations_to_be_converted, jobs_to_be_converted = find_report_conversion_jobs()
    earliest_conversion_job = jobs_to_be_converted[0] if jobs_to_be_converted else None

    if earliest_conversion_job and earliest_conversion_job.get("scheduledDate"):
        earliest_conversion_date = datetime.fromtimestamp(
            earliest_conversion_job.get("scheduledDate"),
            tz=timezone.utc,
        ).date()
        earliest_conversion_address = (
            earliest_conversion_job.get("location", {})
            .get("address", {})
            .get("street")
        )
        earliest_conversion_job_id = earliest_conversion_job.get("id")
    else:
        earliest_conversion_date = None
        earliest_conversion_address = None
        earliest_conversion_job_id = None

    jobs_by_job_type = organize_jobs_by_job_type(jobs_to_be_marked_complete)
    number_of_pink_folder_jobs, _, _ = get_pink_folder_data()

    return {
        "jobs_to_be_marked_complete": len(jobs_to_be_marked_complete),
        "jobs_to_be_invoiced": jobs_to_be_invoiced,
        "jobs_to_be_converted": len(jobs_to_be_converted),
        "earliest_job_to_be_converted_date": earliest_conversion_date,
        "earliest_job_to_be_converted_address": earliest_conversion_address,
        "earliest_job_to_be_converted_job_id": earliest_conversion_job_id,
        "oldest_job_date": oldest_job_date,
        "oldest_job_address": oldest_job_address,
        "oldest_job_type": oldest_job_type,
        "job_type_count": jobs_by_job_type,
        "number_of_pink_folder_jobs": number_of_pink_folder_jobs,
    }


def _vancouver_now() -> datetime:
    return datetime.now(VANCOUVER_TZ)


def _intraday_window_for_local_day(now_local: datetime) -> tuple[datetime, datetime]:
    start_local = now_local.replace(
        hour=INTRADAY_CAPTURE_START_HOUR,
        minute=INTRADAY_CAPTURE_START_MINUTE,
        second=0,
        microsecond=0,
    )
    end_local = now_local.replace(
        hour=INTRADAY_CAPTURE_END_HOUR,
        minute=INTRADAY_CAPTURE_END_MINUTE,
        second=0,
        microsecond=0,
    )
    return start_local, end_local


def _serialize_processing_status_intraday(record: ProcessingStatusIntraday) -> dict[str, object]:
    captured_at = record.captured_at
    if captured_at.tzinfo is None:
        captured_at = captured_at.replace(tzinfo=timezone.utc)
    captured_at_local = captured_at.astimezone(VANCOUVER_TZ)
    return {
        "snapshot_date": record.snapshot_date.isoformat(),
        "captured_at": captured_at.astimezone(timezone.utc).isoformat(),
        "captured_at_local": captured_at_local.isoformat(),
        "jobs_to_be_marked_complete": record.jobs_to_be_marked_complete,
    }


def capture_processing_status_intraday_if_due() -> dict[str, object]:
    now_local = _vancouver_now()
    snapshot_date = now_local.date()
    window_start, window_end = _intraday_window_for_local_day(now_local)

    if now_local < window_start:
        return {
            "captured": False,
            "reason": "before_window",
            "snapshot_date": snapshot_date.isoformat(),
        }
    if now_local > window_end:
        return {
            "captured": False,
            "reason": "after_window",
            "snapshot_date": snapshot_date.isoformat(),
        }

    latest = (
        ProcessingStatusIntraday.query
        .filter_by(snapshot_date=snapshot_date)
        .order_by(ProcessingStatusIntraday.captured_at.desc())
        .first()
    )

    current_value = get_num_jobs_to_be_marked_complete()
    now_utc = datetime.now(timezone.utc)

    if latest:
        latest_captured_at = latest.captured_at
        if latest_captured_at.tzinfo is None:
            latest_captured_at = latest_captured_at.replace(tzinfo=timezone.utc)
        age = now_utc - latest_captured_at.astimezone(timezone.utc)
        if latest.jobs_to_be_marked_complete == current_value:
            return {
                "captured": False,
                "reason": "unchanged",
                "snapshot_date": snapshot_date.isoformat(),
                "latest": _serialize_processing_status_intraday(latest),
            }
        if age < timedelta(minutes=INTRADAY_WRITE_THROTTLE_MINUTES):
            return {
                "captured": False,
                "reason": "throttled",
                "snapshot_date": snapshot_date.isoformat(),
                "latest": _serialize_processing_status_intraday(latest),
            }

    record = ProcessingStatusIntraday(
        snapshot_date=snapshot_date,
        captured_at=now_utc,
        jobs_to_be_marked_complete=current_value,
    )
    db.session.add(record)
    db.session.commit()

    return {
        "captured": True,
        "reason": "inserted",
        "snapshot_date": snapshot_date.isoformat(),
        "row": _serialize_processing_status_intraday(record),
    }


def cleanup_stale_processing_status_intraday_rows() -> int:
    cutoff_date = _vancouver_now().date() - timedelta(days=INTRADAY_RETENTION_DAYS)
    deleted = (
        ProcessingStatusIntraday.query
        .filter(ProcessingStatusIntraday.snapshot_date < cutoff_date)
        .delete(synchronize_session=False)
    )
    db.session.commit()
    return int(deleted or 0)


def _refresh_processing_status_daily_if_stale(max_age_minutes: int = 30) -> dict[str, object]:
    pt = ZoneInfo("America/Vancouver")
    now_local = datetime.now(pt)
    if now_local.weekday() >= 5:
        return {
            "refreshed": False,
            "reason": "weekend",
            "snapshot_date": now_local.date().isoformat(),
        }

    snapshot_date = now_local.date()
    record = ProcessingStatusDaily.query.filter_by(snapshot_date=snapshot_date).first()
    had_record = record is not None
    now_utc = datetime.now(timezone.utc)

    if record and record.updated_at:
        updated_at = record.updated_at
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)
        age = now_utc - updated_at.astimezone(timezone.utc)
        if age < timedelta(minutes=max_age_minutes):
            return {
                "refreshed": False,
                "reason": "fresh",
                "snapshot_date": snapshot_date.isoformat(),
                "updated_at": updated_at.isoformat(),
            }

    status_data = _collect_processing_status_payload()
    if record:
        for key, value in status_data.items():
            setattr(record, key, value)
        record.updated_at = now_utc
    else:
        record = ProcessingStatusDaily(
            snapshot_date=snapshot_date,
            updated_at=now_utc,
            **status_data,
        )
        db.session.add(record)
    db.session.commit()

    return {
        "refreshed": True,
        "reason": "stale" if had_record else "missing",
        "snapshot_date": snapshot_date.isoformat(),
        "updated_at": now_utc.isoformat(),
    }


API_KEY = "YOUR_API_KEY"

@processing_attack_bp.route('/processing_attack', methods=['GET'])
def processing_attack():
    api_session = requests.Session()
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {
        "username": session.get('username'),
        "password": session.get('password')
    }

    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception as e:
        current_app.logger.error("Authentication error: %s", e)
        return redirect(url_for("auth.login"))  # or whatever your login route is

    return send_spa_index()


def authenticate():
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {"username": session.get('username'), "password": session.get('password')}
    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception as e:
        return jsonify({"error": "Authentication failed"}), 401

def call_service_trade_api(endpoint: str, params=None):
    url = f"{SERVICE_TRADE_API_BASE}/{endpoint}"
    resp = api_session.get(url, params=params or {})
    resp.raise_for_status()
    return resp.json()


# -------------------------------------------------------
# JOBS TO BE MARKED COMPLETE & OLDEST JOB & PINK FOLDER JOBS
# -------------------------------------------------------
@processing_attack_bp.route('/processing_attack/complete_jobs', methods=['POST'])
@cached_json_response(prefix="processing_attack:complete_jobs", ttl_seconds=45, include_body=True)
def processing_attack_complete_jobs():
    """
    Returns:
      - Number of jobs to be marked complete.
      - Oldest job's scheduled date, address, and type.
    """
    authenticate()
    oldest_jobs_to_be_marked_complete = []
    jobs_to_be_marked_complete, oldest_job_ids, job_date = get_jobs_to_be_marked_complete()
    if jobs_to_be_marked_complete:
        
        for job_id in oldest_job_ids:
            timestamp = job_date.get(job_id)

            if timestamp is None:
                continue  # skip if timestamp is missing

            job_datetime = datetime.fromtimestamp(timestamp)

            _, address, job_type = get_oldest_job_data(job_id)

            oldest_jobs_to_be_marked_complete.append({
                "job_id": job_id,
                "oldest_job_date": job_datetime.isoformat(),
                "oldest_job_address": address or "Unknown",
                "oldest_job_type": job_type or "Unknown"
            })


    jobs_by_job_type = organize_jobs_by_job_type(jobs_to_be_marked_complete)

    


    num_locations_to_be_converted, jobs_to_be_converted = find_report_conversion_jobs()

    response_data = {
        "job_type_count": jobs_by_job_type,
        "oldest_jobs_to_be_marked_complete" : oldest_jobs_to_be_marked_complete,
        
        "num_locations_to_be_converted": num_locations_to_be_converted,
        "jobs_to_be_converted": jobs_to_be_converted
    }
    return jsonify(response_data)


def proper_format(s):
    return s.replace("_", " ").title()


def organize_jobs_by_job_type(jobs_to_be_marked_complete):
    # Extract and clean job types from each job
    job_types = [
        proper_format(job.get("type", "")) 
        for job in jobs_to_be_marked_complete.values()
    ]
    
    # Count occurrences of each job type
    counts = Counter(job_types)
    return dict(counts)

@processing_attack_bp.route('/processing_attack/jobs_today', methods=['GET'])
@cached_json_response(prefix="processing_attack:jobs_today", ttl_seconds=45)
def jobs_today():
    jobs_processed_today = get_jobs_processed_today()

    incoming_jobs_today = get_incoming_jobs_today()

    return jsonify({
        "jobs_processed_today": jobs_processed_today,
        "incoming_jobs_today": incoming_jobs_today,
        }), 200


@processing_attack_bp.route("/processing_attack/refresh_daily_snapshot_if_stale", methods=["POST"])
def refresh_daily_snapshot_if_stale():
    try:
        result = _refresh_processing_status_daily_if_stale(max_age_minutes=30)
        return jsonify(result), 200
    except Exception:
        current_app.logger.exception("refresh_daily_snapshot_if_stale failed")
        return jsonify({"refreshed": False, "reason": "error"}), 500


@processing_attack_bp.route("/processing_attack/capture_intraday_jobs_to_be_marked_complete", methods=["POST"])
def capture_intraday_jobs_to_be_marked_complete():
    try:
        result = capture_processing_status_intraday_if_due()
        return jsonify(result), 200
    except Exception:
        current_app.logger.exception("capture_intraday_jobs_to_be_marked_complete failed")
        return jsonify({"captured": False, "reason": "error"}), 500


@processing_attack_bp.route("/processing_attack/history_jobs_to_be_marked_complete_intraday", methods=["GET"])
def history_jobs_to_be_marked_complete_intraday():
    if not inspect(db.engine).has_table(ProcessingStatusIntraday.__table__.name):
        return jsonify([]), 200

    now_local = _vancouver_now()
    latest_snapshot_date = now_local.date()
    earliest_snapshot_date = latest_snapshot_date - timedelta(days=INTRADAY_RETENTION_DAYS - 1)

    records = (
        ProcessingStatusIntraday.query
        .filter(ProcessingStatusIntraday.snapshot_date >= earliest_snapshot_date)
        .filter(ProcessingStatusIntraday.snapshot_date <= latest_snapshot_date)
        .order_by(ProcessingStatusIntraday.captured_at.asc())
        .all()
    )

    payload = []
    for record in records:
        item = _serialize_processing_status_intraday(record)
        captured_at_local = datetime.fromisoformat(str(item["captured_at_local"])).astimezone(VANCOUVER_TZ)
        window_start, window_end = _intraday_window_for_local_day(captured_at_local)
        effective_end = min(now_local, window_end) if record.snapshot_date == latest_snapshot_date else window_end
        if captured_at_local < window_start or captured_at_local > effective_end:
            continue
        payload.append(item)
    return jsonify(payload), 200


@processing_attack_bp.route('/processing_attack/jobs_to_be_invoiced', methods=['GET'])
@cached_json_response(prefix="processing_attack:jobs_to_be_invoiced", ttl_seconds=45)
def jobs_to_be_invoiced():
    num_jobs = get_jobs_to_be_invoiced()

    return jsonify({"jobs_to_be_invoiced": num_jobs}), 200


def get_jobs_to_be_invoiced():
    authenticate()
    resp = call_service_trade_api("job", params={
        'status': 'completed', 
        'isInvoiced': False,
        'scheduleDateFrom': datetime.timestamp((datetime.now() - timedelta(days=365))), 
        'scheduleDateTo': datetime.timestamp(datetime.now() + timedelta(80))})
    
    jobs = resp.get("data", {}).get("jobs", [])
    return len(jobs)
    
def find_report_conversion_jobs():
    # Grab locations with Report_conversion tag
    params = {
        "tag": "Report_Conversion",
        "limit": 1000
    }
    response = api_session.get(f"{SERVICE_TRADE_API_BASE}/location", params=params)
    response.raise_for_status()
    locations = response.json().get("data", {}).get("locations", [])

    location_ids = ""
    for l in locations:
        l_id = l.get("id")
        location_ids += f"{l_id},"
    
    params = {
        "status": "scheduled",
        "scheduleDateFrom": datetime.timestamp(datetime.now()),
        "scheduleDateTo": datetime.timestamp(datetime.now() + timedelta(days=180)),
        "locationId": location_ids,
        "type": "inspection"
    }
    response = api_session.get(f"{SERVICE_TRADE_API_BASE}/job", params=params)
    response.raise_for_status()
    jobs = response.json().get("data", {}).get("jobs", [])
    

    # Sort jobs by job.get("scheduledDate")
    jobs.sort(key=lambda job: job.get("scheduledDate"))

    return len(locations), jobs


@processing_attack_bp.route('/processing_attack/pink_folder_data', methods=['GET'])
@cached_json_response(prefix="processing_attack:pink_folder_data", ttl_seconds=45)
def get_pink_folder_route():
    """
    Align with /pink_folder/data: same job set and fields (e.g. is_paperwork_uploaded),
    grouped by technician for the Jobs Backlog KPI modal.
    """
    detailed_by_job = get_pink_folder_page_detail()
    if not isinstance(detailed_by_job, dict):
        return jsonify({
            "number_of_pink_folder_jobs": 0,
            "pink_folder_detailed_info": {},
            "time_in_pink_folder": 0,
        }), 200

    pink_folder_detailed_info = {}
    time_in_pink_folder_seconds = 0.0

    for row in detailed_by_job.values():
        if not isinstance(row, dict):
            continue
        tech_hours = row.get("tech_hours")
        if isinstance(tech_hours, (int, float)):
            time_in_pink_folder_seconds += float(tech_hours) * 3600

        job_date_val = row.get("job_date")
        job_date_out = None
        if job_date_val is not None and job_date_val != "":
            if hasattr(job_date_val, "isoformat"):
                job_date_out = job_date_val.isoformat()
            else:
                job_date_out = str(job_date_val)

        payload = {
            "job_address": str(row.get("address") or ""),
            "job_url": str(row.get("hyperlink") or ""),
            "is_paperwork_uploaded": bool(row.get("is_paperwork_uploaded")),
            "job_date": job_date_out,
        }
        for tech_name in row.get("assigned_techs") or []:
            if not tech_name:
                continue
            name = str(tech_name)
            pink_folder_detailed_info.setdefault(name, []).append(payload)

    count = len(detailed_by_job)
    time_in_hours = round(time_in_pink_folder_seconds / 3600, 1)

    return jsonify({
        "number_of_pink_folder_jobs": count,
        "pink_folder_detailed_info": pink_folder_detailed_info,
        "time_in_pink_folder": time_in_hours,
    }), 200


def get_pink_folder_data():
    authenticate()
    job_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    job_params = {
        "tag": "PINK_FOLDER",
        "appointmentStatus" : "unscheduled"
    }

    try:
        response = api_session.get(job_endpoint, params=job_params)
        response.raise_for_status()
    except requests.RequestException as e:
        # If desired, you could return default values here.
        return None, None, None
    
    pink_folder_detailed_info = {}
    job_response = response.json().get("data", {})
    jobs = job_response.get("jobs", {})
    time_in_pink_folder = 0
    

    for job in jobs:
        job_id = job.get("id")
        if not job_id:
            continue
        job_url = "https://app.servicetrade.com/job/" + str(job_id)
        job_address = job.get("location", {}).get("address", {}).get("street", "")


        clock_endpoint = f"{SERVICE_TRADE_API_BASE}/job/{job_id}/clockevent"
        clock_params = {
            "activity": "onsite"
        }

        try:
            response = api_session.get(clock_endpoint, params=clock_params)
            response.raise_for_status()
        except requests.RequestException as e:
            print("exception requesting clock events for pnik folkder job", e)
            continue

        
        clock_event_reponse = response.json()

        clock_events_data = clock_event_reponse.get("data", {})
        paired_events = clock_events_data.get("pairedEvents", [])
        if paired_events:
            for clock_event in paired_events:
                time_in_pink_folder += clock_event.get("elapsedTime", 0)



        current_appointment = job.get("currentAppointment", {})
        techs_on_app = current_appointment.get("techs", [])

        for tech in techs_on_app:
            tech_name = tech.get("name", "Unknown")

            # Initialize the list if this tech hasn't been seen yet
            if tech_name not in pink_folder_detailed_info:
                pink_folder_detailed_info[tech_name] = []

            # Append this job's info
            pink_folder_detailed_info[tech_name].append({
                "job_address": job_address,
                "job_url": job_url
            })
    

    ## Get # of tech hours in pink folder :$
    time_in_hours = round(time_in_pink_folder / 3600, 1)

    return len(jobs), pink_folder_detailed_info, time_in_hours




def get_oldest_job_data(oldest_job_id):
    job_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    job_params = {
        "id": oldest_job_id
    }

    try:
        response = api_session.get(job_endpoint, params=job_params)
        response.raise_for_status()
    except requests.RequestException as e:
        # If desired, you could return default values here.
        return None, None, None

    job = response.json().get("data", {})
    
    appointment_endpoint = f"{SERVICE_TRADE_API_BASE}/appointment"
    appointment_params = {
        "jobId": oldest_job_id
    }

    try:
        response = api_session.get(appointment_endpoint, params=appointment_params)
        response.raise_for_status()
    except requests.RequestException as e:
        # If desired, you could return default values here.
        return None, None, None

    appointments_data = response.json().get("data", {})
    appointments = appointments_data.get("appointments", [])

    earliest_appointment_date = datetime.now()
    for appt in appointments:
        if appt.get("windowStart"):
            appt_date = datetime.fromtimestamp(appt.get("windowStart"))
            if appt_date < earliest_appointment_date:
                earliest_appointment_date = appt_date

    return earliest_appointment_date, job.get("location", {}).get("address", {}).get("street"), job.get("type")


def get_incoming_jobs_today():
    authenticate()

    # Current calendar day in Pacific time (midnight PT through end of day), aligned with
    # get_jobs_processed_today (America/Los_Angeles).
    PT = ZoneInfo("America/Los_Angeles")
    now_pt = datetime.now(PT)
    today_start = now_pt.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)  # exclusive: midnight at start of next calendar day

    scheduleDateFrom = int(today_start.timestamp())
    scheduleDateTo = int(today_end.timestamp())

    # 1) Get jobs that are scheduled or completed on the current calendar day (PT)
    jobs_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    jobs_params = {
        "scheduleDateFrom": scheduleDateFrom,
        "scheduleDateTo": scheduleDateTo,
        "status": "scheduled, completed",
    }

    try:
        response = api_session.get(jobs_endpoint, params=jobs_params, timeout=30)
        response.raise_for_status()
    except requests.RequestException:
        return {}

    data = response.json().get("data", {}) or {}
    jobs_data = data.get("jobs", []) or []

    # Build a dict keyed by job_id
    jobs_by_id = {j["id"]: j for j in jobs_data if isinstance(j, dict) and "id" in j}

    # Start with all jobs; remove those with any scheduled/unscheduled appointments
    jobs_to_be_marked_complete_today = dict(jobs_by_id)

    incomplete_statuses = {"scheduled", "unscheduled"}

    for job_id in list(jobs_to_be_marked_complete_today.keys()):
        appointment_endpoint = f"{SERVICE_TRADE_API_BASE}/appointment"
        appointment_params = {"jobId": job_id}

        try:
            resp = api_session.get(appointment_endpoint, params=appointment_params, timeout=30)
            resp.raise_for_status()
            response_data = resp.json().get("data", {}) or {}
            appointments = response_data.get("appointments", []) or []
        except requests.RequestException:
            # Conservative: keep the job if we can't verify
            continue

        if any((a or {}).get("status") in incomplete_statuses for a in appointments):
            jobs_to_be_marked_complete_today.pop(job_id, None)

    return len(jobs_to_be_marked_complete_today)


def get_jobs_processed_today():
    authenticate()
    # Pacific Time (auto-adjusts for PST/PDT)
    PT = ZoneInfo("America/Los_Angeles")

    # Get today's date in Pacific Time and set time to 12:00 AM
    today_12am_pt = datetime.now(PT).replace(hour=0, minute=0, second=0, microsecond=0)

    right_now_pst = datetime.now(PT)

    scheduleDateFrom = int(today_12am_pt.timestamp())
    scheduleDateTo = int(right_now_pst.timestamp())

    #1.  Get jobs that are complete
    jobs_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    jobs_params = {
        "completedOnBegin": scheduleDateFrom,
        "completedOnEnd": scheduleDateTo,
        "status": "all"
    }

    try:
        response = api_session.get(jobs_endpoint, params=jobs_params)
        response.raise_for_status()
    except requests.RequestException as e:
        return {}
    
    data = response.json().get("data", {})
    jobs_data = data.get("jobs", []) or []

    return len(jobs_data)


@processing_attack_bp.route('/processing_attack/num_jobs_to_be_marked_complete', methods=['GET'])
@cached_json_response(prefix="processing_attack:num_jobs_to_be_marked_complete", ttl_seconds=45)
def num_jobs_to_be_marked_complete():
    num_jobs = get_num_jobs_to_be_marked_complete()

    return jsonify({"jobs_to_be_marked_complete": num_jobs}), 200


@processing_attack_bp.route(
    "/processing_attack/history_jobs_to_be_marked_complete",
    methods=["GET"],
)
def processing_attack_history_jobs_to_be_marked_complete():
    """
    Returns up to the last 12 weekly ProcessingStatus snapshots.

    Each entry contains:
      - week_start: ISO date string for the Monday of the week.
      - jobs_to_be_marked_complete: integer count for that week.
      - hit_goal: True if count is at most 50 (matches live KPI).
      - jobs_to_be_invoiced: integer count for that week.
      - hit_goal_jobs_to_be_invoiced: True if count is strictly under 30 (matches live KPI).
      - jobs_to_be_converted: integer count for that week (scheduled jobs requiring report conversion).
      - hit_goal_jobs_to_be_converted: True if count is strictly under 10 (matches live KPI).
      - number_of_pink_folder_jobs / hit_goal_pink_folder (under 10 jobs).
      - oldest_job_date/oldest_job_address/oldest_job_type
      - hit_goal_oldest_job: True if oldest job is <= 42 days old at snapshot time, else False.
      - earliest_job_to_be_converted_date/earliest_job_to_be_converted_address
      - hit_goal_earliest_job_to_be_converted: True if earliest visit is more than 14 days after week_start.
    """
    # Most recent weeks first, then reverse for chronological display.
    records = (
        ProcessingStatus.query
        .order_by(ProcessingStatus.week_start.desc())
        .limit(12)
        .all()
    )

    history = []
    for record in reversed(records):
        history.append(
            _processing_kpi_history_entry(
                record,
                record.week_start,
                period_key="week_start",
                period_value=record.week_start,
            )
        )

    return jsonify(history), 200


@processing_attack_bp.route(
    "/processing_attack/history_processing_status_daily",
    methods=["GET"],
)
def processing_attack_history_processing_status_daily():
    """
    Returns up to the last 120 weekday snapshots from processing_status_daily
    (same fields as history_jobs_to_be_marked_complete, but snapshot_date instead of week_start).
    """
    if not inspect(db.engine).has_table(ProcessingStatusDaily.__table__.name):
        return jsonify([]), 200

    records = (
        ProcessingStatusDaily.query.order_by(ProcessingStatusDaily.snapshot_date.desc())
        .limit(120)
        .all()
    )
    history = []
    for record in reversed(records):
        history.append(
            _processing_kpi_history_entry(
                record,
                record.snapshot_date,
                period_key="snapshot_date",
                period_value=record.snapshot_date,
            )
        )

    return jsonify(history), 200


@processing_attack_bp.route(
    "/processing_attack/history_pink_folder_jobs",
    methods=["GET"],
)
def processing_attack_history_pink_folder_jobs():
    """
    Returns up to the last 12 weekly ProcessingStatus snapshots for pink folder jobs.

    Each entry contains:
      - week_start: ISO date string for the Monday of the week.
      - number_of_pink_folder_jobs: integer count for that week.
      - hit_goal: True if number_of_pink_folder_jobs < 10, else False.
    """
    records = (
        ProcessingStatus.query
        .order_by(ProcessingStatus.week_start.desc())
        .limit(12)
        .all()
    )

    history = []
    for record in reversed(records):
        pink_count = record.number_of_pink_folder_jobs
        hit_goal = None
        if pink_count is not None:
            hit_goal = pink_count < 10

        history.append(
            {
                "week_start": record.week_start.isoformat()
                if record.week_start
                else None,
                "number_of_pink_folder_jobs": pink_count,
                "hit_goal": hit_goal,
            }
        )

    return jsonify(history), 200


def get_num_jobs_to_be_marked_complete():
    authenticate()
    
    jobs_to_be_marked_complete = []

    ep = "job"
    params = {
        "status": "scheduled",
        "with": "allAppointmentsCompleteButNotInvoiced",
        "sortOrder": "DESC"
    }

    
    resp = call_service_trade_api(ep, params=params)
    jobs = resp.get("data", {}).get("jobs", [])
    
    for j in jobs:
        job_type = j.get("type").lower()
        if job_type != "administrative" and job_type != "unknown" and job_type != "training":
            jobs_to_be_marked_complete.append(j)

    
    
    return len(jobs_to_be_marked_complete)


def get_jobs_to_be_marked_complete():
    authenticate()
    
    job_date = {}
    jobs_to_be_marked_complete = {}

    ep = "job"
    params = {
        "status": "scheduled",
        "with": "allAppointmentsCompleteButNotInvoiced",
        "sortOrder": "DESC"
    }

    
    resp = call_service_trade_api(ep, params=params)
    jobs = resp.get("data", {}).get("jobs", [])
    
    for j in jobs:
        job_type = j.get("type").lower()
        job_id = j.get("id")
        if job_type != "administrative" and job_type != "unknown" and job_type != "training":
            if job_id not in jobs_to_be_marked_complete:
                jobs_to_be_marked_complete[job_id] = j

            ep = "appointment"
            params = {
                "jobId": job_id
            }
            resp = call_service_trade_api(ep, params=params)
            appts = resp.get("data", {}).get("appointments", [])
        
            for appt in appts:
                appt_start = appt.get("windowStart")
                if not appt_start:
                    continue 

                # If this is the first time we're seeing this job_id, or the new date is later
                if job_id not in job_date or (appt_start and appt_start > job_date[job_id]):
                    job_date[job_id] = appt_start

    
    # Filter and validate timestamps
    valid_jobs_with_dates = [
        (job_id, ts) for job_id, ts in job_date.items()
        if job_id in jobs_to_be_marked_complete and isinstance(ts, (int, float))
    ]
    
    # Sort by timestamp ascending
    sorted_jobs = sorted(valid_jobs_with_dates, key=lambda item: item[1])

    # Extract the 5 oldest valid job_ids
    oldest_job_ids = [job_id for job_id, _ in sorted_jobs[:5]]
    
    return jobs_to_be_marked_complete, oldest_job_ids, job_date

@processing_attack_bp.route('/processing_attack/overall_stats', methods=['GET'])
def processing_attack_overall_stats():
    """
    Returns all-time weekly records from JobSummary.
    """
    if not _job_summary_table_exists():
        return jsonify({"error": "job_summary table is not available. Run: flask db upgrade"}), 404

    most_jobs = (
        JobSummary.query
        .order_by(JobSummary.total_jobs_processed.desc())
        .first()
    )

    most_hours = (
        JobSummary.query
        .order_by(JobSummary.total_tech_hours_processed.desc())
        .first()
    )

    if not most_jobs or not most_hours:
        return jsonify({"error": "No summary data available"}), 404

    return jsonify({
        "most_jobs_processed": most_jobs.total_jobs_processed,
        "most_jobs_week": most_jobs.week_start.strftime("%B %d, %Y"),
        "most_hours_processed": round(most_hours.total_tech_hours_processed, 1),
        "most_hours_week": most_hours.week_start.strftime("%B %d, %Y"),
    })

@processing_attack_bp.route(
    "/processing_attack/overall_weekly_trend",
    methods=["GET"]
)
def processing_attack_overall_weekly_trend():
    """
    Returns weekly jobs & hours for all recorded weeks.
    """
    if not _job_summary_table_exists():
        return jsonify({"weeks": [], "jobs": [], "hours": [], "job_summary_table_missing": True})

    summaries = (
        JobSummary.query
        .order_by(JobSummary.week_start.asc())
        .all()
    )

    weeks = []
    jobs = []
    hours = []

    for s in summaries:
        weeks.append(s.week_start.strftime("%b %d, %Y"))
        jobs.append(s.total_jobs_processed)
        hours.append(round(s.total_tech_hours_processed, 1))

    return jsonify({
        "weeks": weeks,
        "jobs": jobs,
        "hours": hours
    })



# -------------------------------------------------------
# TOTAL JOBS & TECH HOURS PROCESSED IN THE TIME FRAME
# -------------------------------------------------------
@processing_attack_bp.route('/processing_attack/processed_data', methods=['POST', 'GET'])
def processing_attack_processed_data():
    """
    Returns:
      - Total jobs processed.
      - Total tech hours processed.
      - Jobs processed by type and hours by type.
    This version queries the database for the given week and the previous week,
    relying on background updates to have precomputed the data.
    """

    data = request.get_json()
    selected_monday_str = data.get('selectedMonday')
    if not selected_monday_str:
        return jsonify({"error": "selectedMonday is required"}), 400

    # Convert the selected Monday string to a date object.
    selected_monday_date = datetime.strptime(selected_monday_str, "%Y-%m-%d").date()
    previous_monday_date = selected_monday_date - timedelta(days=7)

    if not _job_summary_table_exists():
        return jsonify(
            {
                "error": "Weekly summary data is not available (job_summary missing). Run: flask db upgrade",
                "total_jobs_processed": 0,
                "total_tech_hours_processed": 0.0,
                "jobs_by_type": {},
                "total_jobs_processed_previous_week": 0,
                "total_tech_hours_processed_previous_week": 0.0,
                "hours_by_type": {},
            }
        )

    # Query for precomputed data for the current week.
    current_summary = JobSummary.query.filter_by(week_start=selected_monday_date).first()
    # Query for precomputed data for the previous week.
    prev_summary = JobSummary.query.filter_by(week_start=previous_monday_date).first()
    
    # If either record is missing, return an error.
    if not current_summary or not prev_summary:
        return jsonify({
            "error": "Data for the selected week is not yet available. Please try again later."
        }), 404

    response_data = {
        "total_jobs_processed": current_summary.total_jobs_processed,
        "total_tech_hours_processed": current_summary.total_tech_hours_processed,
        "jobs_by_type": current_summary.jobs_by_type,
        "total_jobs_processed_previous_week": prev_summary.total_jobs_processed,
        "total_tech_hours_processed_previous_week": prev_summary.total_tech_hours_processed,
        "hours_by_type": current_summary.hours_by_type
    }
    return jsonify(response_data)



def get_jobs_processed(selected_monday):
    """
    Returns total jobs processed, total tech hours processed, and the oldest job id.
    """
    authenticate()
    monday_date = datetime.strptime(selected_monday, "%Y-%m-%d")
    monday_start = datetime.combine(monday_date, datetime.min.time())
    friday_date = monday_date + timedelta(days=4)
    friday_end = datetime.combine(friday_date, datetime.max.time()).replace(microsecond=0)

    monday_timestamp = int(monday_start.timestamp())
    friday_timestamp = int(friday_end.timestamp())

    job_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    job_params = {
        "completedOnBegin": monday_timestamp,
        "completedOnEnd": friday_timestamp,
        "status": "completed",
        "sort": "scheduleStart",
        "type": "repair,upgrade,service_call,emergency_service_call,inspection,reinpsection,planned_maintenance,preventative_maintenance,inspection_repair,delivery,pickup,installation,training,testing,replacement"
    }

    try:
        response = api_session.get(job_endpoint, params=job_params)
        response.raise_for_status()
    except requests.RequestException as e:
        return 0, 0, None

    jobs_data = response.json().get("data", {})
    jobs = jobs_data.get("jobs", [])
    total_jobs_processed = len(jobs)

    # Get jobs by type
    jobs_by_type = {}
    for job in jobs:
        job_type = job.get("type")
        if job_type:
            jobs_by_type[job_type] = jobs_by_type.get(job_type, 0) + 1

    hours_by_type = {}
    total_tech_hours_processed = 0
    for job in jobs:
        job_id = job.get("id")
        job_type = job.get("type")
        clock_endpoint = f"{SERVICE_TRADE_API_BASE}/job/{job_id}/clockevent"
        clock_params = {
            "activity": "onsite"
        }

        try:
            response = api_session.get(clock_endpoint, params=clock_params)
            response.raise_for_status()
        except requests.RequestException as e:
            continue

        clock_events_data = response.json().get("data", {})
        clock_pairs = clock_events_data.get("pairedEvents", [])
        for pair in clock_pairs:
            clock_in = datetime.fromtimestamp(pair.get("start").get("eventTime"))
            clock_out = datetime.fromtimestamp(pair.get("end").get("eventTime"))
            delta = clock_out - clock_in
            hours_difference = delta.total_seconds() / 3600
            total_tech_hours_processed += hours_difference
            hours_by_type[job_type] = hours_by_type.get(job_type, 0) + hours_difference

    return total_jobs_processed, round(total_tech_hours_processed, 2), jobs_by_type, hours_by_type



# -------------------------------------------------------
# JOBS & TECH HOURS BY PROCESSOR
# -------------------------------------------------------
@processing_attack_bp.route('/processing_attack/processed_data_by_processor', methods=['POST'])
def processing_attack_processed_data_by_processor():
    """
    Returns:
      - Total jobs processed by processor.
      - Total hours processed by processor.
    """
    try:
        authenticate()
        data = request.get_json()
        selected_monday_str = data.get('selectedMonday', None)
        if selected_monday_str:
            selected_monday = datetime.strptime(selected_monday_str, "%Y-%m-%d").date()
            previous_monday = selected_monday - timedelta(days=7)
            previous_monday_str = previous_monday.strftime("%Y-%m-%d")
    
            jobs_by_processor, hours_by_processor = get_processor_metrics_for_week(selected_monday_str)
            jobs_by_processor_prev, hours_by_processor_prev = get_processor_metrics_for_week(previous_monday_str)
        else:
            return jsonify({
                "error": "Selected Monday not provided in the request."
            }), 400
    
        

        response_data = {
            "jobs_processed_by_processor": jobs_by_processor,
            "jobs_processed_by_processor_previous_week": jobs_by_processor_prev,
            "hours_processed_by_processor": hours_by_processor,
            "hours_processed_by_processor_previous_week": hours_by_processor_prev
        }
        return jsonify(response_data)
    except Exception as e:
        return jsonify({
            "error": f"Error in processing stats by processor section: {str(e)}"
        }), 500


def get_processor_metrics_for_week(selected_monday):
    """
    Reads stored processor metrics from the database for the given week.
    """
    week_start_date = datetime.strptime(selected_monday, "%Y-%m-%d").date()
    if not _processor_metrics_table_exists():
        return {}, {}
    records = ProcessorMetrics.query.filter_by(week_start=week_start_date).all()
    jobs_by_processor = {}
    hours_by_processor = {}
    for record in records:
        jobs_by_processor[record.processor_name] = record.jobs_processed
        hours_by_processor[record.processor_name] = record.hours_processed
    return jobs_by_processor, hours_by_processor


def _latest_job_completion_attribution(histories):
    """
    When a job is reopened, ServiceTrade may have several job.status.changed
    -> Completed history rows. Metrics credit only the latest completion
    (by eventTime), breaking ties by later index in the histories list.
    Returns (event_datetime, user_name) or None.
    """
    candidates = []
    for idx, event in enumerate(histories or []):
        if event.get("type") != "job.status.changed":
            continue
        props = event.get("properties") or {}
        if props.get("status") != "Completed":
            continue
        et = props.get("eventTime") or {}
        date_str = et.get("date") if isinstance(et, dict) else None
        if not date_str:
            continue
        try:
            event_dt = parser.isoparse(date_str)
        except (ValueError, TypeError):
            continue
        user_name = (event.get("user") or {}).get("name")
        if not user_name:
            continue
        candidates.append((event_dt, idx, user_name))
    if not candidates:
        return None
    event_dt, _, user_name = max(candidates, key=lambda t: (t[0], t[1]))
    return event_dt, user_name


def get_jobs_processed_by_processor(selected_monday):
    """
    Returns total jobs processed by processor
    """
    authenticate()
    monday_date = datetime.strptime(selected_monday, "%Y-%m-%d")
    monday_start = datetime.combine(monday_date, datetime.min.time())
    friday_date = monday_date + timedelta(days=4)
    friday_end = datetime.combine(friday_date, datetime.max.time()).replace(microsecond=0)

    monday_timestamp = int(monday_start.timestamp())
    friday_timestamp = int(friday_end.timestamp())

    job_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    job_params = {
        "completedOnBegin": monday_timestamp,
        "completedOnEnd": friday_timestamp,
        "status": "completed",
        "sort": "scheduleStart",
        "type": "repair,upgrade,service_call,emergency_service_call,inspection,reinpsection,planned_maintenance,preventative_maintenance,inspection_repair,delivery,pickup,installation,training,testing,replacement"
    }

    try:
        response = api_session.get(job_endpoint, params=job_params)
        response.raise_for_status()
    except requests.RequestException as e:
        return 0, 0

    
    jobs_data = response.json().get("data", {})
    jobs = jobs_data.get("jobs", [])
    jobs_completed_by_processor = {}
    hours_by_processor = {}
    i = 0
    num_of_jobs = len(jobs)
    
    for job in jobs:
        i += 1
        job_id = job.get("id")
        history_endpoint = f"{SERVICE_TRADE_API_BASE}/history"
        history_params = {
            "entityId": job_id,
            "entityType": 3
        }

        try:
            response = api_session.get(history_endpoint, params=history_params)
            response.raise_for_status()
        except requests.RequestException as e:
            current_app.logger.error("ServiceTrade API error: %s", e)
            print(jsonify({"error": f"Error calling ServiceTrade API: {str(e)}"}), 500)
            continue
        # Parse the returned JSON data
        history_response = response.json().get("data", {})
        histories = history_response.get("histories", [])
        sys.stdout.write(f"\rparsing history for job {i}/{num_of_jobs}")
        sys.stdout.flush()
        attribution = _latest_job_completion_attribution(histories)
        if not attribution:
            continue
        _, user_name = attribution

        jobs_completed_by_processor[user_name] = jobs_completed_by_processor.get(user_name, 0) + 1
        clock_endpoint = f"{SERVICE_TRADE_API_BASE}/job/{job_id}/clockevent"
        clock_params = {
            "activity": "onsite, offsite, enroute"
        }
        try:
            response = api_session.get(clock_endpoint, params=clock_params)
            response.raise_for_status()
        except requests.RequestException as e:
            print(f"no history found for job {i}.")
            continue

        clock_events_data = response.json().get("data", {})
        clock_pairs = clock_events_data.get("pairedEvents", [])
        for pair in clock_pairs:
            clock_in = datetime.fromtimestamp(pair.get("start").get("eventTime"))
            clock_out = datetime.fromtimestamp(pair.get("end").get("eventTime"))
            delta = clock_out - clock_in
            hours_difference = delta.total_seconds() / 3600
            hours_by_processor[user_name] = hours_by_processor.get(user_name, 0) + hours_difference
    return jobs_completed_by_processor, hours_by_processor
