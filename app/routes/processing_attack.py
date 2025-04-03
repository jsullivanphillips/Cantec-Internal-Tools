from flask import Blueprint, render_template, jsonify, session, request, current_app
import requests
import json
from datetime import datetime, timedelta
from dateutil import parser  # Use dateutil for flexible datetime parsing
from collections import Counter

processing_attack_bp = Blueprint('processing_attack', __name__, template_folder='templates')
api_session = requests.Session()

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
API_KEY = "YOUR_API_KEY"

@processing_attack_bp.route('/processing_attack', methods=['GET'])
def processing_attack():
    """
    Render the main processing_attack page (HTML).
    """
    return render_template("processing_attack.html")


def authenticate():
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {"username": session.get('username'), "password": session.get('password')}
    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception as e:
        return jsonify({"error": "Authentication failed"}), 401


# -------------------------------------------------------
# JOBS TO BE MARKED COMPLETE & OLDEST JOB & PINK FOLDER JOBS
# -------------------------------------------------------
## TODO: Check if job has ALL appointments completes
@processing_attack_bp.route('/processing_attack/complete_jobs', methods=['POST'])
def processing_attack_complete_jobs():
    """
    Returns:
      - Number of jobs to be marked complete.
      - Oldest job's scheduled date, address, and type.
    """
    authenticate()
   
    jobs_to_be_marked_complete, oldest_job_id, oldest_inspection_job_id = get_jobs_to_be_marked_complete()
    if jobs_to_be_marked_complete:
        oldest_job_date, oldest_job_address, oldest_job_type = get_oldest_job_data(oldest_job_id)
        oldest_inspection_date, oldest_inspection_address, _ = get_oldest_job_data(oldest_inspection_job_id)
    else:
        oldest_job_date, oldest_job_address, oldest_job_type = None, None, None

    jobs_by_job_type = organize_jobs_by_job_type(jobs_to_be_marked_complete)

    number_of_pink_folder_jobs = get_number_of_pink_folder_jobs()

    response_data = {
        "jobs_to_be_marked_complete": len(jobs_to_be_marked_complete),
        "oldest_job_date": oldest_job_date if oldest_job_date else None,
        "oldest_job_address": oldest_job_address,
        "oldest_job_type": proper_format(oldest_job_type) if oldest_job_type else None,
        "job_type_count": jobs_by_job_type,
        "number_of_pink_folder_jobs" : number_of_pink_folder_jobs,
        "oldest_inspection_date": oldest_inspection_date if oldest_inspection_date else None,
        "oldest_inspection_address" : oldest_inspection_address
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


def get_number_of_pink_folder_jobs():
    job_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    job_params = {
        "tag": "PINK_FOLDER"
    }

    try:
        response = api_session.get(job_endpoint, params=job_params)
        response.raise_for_status()
    except requests.RequestException as e:
        # If desired, you could return default values here.
        return None, None, None

    job_response = response.json().get("data", {})
    jobs = job_response.get("jobs", {})
    return len(jobs)


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



def get_jobs_to_be_marked_complete():
    one_year_ago = datetime.now() - timedelta(days=365)
    yesterday = datetime.now() - timedelta(days=1)    
    scheduleDateFrom = int(one_year_ago.timestamp())
    scheduleDateTo = int(yesterday.timestamp())

    #1.  Get appointments that are complete
    appointment_endpoint = f"{SERVICE_TRADE_API_BASE}/appointment"
    appointment_params = {
        "windowBeginsAfter": scheduleDateFrom,
        "windowEndsBefore": scheduleDateTo,
        "jobStatus": "scheduled",
        "appointmentWith": "allAppointmentsComplete",
        "sortOrder": "windowStart"
    }

    try:
        response = api_session.get(appointment_endpoint, params=appointment_params)
        response.raise_for_status()
    except requests.RequestException as e:
        return {}

    complete_appointments_data = response.json().get("data", {})
    complete_appointments = complete_appointments_data.get("appointments", [])
    
    appointments_for_job = {}
    for appt in complete_appointments:
        job = appt.get("job")
        job_id = job.get("id")
        appointments_for_job.setdefault(job_id, []).append(appt)
    
    jobs_to_be_marked_complete = {}
    for job_id, appts in appointments_for_job.items():
        # Simply take the job info from the first appointment
        jobs_to_be_marked_complete[job_id] = appts[0].get("job")
    
    three_months_forward = datetime.now() + timedelta(days=90)    
    scheduleDateTo = int(three_months_forward.timestamp())

    #2.  Get unscheduled appointments to remove jobs with incomplete appointments.
    appointment_params = {
        # "windowBeginsAfter": scheduleDateFrom,
        # "windowEndsBefore": scheduleDateTo,
        "appointmentWith" : "incompleteServices",
        "status" : "unscheduled",
        "jobStatus": "scheduled",
        "sortOrder": "windowStart"
    }

    try:
        response = api_session.get(appointment_endpoint, params=appointment_params)
        response.raise_for_status()
    except requests.RequestException as e:
        return jobs_to_be_marked_complete

    
    unsched_appointments_data = response.json().get("data", {})
    unsched_appointments = unsched_appointments_data.get("appointments", [])
    jobs_to_remove = {appt.get("job").get("id") for appt in unsched_appointments}


    # Remove jobs with incomplete services
    for job_id in jobs_to_remove:
        if job_id in jobs_to_be_marked_complete:
            jobs_to_be_marked_complete.pop(job_id, None)


    # Remove administrative jobs
    jobs_to_remove = []
    for job_id in jobs_to_be_marked_complete:
        if jobs_to_be_marked_complete[job_id].get("type") == "administrative":
            print("removing administrative job: ", jobs_to_be_marked_complete[job_id].get("name"))
            jobs_to_remove.append(job_id)
    
    for job_id in jobs_to_remove:
        del jobs_to_be_marked_complete[job_id]


    #3. Get appointments in the future
    today = datetime.now()  
    scheduleDateFrom = int(today.timestamp())
    scheduleDateTo = int(three_months_forward.timestamp())

    # Get appointments that are scheduled in the future
    appointment_endpoint = f"{SERVICE_TRADE_API_BASE}/appointment"
    appointment_params = {
        "windowBeginsAfter": scheduleDateFrom,
        "windowEndsBefore": scheduleDateTo,
        "sortOrder": "windowStart"
    }

    try:
        response = api_session.get(appointment_endpoint, params=appointment_params)
        response.raise_for_status()
    except requests.RequestException as e:
        return {}

    future_appointments_data = response.json().get("data", {})
    future_appointments = future_appointments_data.get("appointments", [])
    jobs_to_remove = {appt.get("job").get("id") for appt in future_appointments}

    # remove jobs that have appointments scheduled in the future
    for job_id in jobs_to_remove:
        if job_id in jobs_to_be_marked_complete:
            jobs_to_be_marked_complete.pop(job_id, None)
    
    oldest_job_id = next(iter(jobs_to_be_marked_complete))

    oldest_inspection_job_id = 0
    for job_id in jobs_to_be_marked_complete:
        if jobs_to_be_marked_complete[job_id].get("type") == "inspection":
            oldest_inspection_job_id = job_id
            break

    return jobs_to_be_marked_complete, oldest_job_id, oldest_inspection_job_id



# -------------------------------------------------------
# TOTAL JOBS & TECH HOURS PROCESSED IN THE TIME FRAME
# -------------------------------------------------------
@processing_attack_bp.route('/processing_attack/processed_data', methods=['POST'])
def processing_attack_processed_data():
    """
    Returns:
      - Total jobs processed.
      - Total tech hours processed.
    """
    authenticate()

    data = request.get_json()
    selected_monday_str = data.get('selectedMonday', None)
    if selected_monday_str:
        selected_monday = datetime.strptime(selected_monday_str, "%Y-%m-%d").date()
        previous_monday = selected_monday - timedelta(days=7)
        previous_monday_str = previous_monday.strftime("%Y-%m-%d")  # Convert back to string

        # Fetch data using string inputs
        total_jobs_processed, total_tech_hours_processed, jobs_by_type = get_jobs_processed(selected_monday_str)
        total_jobs_processed_previous_week, total_tech_hours_processed_previous_week, _ = get_jobs_processed(previous_monday_str)

    response_data = {
         "total_jobs_processed": total_jobs_processed,
         "total_tech_hours_processed": total_tech_hours_processed,
         "jobs_by_type": jobs_by_type,
         "total_jobs_processed_previous_week": total_jobs_processed_previous_week,
         "total_tech_hours_processed_previous_week": total_tech_hours_processed_previous_week,
    }
    return jsonify(response_data)



def get_jobs_processed(selected_monday):
    """
    Returns total jobs processed, total tech hours processed, and the oldest job id.
    """
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


    total_tech_hours_processed = 0
    for job in jobs:
        job_id = job.get("id")
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

    return total_jobs_processed, round(total_tech_hours_processed, 2), jobs_by_type