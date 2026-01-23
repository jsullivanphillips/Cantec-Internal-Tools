from flask import Blueprint, render_template, jsonify, session, request, current_app
import requests
import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from dateutil import parser  # Use dateutil for flexible datetime parsing
from collections import Counter
from app.db_models import db, JobSummary, ProcessorMetrics
import sys
from flask import redirect, url_for

processing_attack_bp = Blueprint('processing_attack', __name__, template_folder='templates')
api_session = requests.Session()

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
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

    return render_template("processing_attack.html")


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

    number_of_pink_folder_jobs, pink_folder_detailed_info, time_in_pink_folder = get_pink_folder_data()

    jobs_processed_today = get_jobs_processed_today()

    incoming_jobs_today = get_incoming_jobs_today()

    jobs_to_be_invoiced = get_jobs_to_be_invoiced()

    num_locations_to_be_converted, jobs_to_be_converted = find_report_conversion_jobs()

    response_data = {
        "jobs_to_be_marked_complete": len(jobs_to_be_marked_complete),
        "job_type_count": jobs_by_job_type,
        "number_of_pink_folder_jobs" : number_of_pink_folder_jobs,
        "pink_folder_detailed_info" : pink_folder_detailed_info,
        "oldest_jobs_to_be_marked_complete" : oldest_jobs_to_be_marked_complete,
        "jobs_processed_today": jobs_processed_today,
        "incoming_jobs_today": incoming_jobs_today,
        "time_in_pink_folder": time_in_pink_folder,
        "jobs_to_be_invoiced": jobs_to_be_invoiced,
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
    print(f"found {len(jobs)} jobs")

    # Sort jobs by job.get("scheduledDate")
    jobs.sort(key=lambda job: job.get("scheduledDate"))

    return len(locations), jobs


def get_pink_folder_data():
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

    # Pacific (BC) time
    PT = ZoneInfo("America/Vancouver")
    now_pt = datetime.now(PT)

    # Compute last business day (Mon→Fri). 
    # Mon -> Fri (-3), Sun -> Fri (-2), Sat -> Fri (-1), Tue–Fri -> previous day (-1)
    wd = now_pt.weekday()  # Mon=0 ... Sun=6
    if wd == 0:          # Monday
        delta_days = 3
    elif wd == 6:        # Sunday
        delta_days = 2
    else:                # Tue–Sat
        delta_days = 1

    last_bd_start = (now_pt - timedelta(days=delta_days)).replace(hour=0, minute=0, second=0, microsecond=0)
    last_bd_end   = last_bd_start + timedelta(days=1)  # exclusive upper bound at 12:00 AM next day

    scheduleDateFrom = int(last_bd_start.timestamp())
    scheduleDateTo   = int(last_bd_end.timestamp())

    # 1) Get jobs that are scheduled or completed on the last business day
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




def get_jobs_to_be_marked_complete():
    authenticate()
    # one_year_ago = datetime.now() - timedelta(days=180)
    # yesterday = datetime.now() - timedelta(days=1)    
    # scheduleDateFrom = int(one_year_ago.timestamp())
    # scheduleDateTo = int(yesterday.timestamp())

    # #1.  Get appointments that are complete
    # appointment_endpoint = f"{SERVICE_TRADE_API_BASE}/appointment"
    # appointment_params = {
    #     "windowBeginsAfter": scheduleDateFrom,
    #     "windowEndsBefore": scheduleDateTo,
    #     "jobStatus": "scheduled",
    #     "appointmentWith": "allAppointmentsComplete",
    #     "sortOrder": "windowStart"
    # }

    # try:
    #     response = api_session.get(appointment_endpoint, params=appointment_params)
    #     response.raise_for_status()
    # except requests.RequestException as e:
    #     return {}

    # complete_appointments_data = response.json().get("data", {})
    # complete_appointments = complete_appointments_data.get("appointments", [])
    
    # jobs_to_be_marked_complete = {}
    # job_date = {}

    # for appt in complete_appointments:
    #     job = appt.get("job")
    #     job_id = job.get("id")

    #     # if there is no service Line (i.e. Emergency Service Calls), skip it
    #     if not appt.get('serviceRequests') or not appt.get('serviceRequests')[0].get('serviceLine'):
    #         continue
        
    #     appt_service_line_name = appt.get('serviceRequests')[0].get('serviceLine').get('name')

    #     # dont track pink folder appointments
    #     if appt_service_line_name == "Office Clerical":
    #         continue

    #     if not job or not job_id:
    #         continue  # skip if either the job or job_id is invalid

    #     # Save the job info if we haven't already
    #     if job_id not in jobs_to_be_marked_complete:
    #         jobs_to_be_marked_complete[job_id] = job

    #     appt_start = appt.get("windowStart")

    #     # If this is the first time we're seeing this job_id, or the new date is later
    #     if job_id not in job_date or (appt_start and appt_start > job_date[job_id]):
    #         job_date[job_id] = appt_start


    
    # three_months_forward = datetime.now() + timedelta(days=90)    
    # scheduleDateTo = int(three_months_forward.timestamp())

    # #2.  Get unscheduled appointments to remove jobs with incomplete appointments.
    # appointment_params = {
    #     # "windowBeginsAfter": scheduleDateFrom,
    #     # "windowEndsBefore": scheduleDateTo,
    #     #"appointmentWith" : "incompleteServices, allAppointmentsComplete, unscheduledAppointments",
    #     "status" : "unscheduled",
    #     "jobStatus": "scheduled",
    #     "sortOrder": "windowStart"
    # }

    # try:
    #     response = api_session.get(appointment_endpoint, params=appointment_params)
    #     response.raise_for_status()
    # except requests.RequestException as e:
    #     return jobs_to_be_marked_complete

    
    # unsched_appointments_data = response.json().get("data", {})
    # unsched_appointments = unsched_appointments_data.get("appointments", [])
    # jobs_to_remove = {appt.get("job").get("id") for appt in unsched_appointments}
    

    # # Remove jobs with incomplete services
    # for job_id in jobs_to_remove:
    #     if job_id in jobs_to_be_marked_complete:
    #         jobs_to_be_marked_complete.pop(job_id, None)


    # # Remove administrative jobs
    # jobs_to_remove = []
    # for job_id in jobs_to_be_marked_complete:
    #     if jobs_to_be_marked_complete[job_id].get("type") == "administrative":
    #         jobs_to_remove.append(job_id)
    
    # for job_id in jobs_to_remove:
    #     del jobs_to_be_marked_complete[job_id]


    # #3. Get appointments in the future
    # today = datetime.now()  
    # scheduleDateFrom = int(today.timestamp())
    # scheduleDateTo = int(three_months_forward.timestamp())

    # # Get appointments that are scheduled in the future
    # appointment_endpoint = f"{SERVICE_TRADE_API_BASE}/appointment"
    # appointment_params = {
    #     "windowBeginsAfter": scheduleDateFrom,
    #     "windowEndsBefore": scheduleDateTo,
    #     "sortOrder": "windowStart"
    # }

    # try:
    #     response = api_session.get(appointment_endpoint, params=appointment_params)
    #     response.raise_for_status()
    # except requests.RequestException as e:
    #     return {}

    # future_appointments_data = response.json().get("data", {})
    # future_appointments = future_appointments_data.get("appointments", [])
    # jobs_to_remove = {appt.get("job").get("id") for appt in future_appointments}

    # # remove jobs that have appointments scheduled in the future
    # for job_id in jobs_to_remove:
    #     if job_id in jobs_to_be_marked_complete:
    #         jobs_to_be_marked_complete.pop(job_id, None)
    
    # jobs_to_remove = []
    # for job_id in jobs_to_be_marked_complete:
    #     # check if job has scheduled/unscheduled (a.k.a. incomplete) appointments
    #     if job_id not in jobs_to_remove:
    #         appointment_endpoint = f"{SERVICE_TRADE_API_BASE}/appointment"
    #         appointment_params = {
    #             "jobId": job_id
    #         }

    #         try:
    #             response = api_session.get(appointment_endpoint, params=appointment_params)
    #             response.raise_for_status()
    #         except requests.RequestException as e:
    #             return {}
        
    #         response_data = response.json().get("data", {})
    #         appointments_for_this_job =response_data.get("appointments")
            
    #         for apoint in appointments_for_this_job:
    #             if apoint.get("status") == "scheduled" or apoint.get("status") == "unscheduled":
    #                 jobs_to_remove.append(job_id)
    
    # for job_id in jobs_to_remove:
    #     if job_id in jobs_to_be_marked_complete:
    #         jobs_to_be_marked_complete.pop(job_id, None)
    

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
                    print("OH no no window start for appt")
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
    records = ProcessorMetrics.query.filter_by(week_start=week_start_date).all()
    jobs_by_processor = {}
    hours_by_processor = {}
    for record in records:
        jobs_by_processor[record.processor_name] = record.jobs_processed
        hours_by_processor[record.processor_name] = record.hours_processed
    return jobs_by_processor, hours_by_processor


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
        for event in histories:
            # Assuming each history has a "properties" key which is a dict.
            type = event["type"]
            match type:
                case "job.status.changed":
                    if "status" in event["properties"] and event["properties"]["status"] == "Completed":
                        user_name = event.get("user").get("name")
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
        
