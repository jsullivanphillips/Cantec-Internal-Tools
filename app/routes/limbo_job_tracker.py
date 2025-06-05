from flask import Blueprint, render_template, session, jsonify
from datetime import datetime, timedelta, timezone
import json
import requests

limbo_job_tracker_bp = Blueprint('limbo_job_tracker', __name__, template_folder='templates')
api_session = requests.Session()

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
SERVICE_TRADE_JOB_BASE = "https://app.servicetrade.com/jobs"

UNSCHED_APPT_SCHED_JOB_PARAMS = {
    "status": "unscheduled",
    "jobStatus": "scheduled"
}

SCHED_APPT_SCHED_JOB_PARAMS = {
    "status": "scheduled",
    "jobStatus": "scheduled"
}

# Main Route
@limbo_job_tracker_bp.route('/limbo_job_tracker', methods=['GET'])
def limbo_job_tracker():
    """
    Render the main processing_attack page (HTML).
    """
    return render_template("limbo_job_tracker.html")


# Route for getting list of limbo jobs
@limbo_job_tracker_bp.route('/limbo_job_tracker/job_list', methods=['POST'])
def limbo_job_tracker_job_list():
    limbo_jobs = get_limbo_jobs()

    return jsonify([
        {
            "job_link": j.get("job_link"),
            "address": j.get("address"),
            "most_recent_appt": j.get("most_recent_appt"),
            "type": j.get("type")
        }
    for j in limbo_jobs.values()])



# Side Dishes
def authenticate():
    auth_url = "https://api.servicetrade.com/api/auth"

    payload = {"username": session.get('username'), "password": session.get('password')}
    

    if not payload["username"] or not payload["password"]:
        raise Exception("Missing ServiceTrade credentials in session.")

    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
        print("✅ Authenticated successfully with ServiceTrade!")
    except Exception as e:
        print("❌ Authentication with ServiceTrade failed!")
        raise e  # Rethrow the real error


def call_service_trade_api(endpoint, params):
    try:
        response = api_session.get(endpoint, params=params)
        response.raise_for_status()
        return response
    except requests.RequestException as e:
        print(f"[ServiceTrade API Error] Endpoint: {endpoint} | Params: {params} | Error: {str(e)}")
        return {}


def get_appointments_from_api(params):
    appointment_endpoint = f"{SERVICE_TRADE_API_BASE}/appointment"
    response = call_service_trade_api(appointment_endpoint, params)
    data = response.json().get("data")
    return data.get("appointments")


def get_jobs_from_api(params):
    job_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    response = call_service_trade_api(job_endpoint, params)
    data = response.json().get("data")
    return data.get("jobs")


# Meat & Potatos
def get_limbo_jobs():
    authenticate()
    most_recent_appt_for_job_id = {}
    limbo_job_ids = []

    # Job status = scheduled, appt status = unscheduled
    appointment_params = UNSCHED_APPT_SCHED_JOB_PARAMS
    appts = get_appointments_from_api(appointment_params)

    # track jobs with unscheduled appts
    unsched_appt_job_ids = []

    for appt in appts:
        job_id = appt.get("job").get("id")
        if job_id not in unsched_appt_job_ids:
            unsched_appt_job_ids.append(job_id)
    
    # Check if job with unsched appt HAS a scheduled appt
    for job_id in unsched_appt_job_ids:
        appointment_params = {
            "jobId" : job_id
        }
        appts_for_job = get_appointments_from_api(appointment_params)
        scheduled_appt_for_job = False

        for appt in appts_for_job:
            if appt.get("status") == "scheduled" or appt.get("status") == "completed":
                scheduled_appt_for_job = True
                windowEnd = datetime.fromtimestamp(appt.get("windowEnd"), tz=timezone.utc)
                if job_id not in most_recent_appt_for_job_id:
                    most_recent_appt_for_job_id[job_id] = windowEnd
                elif windowEnd > most_recent_appt_for_job_id[job_id]:
                    most_recent_appt_for_job_id[job_id] = windowEnd
                
        # if no scheduled appointment exists for the job, 
        # add the job_id to limbo_job_ids
        if not scheduled_appt_for_job:
            limbo_job_ids.append(job_id)

    # --- Sidebar to grab jobs with scheduled appointments --- #
    # Job status = scheduled, appt status = scheduled
    appointment_params = SCHED_APPT_SCHED_JOB_PARAMS
    appts = get_appointments_from_api(appointment_params)

    # Filter appointments. 
    # Only keep the most recent appointment date for each job id.
    for appt in appts:
        job_id = appt.get("job").get("id")
        if appt.get("status") == "scheduled":
            windowEnd = datetime.fromtimestamp(appt.get("windowEnd"), tz=timezone.utc)
            if job_id is not None:
                if job_id not in most_recent_appt_for_job_id:
                    most_recent_appt_for_job_id[job_id] = windowEnd
                elif windowEnd > most_recent_appt_for_job_id[job_id]:
                    most_recent_appt_for_job_id[job_id] = windowEnd
    # --- Sidebar over --- #

    # Filter jobs with scheduled appointments. 
    # Jobs with a status = scheduled and with 
    # their most recently scheduled appointment date in the past
    # are added to limbo_job_ids
    today = datetime.now(tz=timezone.utc) - timedelta(days=1)
    
    for job_id in most_recent_appt_for_job_id.keys():
        appt_time = most_recent_appt_for_job_id[job_id]
        if appt_time < today:
            limbo_job_ids.append(job_id)


    # Grab job info for the "Limbo Jobs"
    limbo_jobs = {}
    job_params = { "jobIds": ','.join([str(i) for i in limbo_job_ids])}
    jobs = get_jobs_from_api(job_params)

    for job in jobs:
        # Discard admin jobs
        job_type = job.get("type")
        if job_type == "administrative":
            continue

        # Discard PINK_FOLDER jobs
        job_tags = job.get("tags", [])
        if any(tag.get("name") == "PINK_FOLDER" for tag in job_tags):
            continue

        job_id = job.get("id")

        # Store the most recent appt date if one exists
        most_recent_appt = "Not Scheduled"
        if job_id in most_recent_appt_for_job_id.keys():
            # Discard jobs that are scheduled to take place in the future
            if most_recent_appt_for_job_id[job_id] > today:
                continue
            most_recent_appt = str(most_recent_appt_for_job_id[job_id])
 
        
        limbo_jobs[job_id] = {
            "job_link" : f"{SERVICE_TRADE_JOB_BASE}/{job_id}",
            "address" : f"{job.get("location").get("address").get("street")}",
            "most_recent_appt": most_recent_appt,
            "type": job_type,
        }
    return limbo_jobs
    
