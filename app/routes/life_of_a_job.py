from flask import Blueprint, render_template, jsonify, session, request, current_app
import json
import math
import requests
from datetime import datetime, timedelta
from dateutil import parser  # Use dateutil for flexible datetime parsing

# Create a blueprint for the life-of-a-job page
life_of_a_job_bp = Blueprint('life_of_a_job', __name__, template_folder='../templates')

# Replace these with your actual ServiceTrade API credentials and endpoint details.
SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
API_KEY = "YOUR_API_KEY"

@life_of_a_job_bp.route("/life-of-a-job", methods=["GET", "POST"])
def life_of_a_job():
    # Initialize API session and authenticate
    api_session = requests.Session()
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {"username": session.get('username'), "password": session.get('password')}
    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception as e:
        current_app.logger.error("Authentication error: %s", e)
        return jsonify({"error": "Authentication failed"}), 401
    
    if request.method == "GET":
        # Render the Life of a Job page template
        return render_template("life_of_a_job.html")
    
    # POST request: process job URL and print job histories for debugging.
    data = request.get_json()
    job_url = data.get("jobUrl")
    if not job_url:
        return jsonify({"error": "Job URL is required."}), 400

    # Extract the job ID from the URL (adjust this logic as needed)
    try:
        # For example, assume the job ID is the last part of the URL:
        job_id = job_url.rstrip("/").split("/")[-1]
    except Exception:
        return jsonify({"error": "Unable to extract job ID from URL."}), 400

    # Construct the API endpoint URL for job history.
    history_endpoint = f"{SERVICE_TRADE_API_BASE}/history"
    history_params = {
        "entityId": job_id,
        "entityType": 3  # Adjust entityType as needed for jobs
    }

    try:
        response = api_session.get(history_endpoint, params=history_params)
        response.raise_for_status()
    except requests.RequestException as e:
        current_app.logger.error("ServiceTrade API error: %s", e)
        return jsonify({"error": f"Error calling ServiceTrade API: {str(e)}"}), 500

    # Parse the returned JSON data
    history_response = response.json().get("data", {})
    histories = history_response.get("histories", [])

    
    
    created_date = datetime
    date_released = datetime
    job_complete_date = datetime
    appointmentDates = {}
    pinkFolderIds = []
    earliestAppointmentStartDate = None
    latestAppointmentEndDate = None
    pinkFolderStartDate = None
    pinkFolderEndDate = None
    
    intervals = {}
    appointments = {}
    job_complete_dates = []
    # Iterate over each history entry and print debug information
    for event in histories:
        # Assuming each history has a "properties" key which is a dict.
        type = event["type"]
        match type:
            case "appointment.changed":
                id = event["entity"]["id"]

                # Initialize an empty dict for this id if it is not already in appointments
                if id not in appointments:
                    appointments[id] = {}
                
                # Date released
                if "isReleased" in event["properties"]:
                    appointments[id]["dateReleased"] = parse_date(event["properties"]["eventTime"]["date"])
                
                # Appointment start and end time
                if event["properties"]["windowStart"] is not None and event["properties"]["windowEnd"] is not None:
                    appointments[id]["startTime"] = datetime.fromtimestamp(event["properties"]["windowStart"])
                    appointments[id]["endTime"] = datetime.fromtimestamp(event["properties"]["windowEnd"])
                
                # Appointment Complete by Tech
                if "status" in event["properties"] and event["properties"]["status"] == "Completed":
                    appointments[id]["dateCompleted"] = parse_date(event["properties"]["eventTime"]["date"])
                    
                    date_completed = parse_date(event["properties"]["eventTime"]["date"])
            
                    appointmentDates[id] = date_completed
            

            # Date when job was created
            case "job.created":
                created_date = parse_date(event["properties"]["eventTime"]["date"])
            
            # Processing done
            case "job.status.changed":
                if "status" in event["properties"] and event["properties"]["status"] == "Completed":
                    job_complete_dates.append(parse_date(event["properties"]["eventTime"]["date"]))
                    job_complete_date = parse_date(event["properties"]["eventTime"]["date"])
            
            # Pink Folder Added
            case "job.service.added":
                if event["properties"]["serviceLineName"] == "Office Clerical":
                    added_date = parse_date(event["properties"]["eventTime"]["date"])
                    if pinkFolderStartDate is None:
                        pinkFolderStartDate = added_date
                    elif added_date < pinkFolderStartDate:
                        pinkFolderStartDate = added_date
            
            # Pink Folder Completed
            case "service.changed":
                if "statusChange" in event["properties"] and  event["properties"]["statusChange"] == "Closed" and event["properties"]["serviceLineName"] == "Office Clerical":
                    completed_date = parse_date(event["properties"]["eventTime"]["date"])
                    if event["entity"]["id"] is not None:
                        id = event["entity"]["id"]
                        print("adding id [", id, "] to pink Folder Ids")
                        pinkFolderIds.append(id)
                    else:
                        print("NO ID IN SERVICE CHANGE")

                    if pinkFolderEndDate is None:
                        pinkFolderEndDate = completed_date
                    elif completed_date > pinkFolderEndDate:
                        pinkFolderEndDate = completed_date
                    
                    

    for id in pinkFolderIds:
        if id in appointmentDates.keys():
            print("removing pink folder date from tech appts")
            del appointmentDates[id]



    for id in appointmentDates:
        date = appointmentDates[id]
        if earliestAppointmentStartDate is None:
            earliestAppointmentStartDate = date
        elif date < earliestAppointmentStartDate:
            earliestAppointmentStartDate = date
        
        if latestAppointmentEndDate is None:
            latestAppointmentEndDate = date
        elif date > latestAppointmentEndDate:
            latestAppointmentEndDate = date
    
    # Released date is from when the earliest appointment was released
    date_released = None

    for appointment in appointments.values():
        if "dateReleased" in appointment:
            if date_released is None:
                date_released = appointment["dateReleased"]
            elif appointment["dateReleased"] < date_released:
                date_released = appointment["dateReleased"]
    
    for complete_date in job_complete_dates:
        if complete_date > job_complete_date:
            job_complete_date = complete_date
    

    # INVOICE DATA
    invoice_endpoint = f"{SERVICE_TRADE_API_BASE}/invoice"
    invoice_params = {
        "jobId" : job_id
    }

    try:
        response = api_session.get(invoice_endpoint, params=invoice_params)
        response.raise_for_status()
    except requests.RequestException as e:
        current_app.logger.error("ServiceTrade API error: %s", e)
        return jsonify({"error": f"Error calling ServiceTrade API: {str(e)}"}), 500

    invoice_data = response.json().get("data", {}).get("invoices", [])
    invoice_date = datetime
    for invoice in invoice_data:
        invoice_date = datetime.fromtimestamp(invoice["transactionDate"])



    # Putting it all together
    intervals["created_to_scheduled"] = calculate_interval(created_date, date_released)
    intervals["scheduled_to_appointment"] = calculate_interval(date_released, earliestAppointmentStartDate)
    intervals["tech_time"] = calculate_interval(earliestAppointmentStartDate, latestAppointmentEndDate)
    intervals["completed_to_processed"] = calculate_interval(latestAppointmentEndDate, job_complete_date)
    intervals["processed_to_invoiced"] = calculate_interval(job_complete_date, invoice_date)
    intervals["pink_folder"] = calculate_interval(pinkFolderStartDate, pinkFolderEndDate)

    job_data = {}
    job_data["date_created"] = created_date.isoformat()
    job_data["date_released"] = date_released.isoformat()
    job_data["tech_time_start"] = earliestAppointmentStartDate.isoformat()
    job_data["tech_time_end"] = latestAppointmentEndDate.isoformat()
    job_data["processing_started"] = latestAppointmentEndDate.isoformat()
    job_data["processing_complete"] = job_complete_date.isoformat()
    job_data["date_invoiced"] = invoice_date.isoformat()
    if pinkFolderStartDate is not None:
        job_data["pink_folder_start"] = pinkFolderStartDate.isoformat()
    if pinkFolderEndDate is not None:
        job_data["pink_folder_end"] = pinkFolderEndDate.isoformat()



    # For now, just return an empty intervals object (or you can return the debug info)
    return jsonify({"intervals": intervals, "job_data": job_data})

