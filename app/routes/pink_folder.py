from flask import Blueprint, render_template, session, jsonify
import requests
import json
from datetime import datetime
import pprint

from flask import redirect, url_for

pink_folder_bp = Blueprint('pink_folder', __name__, template_folder='templates')
api_session = requests.Session()

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
SERVICE_TRADE_JOB_BASE = "https://app.servicetrade.com/jobs"
API_KEY = "YOUR_API_KEY"


#Main Route
@pink_folder_bp.route('/pink_folder', methods=['GET'])
def pink_folder():
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
        return redirect(url_for("auth.login"))  # or whatever your login route is
    return render_template("pink_folder.html")

@pink_folder_bp.route('/pink_folder/data', methods=['GET'])
def pink_folder_data():
    detailed_pink_folder_info = get_pink_folder_data()
    return jsonify(detailed_pink_folder_info)



def authenticate():
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {"username": session.get('username'), "password": session.get('password')}
    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception as e:
        return jsonify({"error": "Authentication failed"}), 401


# Returns:
# Dictionary of pink folder jobs, indexed by job id (integer)
#    i. Techs who need to upload (list of strings)
#   ii. Job date (datetime)
#  iii. Address of job (string)
#   iv. Hyperlink to job (string)
#    v. Has the assigned tech uploaded a file? (boolean)
#   vi. Tech hours on the job (float)
def get_pink_folder_data():
    authenticate()
    pp = pprint.PrettyPrinter(indent=2)
    # Step 1) Grab jobs with PINK_FOLDER tag and an unscheduled appointment
    job_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    job_params = {
        "tag": "PINK_FOLDER",
        "appointmentStatus" : "unscheduled",
        # "id": 1962976469306433
    }

    try:
        response = api_session.get(job_endpoint, params=job_params)
        response.raise_for_status()
    except requests.RequestException as e:
        return None, None, None
    
    
    job_response = response.json().get("data", {})
    jobs = job_response.get("jobs", {})

    # job = response.json().get("data", {})
    # jobs = [job]

    
    # Store info in a dictionary with job_id as key
    # Reminder:
    #    i. Techs who need to upload
    #   ii. How old the pink folder job is (when was last onsite appointment)
    #  iii. Address of job
    #   iv. Link to job
    #    v. Has the assigned tech uploaded a file?
    #   vi. Tech hours on the job
    pink_folder_detailed_info = {}
    
    # Step 2) Gather info from jobs
    for job in jobs:
        # A1) Check if job id exists
        job_id = job.get("id")
        if not job_id:
            continue
            
        # A2) Check if current appointment service line is office administrative
        current_appointment = job.get("currentAppointment", {})
        appt_id = current_appointment.get("id")
        endpoint = f"{SERVICE_TRADE_API_BASE}/appointment/{appt_id}"

        try:
            response = api_session.get(endpoint)
            response.raise_for_status()
        except requests.RequestException as e:
            print("exception requesting job current appointment", e)
            continue

        data = response.json().get("data")
        serviceRequests = data.get("serviceRequests", [])
        serviceLine = ''
        if len(serviceRequests) > 0:
            serviceLine = serviceRequests[0].get("serviceLine").get("name")
        
        if serviceLine != "Office Clerical":
            print("Pink folder job with a non office clerical latest appointment")
            continue

        # B) Assign default values
        if job_id not in pink_folder_detailed_info.keys():
            pink_folder_detailed_info[job_id] = {
                'assigned_techs': [], #list of strings
                'job_date': '', # datetime
                'address': '', # string
                'hyperlink': '', # string
                'is_paperwork_uploaded': '', #boolean
                'tech_hours': '' # float
            }

        # C) Grab URL and Address
        job_url = "https://app.servicetrade.com/job/" + str(job_id)
        pink_folder_detailed_info[job_id]['hyperlink'] = job_url

        job_address = job.get("location", {}).get("address", {}).get("street", "")
        pink_folder_detailed_info[job_id]['address'] = job_address

        # E) Grab assigned techs
        techs_on_app = current_appointment.get("techs", [])
        tech_names = []
        for tech in techs_on_app:
            tech_names.append(tech.get("name"))
        pink_folder_detailed_info[job_id]['assigned_techs'] = tech_names


        # D) Calculate tech hours
        tech_hours_on_job = 0 
        clock_endpoint = f"{SERVICE_TRADE_API_BASE}/job/{job_id}/clockevent"
        clock_params = {
            "activity": "onsite"
        }

        try:
            response = api_session.get(clock_endpoint, params=clock_params)
            response.raise_for_status()
        except requests.RequestException as e:
            print("exception requesting clock events for pink folder job", e)
            continue

        clock_event_reponse = response.json()

        clock_events_data = clock_event_reponse.get("data", {})
        paired_events = clock_events_data.get("pairedEvents", [])
        if paired_events:
            for clock_event in paired_events:
                tech_hours_on_job += clock_event.get("elapsedTime", 0)
        
        pink_folder_detailed_info[job_id]['tech_hours'] = tech_hours_on_job / 3600

        # Grab latest non pink folder appoint
        endpoint = f"{SERVICE_TRADE_API_BASE}/appointment"
        params = {
            'jobId': job_id,
            'status': 'completed'
        }
        try:
            response = api_session.get(endpoint, params=params)
            response.raise_for_status()
        except requests.RequestException as e:
            print("exception requesting job appointments", e)
            continue
        
        appointments = response.json().get("data").get("appointments")

        latest_completed_job_appt_date = 0
        for appt in appointments:
            serviceRequests = appt.get("serviceRequests", [])
            serviceLine = ''
            if len(serviceRequests) > 0:
                serviceLine = serviceRequests[0].get("serviceLine").get("name")
        
            if serviceLine == "Office Clerical":
                continue

            if latest_completed_job_appt_date < appt.get("windowStart"):
                latest_completed_job_appt_date = appt.get("windowStart")
        
        pink_folder_detailed_info[job_id]['job_date'] = datetime.fromtimestamp(latest_completed_job_appt_date)




        # Grab history of events on job and interpret whether paperwork has been uploaded
        is_paperwork_uploaded = False
        endpoint = f"{SERVICE_TRADE_API_BASE}/history"
        params = {'entityId': job_id, 'entityType': 3}

        try:
            response = api_session.get(endpoint, params=params)
            response.raise_for_status()
        except requests.RequestException as e:
            print("exception requesting job histry", e)
            continue

        data = response.json().get("data")
        histories = data.get("histories")

        latest_pink_folder_appt_date = 0
        latest_attachment_added_date = 0
        for event in histories:
            # Pink Folder Appointment Created
            if event.get("type") == "job.service.added" and event.get("properties").get("serviceLineName") == "Office Clerical":
                if latest_pink_folder_appt_date < event.get("updated"):
                    latest_pink_folder_appt_date = event.get("updated")
            # Attachment Uploaded
            if event.get("type") == "attachment.added":
                if latest_attachment_added_date < event.get("created"):
                    latest_attachment_added_date = event.get("created")
        
        if latest_attachment_added_date > latest_pink_folder_appt_date:
            is_paperwork_uploaded = True
        
        pink_folder_detailed_info[job_id]['is_paperwork_uploaded'] = is_paperwork_uploaded



    return pink_folder_detailed_info