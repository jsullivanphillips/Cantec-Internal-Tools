from flask import Blueprint, render_template, jsonify, session, request, current_app
import requests
import json
from datetime import datetime, timedelta
from dateutil import parser  # Use dateutil for flexible datetime parsing
from collections import Counter
from app.db_models import db, JobSummary, ProcessorMetrics
import sys

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
@processing_attack_bp.route('/processing_attack/complete_jobs', methods=['POST'])
def processing_attack_complete_jobs():
    """
    Returns:
      - Number of jobs to be marked complete.
      - Oldest job's scheduled date, address, and type.
    """
    authenticate()
    oldest_jobs_to_be_marked_complete = []
    jobs_to_be_marked_complete, oldest_job_ids, oldest_inspection_job_id, job_date = get_jobs_to_be_marked_complete()
    if jobs_to_be_marked_complete:
        oldest_inspection_date, oldest_inspection_address, _ = get_oldest_job_data(oldest_inspection_job_id)
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

    number_of_pink_folder_jobs, pink_folder_detailed_info = get_pink_folder_data()

    response_data = {
        "jobs_to_be_marked_complete": len(jobs_to_be_marked_complete),
        "job_type_count": jobs_by_job_type,
        "number_of_pink_folder_jobs" : number_of_pink_folder_jobs,
        "oldest_inspection_date": oldest_inspection_date if oldest_inspection_date else None,
        "oldest_inspection_address" : oldest_inspection_address,
        "pink_folder_detailed_info" : pink_folder_detailed_info,
        "oldest_jobs_to_be_marked_complete" : oldest_jobs_to_be_marked_complete
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

    for job in jobs:
        job_url = "https://app.servicetrade.com/jobs/" + str(job.get("id", ""))
        job_address = job.get("location", {}).get("address", {}).get("street", "")

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

    return len(jobs), pink_folder_detailed_info




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
    authenticate()
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
    
    jobs_to_be_marked_complete = {}
    job_date = {}

    for appt in complete_appointments:
        job = appt.get("job")
        job_id = job.get("id")

        if not job or not job_id:
            continue  # skip if job or job_id is invalid

        # Save the job info if we haven't already
        if job_id not in jobs_to_be_marked_complete:
            jobs_to_be_marked_complete[job_id] = job

        appt_start = appt.get("windowStart")

        # If this is the first time we're seeing this job_id, or the new date is earlier
        if job_id not in job_date or (appt_start and appt_start < job_date[job_id]):
            job_date[job_id] = appt_start


    
    three_months_forward = datetime.now() + timedelta(days=90)    
    scheduleDateTo = int(three_months_forward.timestamp())

    #2.  Get unscheduled appointments to remove jobs with incomplete appointments.
    appointment_params = {
        # "windowBeginsAfter": scheduleDateFrom,
        # "windowEndsBefore": scheduleDateTo,
        #"appointmentWith" : "incompleteServices, allAppointmentsComplete, unscheduledAppointments",
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
    print(f"number of unsched appts: {len(unsched_appointments)}")
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
    
    jobs_to_remove = []
    for job_id in jobs_to_be_marked_complete:
        # check if job has scheduled/unscheduled (a.k.a. incomplete) appointments
        if job_id not in jobs_to_remove:
            appointment_endpoint = f"{SERVICE_TRADE_API_BASE}/appointment"
            appointment_params = {
                "jobId": job_id
            }

            try:
                response = api_session.get(appointment_endpoint, params=appointment_params)
                response.raise_for_status()
            except requests.RequestException as e:
                return {}
        
            response_data = response.json().get("data", {})
            appointments_for_this_job =response_data.get("appointments")
            
            for apoint in appointments_for_this_job:
                if apoint.get("status") == "scheduled" or apoint.get("status") == "unscheduled":
                    jobs_to_remove.append(job_id)
    
    for job_id in jobs_to_remove:
        if job_id in jobs_to_be_marked_complete:
            jobs_to_be_marked_complete.pop(job_id, None)
    
    # Filter and validate timestamps
    valid_jobs_with_dates = [
        (job_id, ts) for job_id, ts in job_date.items()
        if job_id in jobs_to_be_marked_complete and isinstance(ts, (int, float))
    ]

    # Sort by timestamp ascending
    sorted_jobs = sorted(valid_jobs_with_dates, key=lambda item: item[1])

    # Extract the 5 oldest valid job_ids
    oldest_job_ids = [job_id for job_id, _ in sorted_jobs[:5]]

    # Select the oldest inspection job
    oldest_inspection_job_id = 0
    for job_id in oldest_job_ids:
        job_data = jobs_to_be_marked_complete[job_id]
        if job_data.get("type") == "inspection":
            oldest_inspection_job_id = job_id
            break



    return jobs_to_be_marked_complete, oldest_job_ids, oldest_inspection_job_id, job_date



# -------------------------------------------------------
# TOTAL JOBS & TECH HOURS PROCESSED IN THE TIME FRAME
# -------------------------------------------------------
@processing_attack_bp.route('/processing_attack/processed_data', methods=['POST'])
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
    print("Get Jobs Processed!!!!--")
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
    
        print(hours_by_processor)

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

    print("processing week of ", monday_date, "-", friday_date)

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
    print("# jobs to parse: ", num_of_jobs)
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
    print()
    print(jobs_completed_by_processor, " | ", hours_by_processor)
    return jobs_completed_by_processor, hours_by_processor
        