def parse_date(date_str):
    """
    Parses a date string into a datetime object.
    Returns None if date_str is None or empty.
    """
    if date_str:
        return parser.isoparse(date_str)
    return None

def calculate_interval(start_date, end_date):
    """
    Calculate the number of days between two dates.
    Returns the number of days as an integer, rounding up for any partial day.
    If either date is None, return None to indicate a pending event.
    """
    if type(start_date) == type(end_date) and start_date and end_date:
        total_seconds = (end_date - start_date).total_seconds()
        days = total_seconds / 86400  # There are 86400 seconds in a day.
        return math.ceil(days)
    return None

@life_of_a_job_bp.route("/average-life-of-a-job", methods=["POST"])
def average_life_of_job():
    data = request.get_json()
    job_type = data.get("jobType")
    week_start = data.get("weekStart")
    if not job_type or not week_start:
        return jsonify({"error": "Both jobType and weekStart are required."}), 400
    
    # Authentication
    api_session = requests.Session()
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {"username": session.get('username'), "password": session.get('password')}
    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception as e:
        current_app.logger.error("Authentication error: %s", e)
        return jsonify({"error": "Authentication failed"}), 401

    week_start_date, week_end_date = get_week_timestamps(week_start)

    # Get jobs of type from the given week
    job_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    job_params = {
        "status" : "completed",
        "completedOnBegin" : week_start_date,
        "completedOnEnd" : week_end_date,
        "type" : job_type
    }

    try:
        response = api_session.get(job_endpoint, params=job_params)
        response.raise_for_status()
    except requests.RequestException as e:
        current_app.logger.error("ServiceTrade API error: %s", e)
        return jsonify({"error": f"Error calling ServiceTrade API: {str(e)}"}), 500

    # Parse the returned JSON data
    jobs_response = response.json().get("data", {})
    jobs = jobs_response.get("jobs")
    job_ids = []
    for job in jobs:
        job_ids.append(job.get("id"))
    
    total = len(job_ids)
    pink_folder_jobs = 0
    events = {}
    for idx, id in enumerate(job_ids):
        events[id] = {}
        result = get_job_events(id)
        if result:
            events[id] = result
            if result["pink_folder"] != None:
                pink_folder_jobs += 1

    average_intervals = calculate_average_intervals(events)

    return jsonify({"intervals": average_intervals, "total_jobs": total, "pink_folder_jobs": pink_folder_jobs })


def get_job_events(job_id):
    api_session = requests.Session()
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {"username": session.get('username'), "password": session.get('password')}
    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception as e:
        current_app.logger.error("Authentication error: %s", e)
        return jsonify({"error": "Authentication failed"}), 401
    

    # Construct the API endpoint URL for job history.
    history_endpoint = f"{SERVICE_TRADE_API_BASE}/history"
    history_params = {
        "entityId": job_id,
        "entityType": 3  # Adjust entityType as needed for jobs
    }

    try:
        response = api_session.get(history_endpoint, params=history_params)
        response.raise_for_status()
    except requests.RequestException as e:
        current_app.logger.error("ServiceTrade API error: %s", e)
        return jsonify({"error": f"Error calling ServiceTrade API: {str(e)}"}), 500

    # Parse the returned JSON data
    history_response = response.json().get("data", {})
    histories = history_response.get("histories", [])

    
    created_date = datetime
    date_released = datetime
    job_complete_date = datetime
    appointmentDates = {}
    pinkFolderDates = []
    earliestAppointmentStartDate = None
    latestAppointmentEndDate = None
    pinkFolderStartDate = None
    pinkFolderEndDate = None
    
    intervals = {}
    appointments = {}
    job_complete_dates = []
    # Iterate over each history entry and print debug information
    for event in histories:
        # Assuming each history has a "properties" key which is a dict.
        type = event["type"]
        match type:
            case "appointment.changed":
                id = event["entity"]["id"]

                # Initialize an empty dict for this id if it is not already in appointments
                if id not in appointments:
                    appointments[id] = {}
                
                # Date released
                if "isReleased" in event["properties"]:
                    appointments[id]["dateReleased"] = parse_date(event["properties"]["eventTime"]["date"])
                
                # Appointment start and end time
                if event["properties"]["windowStart"] is not None and event["properties"]["windowEnd"] is not None:
                    appointments[id]["startTime"] = datetime.fromtimestamp(event["properties"]["windowStart"])
                    appointments[id]["endTime"] = datetime.fromtimestamp(event["properties"]["windowEnd"])
                
                # Appointment Complete by Tech
                if "status" in event["properties"] and event["properties"]["status"] == "Completed":
                    appointments[id]["dateCompleted"] = parse_date(event["properties"]["eventTime"]["date"])
                    
                    date_completed = parse_date(event["properties"]["eventTime"]["date"])
            
                    appointmentDates[id] = date_completed
            

            # Date when job was created
            case "job.created":
                created_date = parse_date(event["properties"]["eventTime"]["date"])
            
            # Processing done
            case "job.status.changed":
                if "status" in event["properties"] and event["properties"]["status"] == "Completed":
                    job_complete_dates.append(parse_date(event["properties"]["eventTime"]["date"]))
                    job_complete_date = parse_date(event["properties"]["eventTime"]["date"])
            
            # Pink Folder Added
            case "job.service.added":
                if event["properties"]["serviceLineName"] == "Office Clerical":
                    added_date = parse_date(event["properties"]["eventTime"]["date"])
                    if pinkFolderStartDate is None:
                        pinkFolderStartDate = added_date
                    elif added_date < pinkFolderStartDate:
                        pinkFolderStartDate = added_date
            
            # Pink Folder Completed
            case "service.changed":
                if "statusChange" in event["properties"] and  event["properties"]["statusChange"] == "Closed" and event["properties"]["serviceLineName"] == "Office Clerical":
                    completed_date = parse_date(event["properties"]["eventTime"]["date"])
                    pinkFolderDates.append(completed_date)
                    
                    if pinkFolderEndDate is None:
                        pinkFolderEndDate = completed_date
                    elif completed_date > pinkFolderEndDate:
                        pinkFolderEndDate = completed_date
                    
    ids_to_delete = []
    for pf_date in pinkFolderDates:
        for appt_id in appointmentDates:
            if appointmentDates[appt_id] >= pf_date:
                ids_to_delete.append(appt_id)
    
    for appt_id in ids_to_delete:
        if appt_id in appointmentDates.keys():
            print("removing pf date from tech dates")
            del appointmentDates[appt_id]


    for appt_id in appointmentDates:
        date = appointmentDates[appt_id]
        if earliestAppointmentStartDate is None:
            earliestAppointmentStartDate = date
        elif date < earliestAppointmentStartDate:
            earliestAppointmentStartDate = date
        
        if latestAppointmentEndDate is None:
            latestAppointmentEndDate = date
        elif date > latestAppointmentEndDate:
            latestAppointmentEndDate = date
    
    # Released date is from when the earliest appointment was released
    date_released = None

    for appointment in appointments.values():
        if "dateReleased" in appointment:
            if date_released is None:
                date_released = appointment["dateReleased"]
            elif appointment["dateReleased"] < date_released:
                date_released = appointment["dateReleased"]
    
    for complete_date in job_complete_dates:
        if complete_date > job_complete_date:
            job_complete_date = complete_date
    

    # INVOICE DATA
    invoice_endpoint = f"{SERVICE_TRADE_API_BASE}/invoice"
    invoice_params = {
        "jobId" : job_id
    }

    try:
        response = api_session.get(invoice_endpoint, params=invoice_params)
        response.raise_for_status()
    except requests.RequestException as e:
        current_app.logger.error("ServiceTrade API error: %s", e)
        return jsonify({"error": f"Error calling ServiceTrade API: {str(e)}"}), 500

    invoice_data = response.json().get("data", {}).get("invoices", [])
    invoice_date = datetime
    for invoice in invoice_data:
        invoice_date = datetime.fromtimestamp(invoice["transactionDate"])

    # Putting it all together
    intervals["created_to_scheduled"] = calculate_interval(created_date, date_released)
    intervals["scheduled_to_appointment"] = calculate_interval(date_released, earliestAppointmentStartDate)
    intervals["tech_time"] = calculate_interval(earliestAppointmentStartDate, latestAppointmentEndDate)
    intervals["completed_to_processed"] = calculate_interval(latestAppointmentEndDate, job_complete_date)
    intervals["processed_to_invoiced"] = calculate_interval(job_complete_date, invoice_date)
    intervals["pink_folder"] = calculate_interval(pinkFolderStartDate, pinkFolderEndDate)

    # For now, just return an empty intervals object (or you can return the debug info
    return intervals


def get_week_timestamps(week_start_iso):
    # Parse the ISO date string into a datetime object.
    # This assumes the ISO string is in YYYY-MM-DD format.
    week_start = datetime.fromisoformat(week_start_iso)
    # Calculate the week end (Friday) assuming week is Monday-Friday:
    week_end = week_start + timedelta(days=4)
    
    # Convert to Unix timestamps (seconds since epoch)
    start_ts = int(week_start.timestamp())
    end_ts = int(week_end.timestamp())
    
    return start_ts, end_ts

def calculate_average_intervals(events):
    """
    Given a dictionary mapping job_id to intervals (another dict),
    compute the average interval for each key.
    """
    sums = {}
    counts = {}

    # Loop over each job's intervals.
    for job_id, intervals in events.items():
        for key, value in intervals.items():
            if value is not None:
                sums[key] = sums.get(key, 0) + value
                counts[key] = counts.get(key, 0) + 1

    averages = {}
    for key in sums:
        # Calculate average and round to 2 decimal places if needed.
        averages[key] = round(sums[key] / counts[key], 2) if counts[key] > 0 else None
    return averages

