from flask import Blueprint, render_template, jsonify, session, request, current_app
import requests
import json
from datetime import datetime
from dateutil.relativedelta import relativedelta
import calendar
from dateutil import parser  # Use dateutil for flexible datetime parsing
from collections import Counter
import re

scheduling_attack_bp = Blueprint('scheduling_attack', __name__, template_folder='templates')
api_session = requests.Session()

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"


## -----
## Helpers
## ------
def authenticate():
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {"username": session.get('username'), "password": session.get('password')}
    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception as e:
        return jsonify({"error": "Authentication failed"}), 401

def convert_month_to_unix_timestamp(month_str):
    year, month = map(int, month_str.split('-'))
    # Start of month: first day at 00:00:00
    start_date = datetime(year, month, 1)
    # End of month: get the last day of the month and set time to 23:59:59
    last_day = calendar.monthrange(year, month)[1]
    end_date = datetime(year, month, last_day, 23, 59, 59)
    start_ts = int(start_date.timestamp())
    end_ts = int(end_date.timestamp())
    return start_ts, end_ts

def parse_fa_timing_tag(tag_str):
    """
    Parses an FA timing tag that can be in one of two types:

    1. Hour format: "x_ytz_w" (e.g. "1_5t0_5"), where the number before the 't'
       represents tech time in hours (underscores in place of decimals).
    2. Day format: Variants including "1Day", "1Daytw", "1Daytw_z", 
       "1Daytz_w", "1Day-xHourtw_z", "1Day-xHourstw_z", "2Days", etc.
       For these, the numeric part before "Day" (or "Days") is converted to days 
       (multiplied by 8 to convert to hours). If the day part is an integer and the tag
       contains a trailing "t" with a fractional part, that fraction is added.

    Examples:
      - "1Day"          => 1 * 8 = 8 hours.
      - "1Dayt0_5"      => 1 + 0.5 = 1.5 days → 1.5 * 8 = 12 hours.
      - "1_5Dayst0_5"   => day part already fractional (1.5 days) → 1.5 * 8 = 12 hours.
      - "1_5t0_5"       => 1.5 hours (original behavior).
    """
    tag_str = tag_str.strip()
    # If the tag contains "day" (in any case), process it as a day format.
    if re.search(r"day", tag_str, re.IGNORECASE):
        # Regex: capture the numeric portion before "Day" or "Days"
        # and optionally capture an additional fraction after a "t"
        m = re.match(r"^(\d+(?:_\d+)?)[dD]ay(?:s)?(?:t(\d+(?:_\d+)?))?$", tag_str)
        if m:
            day_part = m.group(1).replace('_', '.')
            additional = m.group(2)
            # If the day part is already fractional, we ignore the additional part.
            if '.' in day_part:
                total_days = float(day_part)
            else:
                total_days = float(day_part)
                if additional:
                    additional = additional.replace('_', '.')
                    total_days += float(additional)
            return total_days * 8
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
    

## -----
## Routes
## ------
@scheduling_attack_bp.route('/scheduling_attack', methods=['GET'])
def scheduling_attack():
    return render_template("scheduling_attack.html")


@scheduling_attack_bp.route('/scheduling_attack/metrics', methods=['POST'])
def scheduled_jobs():
    authenticate()
    # Extract the month (format: "YYYY-MM") from the POST data.
    data = request.get_json()
    month_str = data.get('month', datetime.now().strftime("%Y-%m"))
    start_of_month, end_of_month = convert_month_to_unix_timestamp(month_str)
    year, month = map(int, month_str.split('-'))
    month_name = datetime(year, month, 1).strftime("%B")

    # Get all locations with the tag of the passed month
    location_endpoint = f"{SERVICE_TRADE_API_BASE}/location"
    all_locations = []
    page = 1
    while True:
        location_params = {
            "page" : page,
            "tag" : month_name,
            "status" : "active",
            "limit" : 500
        }

        try:
            response = api_session.get(location_endpoint, params=location_params)
            response.raise_for_status()
        except requests.RequestException as e:
            print("Request error:", e)
            break
        data = response.json().get("data", {})
        print(f"page : {data.get("page")} of {data.get("totalPages")}")
        location_data = data.get("locations")
        
        
        all_locations.extend(location_data)
        page +=1 
        if data.get("page") == data.get("totalPages"):
            break

    print(f"number of locations with inspections in {month_name}: {len(all_locations)}")
    
    # get a list of all locations id's
    location_ids_str = ",".join(str(location.get("id")) for location in all_locations)

    job_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    all_jobs = []
    all_jobs_by_location_id = {}
    page = 1
    now = datetime.now()
    current_year = now.year
    # January 1st of the current year at midnight
    scheduleDateFrom = int((now - relativedelta(months=3)).timestamp())
    # Three months ahead of today
    scheduleDateTo = int((now + relativedelta(months=3)).timestamp())
    while True:
        job_params = {
            "page" : page,
            "locationId" : location_ids_str,
            "limit" : 500,
            "scheduleDateFrom" : scheduleDateFrom,
            "scheduleDateTo" : scheduleDateTo,
            "status" : "scheduled,completed",
            "type" : "inspection"
        }

        try:
            response = api_session.get(job_endpoint, params=job_params)
            response.raise_for_status()
        except requests.RequestException as e:
            print("Request error:", e)
            break
        data = response.json().get("data", {})
        print(f"page : {data.get("page")} of {data.get("totalPages")}")
        jobs_data = data.get("jobs", [])
        
        for job in jobs_data:
            location_id = job.get("location", {}).get("id")
            all_jobs_by_location_id[location_id] = job

        all_jobs.extend(jobs_data)
        page +=1 
        if data.get("page") == data.get("totalPages"):
            break

    print(f"number of jobs found from the locations: {len(all_jobs)}")
    # Initialize dictionaries to hold locations for each category.
    released_jobs = {}
    scheduled_jobs = {}
    all_jobs_to_be_scheduled = {}

    for location in all_locations:
        location_id = location.get("id")
        location_address = location.get("address", {}).get("street")
        location_url = f"https://app.servicetrade.com/locations/{location_id}"
        if location_id not in all_jobs_to_be_scheduled:
            all_jobs_to_be_scheduled[location_id] = {"address": location_address, "url":location_url}


    for job in all_jobs:
        location = job.get("location", {})
        location_id = location.get("id")
        location_address = location.get("address", {}).get("street")
        
        job_status = job.get("status")
        currentAppointment = job.get("currentAppointment")
        # Default released flag to False if there is no appointment.
        is_released = False
        if currentAppointment is not None:
            is_released = currentAppointment.get("released", False)
        
        # Criteria for "released_jobs":
        # Job is completed or its appointment is marked as released.
        if job_status == "completed" or is_released:
            released_jobs[location_id] = {"address": location_address, "url": all_jobs_to_be_scheduled[location_id].get("url")}
        # Criteria for "scheduled_jobs":
        # Job is scheduled but its appointment is not released.
        elif job_status == "scheduled" and not is_released:
            scheduled_jobs[location_id] = {"address": location_address, "url": all_jobs_to_be_scheduled[location_id].get("url")}

    # Jobs to be scheduled are locations that are not in either released_jobs or scheduled_jobs.
    jobs_to_be_scheduled = {}
    for loc_id, loc_info in all_jobs_to_be_scheduled.items():
        if loc_id not in released_jobs and loc_id not in scheduled_jobs:
            jobs_to_be_scheduled[loc_id] = loc_info



    # ## Remove any locations that don't have services
    # location_ids_str = ",".join(str(location_id) for location_id in jobs_to_be_scheduled.keys())
    # services_endpoint = f"{SERVICE_TRADE_API_BASE}/servicerecurrence"
    # services_params = {
    #         "locationId" : location_ids_str,
    #         "limit" : 2000,
    #     }
    # try:
    #     response = api_session.get(services_endpoint, params=services_params)
    #     response.raise_for_status()
    # except requests.RequestException as e:
    #     print("Request error:", e)
        
    # data = response.json().get("data", {})
    # services = data.get("serviceRecurrences")
    
    # # Build a set of all service location IDs
    # service_location_ids = {service.get("location", {}).get("id") for service in services if service.get("location")}
    # # Remove locations with no services from jobs_to_be_scheduled
    # for location_id in list(jobs_to_be_scheduled.keys()):
    #     if location_id not in service_location_ids:
    #         jobs_to_be_scheduled.pop(location_id)

    # print("Jobs To Be Scheduled Locations after removing no service locations:", len(jobs_to_be_scheduled))

    location_ids_str = ",".join(str(location_id) for location_id in jobs_to_be_scheduled.keys())
    # Remove any locations that have had their most recent annual inspection cancelled
    job_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    job_params = {
            "locationId" : location_ids_str,
            "limit" : 2000,
            "status" : "scheduled,completed,canceled,new",
            "type" : "inspection"
        }
    try:
        response = api_session.get(job_endpoint, params=job_params)
        response.raise_for_status()
    except requests.RequestException as e:
        print("Request error:", e)

    data = response.json().get("data", {})
    jobs = data.get("jobs")
    most_recent_job = {}
    for job in jobs:
        created_date = job.get("created")  # Unix timestamp
        job_status = job.get("status")
        location_id = job.get("location").get("id")
        
        # If this location_id is not yet in most_recent_job or this job is newer, update it.
        if (location_id not in most_recent_job) or (created_date > most_recent_job[location_id]["created"]):
            most_recent_job[location_id] = {"created": created_date, "status": job_status}

    # Now remove locations from jobs_to_be_scheduled if their most recent job is canceled.
    for location_id, job_info in most_recent_job.items():
        if job_info["status"] == "canceled" and location_id in jobs_to_be_scheduled:
            jobs_to_be_scheduled.pop(location_id)

    # Filter out any locations that have had a replacement, installation or upgrade this year
    location_ids_str = ",".join(str(location_id) for location_id in jobs_to_be_scheduled.keys())
    job_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    job_params = {
            "locationId" : location_ids_str,
            "limit" : 2000,
            "status" : "completed,scheduled,new",
            "type" : "replacement,installation,upgrade"
        }
    try:
        response = api_session.get(job_endpoint, params=job_params)
        response.raise_for_status()
    except requests.RequestException as e:
        print("Request error:", e)
        response = None
    
    if response:
        # Get the list of jobs from the response
        job_data = response.json().get("data", {})
        jobs = job_data.get("jobs", [])
        
        # Get the Unix timestamp for January 1st of the current year
        current_year_start_ts = int(datetime(datetime.now().year, 1, 1).timestamp())
        
        # Loop over the jobs and remove any location that has had a replacement,
        # installation, or upgrade created this year
        for job in jobs:
            created_date = job.get("created")  # Unix timestamp
            if created_date and created_date >= current_year_start_ts:
                location_id = job.get("location").get("id")
                if location_id in jobs_to_be_scheduled:
                    jobs_to_be_scheduled.pop(location_id)
                    print("Popping ", job.get("name"), " due to projects job")

    # 'tag formula':
    #   "x_tech" : x = number of techs required for FA part of job
    #   "x_ytz_w" : x_y = number of hours in format 3_5 as in 3.5 hours. If there is only an x, then its just the hour.
    #               z_w = travel time. 3_5 would be 3.5 hours travel time, 3 would be 3 hours travel time. 
    #               3_5t0_5 would be 3.5 hours of FA tech time and 0.5 hours of travel time
    #
    #   "Spr_1x5_5" : represents 1 sprinkler tech for 5.5 hours.
    #   "Spr_2x6" : represents 2 sprinkler techs for 6 hours
    #
   # Initialize counters for each category
    num_spr_jobs_released = 0
    num_fa_jobs_released = 0
    num_fa_tech_hours_released = 0
    num_spr_tech_hours_released = 0

    num_spr_jobs_scheduled = 0
    num_fa_jobs_scheduled = 0
    num_fa_tech_hours_scheduled = 0
    num_spr_tech_hours_scheduled = 0

    num_spr_jobs_to_be_scheduled = 0
    num_fa_jobs_to_be_scheduled = 0
    num_fa_tech_hours_to_be_scheduled = 0
    num_spr_tech_hours_to_be_scheduled = 0

    pattern = r"^(?:\d+(?:_\d+)?(?:t(?:\d+(?:_\d+)?))?|\d+(?:_\d+)?(?:Day(?:s)?)(?:(?:t(?:\d+(?:_\d+)?))|(?:(?:tw|tz)(?:_\d+)?|-\d+(?:_\d+)?Hour(?:s)?(?:t\d+(?:_\d+)?)?))?)$"


    not_counted_fa_locations = {}

    # Process released_jobs
    for location_id in released_jobs.keys():
        location = next((loc for loc in all_locations if loc.get("id") == location_id), None)
        if not location:
            continue
        tags = location.get("tags", [])
        sprinkler_job_counted = False
        fa_job_counted = False
        fa_tech_count = 0  # from the "x_tech" tag
        fa_time = 0.0      # from the "x_ytz_w" tag

        for tag in tags:
            tag_str = tag.get("name", "")
            # Process sprinkler-related tags
            if ("Spr_Cantec" in tag_str or "Backflow_Testing_Cantec" in tag_str):
                if not sprinkler_job_counted:
                    num_spr_jobs_released += 1
                    sprinkler_job_counted = True
            elif tag_str.startswith("Spr_") and ("Spr_Cantec" not in tag_str and "Backflow_Testing_Cantec" not in tag_str):
                if not sprinkler_job_counted:
                    num_spr_jobs_released += 1
                    sprinkler_job_counted = True
                num_tech, hours = parse_spr_tag(tag_str)
                num_spr_tech_hours_released += num_tech * hours
            # Process FA tags (skip any tag starting with "Spr_")
            elif tag_str.endswith("_tech") and "Spr_" not in tag_str:
                try:
                    fa_tech_count = int(tag_str.split("_tech")[0])
                except ValueError:
                    fa_tech_count = 0
            # Otherwise, if it contains "t", assume it is the timing tag
            elif re.fullmatch(pattern, tag_str):
                fa_time = parse_fa_timing_tag(tag_str)
        
        # Calculate total FA tech hours for this job.
        total_fa_hours = 0.0
        if fa_time > 0:
            if fa_tech_count > 0:
                total_fa_hours = fa_tech_count * fa_time
            else:
                total_fa_hours = fa_time
        if total_fa_hours > 0 and not fa_job_counted:
            num_fa_jobs_released += 1
            num_fa_tech_hours_released += total_fa_hours
            fa_job_counted = True

    # Process scheduled_jobs similarly
    for location_id in scheduled_jobs.keys():
        location = next((loc for loc in all_locations if loc.get("id") == location_id), None)
        if not location:
            continue
        tags = location.get("tags", [])
        sprinkler_job_counted = False
        fa_job_counted = False
        fa_tech_count = 0  # from the "x_tech" tag
        fa_time = 0.0      # from the "x_ytz_w" tag

        for tag in tags:
            tag_str = tag.get("name", "")
            # Process sprinkler-related tags
            if ("Spr_Cantec" in tag_str or "Backflow_Testing_Cantec" in tag_str):
                if not sprinkler_job_counted:
                    num_spr_jobs_released += 1
                    sprinkler_job_counted = True
            elif tag_str.startswith("Spr_") and ("Spr_Cantec" not in tag_str and "Backflow_Testing_Cantec" not in tag_str):
                if not sprinkler_job_counted:
                    num_spr_jobs_released += 1
                    sprinkler_job_counted = True
                num_tech, hours = parse_spr_tag(tag_str)
                num_spr_tech_hours_released += num_tech * hours
            # Process FA tags (skip any tag starting with "Spr_")
            elif tag_str.endswith("_tech") and "Spr_" not in tag_str:
                try:
                    fa_tech_count = int(tag_str.split("_tech")[0])
                except ValueError:
                    fa_tech_count = 0
            # Otherwise, if it contains "t", assume it is the timing tag
            elif re.fullmatch(pattern, tag_str):
                fa_time = parse_fa_timing_tag(tag_str)
        
        total_fa_hours = 0.0
        if fa_time > 0:
            if fa_tech_count > 0:
                total_fa_hours = fa_tech_count * fa_time
            else:
                total_fa_hours = fa_time
        if total_fa_hours > 0 and not fa_job_counted:
            num_fa_jobs_scheduled += 1
            num_fa_tech_hours_scheduled += total_fa_hours
            fa_job_counted = True

    # Process jobs_to_be_scheduled similarly
    for location_id in jobs_to_be_scheduled.keys():
        location = next((loc for loc in all_locations if loc.get("id") == location_id), None)
        if not location:
            continue
        tags = location.get("tags", [])
        sprinkler_job_counted = False
        fa_job_counted = False
        fa_tech_count = 0  # from the "x_tech" tag
        fa_time = 0.0      # from the "x_ytz_w" tag

        for tag in tags:
            tag_str = tag.get("name", "")
            # Process sprinkler-related tags
            if ("Spr_Cantec" in tag_str or "Backflow_Testing_Cantec" in tag_str):
                if not sprinkler_job_counted:
                    num_spr_jobs_released += 1
                    sprinkler_job_counted = True
            elif tag_str.startswith("Spr_") and ("Spr_Cantec" not in tag_str and "Backflow_Testing_Cantec" not in tag_str):
                if not sprinkler_job_counted:
                    num_spr_jobs_released += 1
                    sprinkler_job_counted = True
                num_tech, hours = parse_spr_tag(tag_str)
                num_spr_tech_hours_released += num_tech * hours
            # Process FA tags (skip any tag starting with "Spr_")
            elif tag_str.endswith("_tech") and "Spr_" not in tag_str:
                try:
                    fa_tech_count = int(tag_str.split("_tech")[0])
                except ValueError:
                    fa_tech_count = 0
            # Otherwise, if it contains "t", assume it is the timing tag
            elif re.fullmatch(pattern, tag_str):
                fa_time = parse_fa_timing_tag(tag_str)
        
        total_fa_hours = 0.0
        if fa_time > 0:
            if fa_tech_count > 0:
                total_fa_hours = fa_tech_count * fa_time
            else:
                total_fa_hours = fa_time
        if total_fa_hours > 0 and not fa_job_counted:
            num_fa_jobs_to_be_scheduled += 1
            
            num_fa_tech_hours_to_be_scheduled += total_fa_hours
            fa_job_counted = True
        elif total_fa_hours <= 0:
            print(f"{jobs_to_be_scheduled[location_id]} total fa hours not greater than 0 so not counted")
            not_counted_fa_locations[location_id] = jobs_to_be_scheduled[location_id]



    # Print out the computed metrics
    print("RELEASED JOBS\nReleased FA jobs:", num_fa_jobs_to_be_scheduled, "\nReleased FA tech hours:", num_fa_tech_hours_released)
    print("Released Sprinkler jobs:", num_spr_jobs_released, "\nReleased Sprinkler tech hours:", num_spr_tech_hours_released)
    print("SCHEDULED JOBS\nScheduled FA jobs:", num_fa_jobs_scheduled, "\nScheduled FA tech hours:", num_fa_tech_hours_scheduled)
    print("Scheduled Sprinkler jobs:", num_spr_jobs_scheduled, "\ncheduled Sprinkler tech hours:", num_spr_tech_hours_scheduled)
    print("TO BE SCHEDULED\nTo be Scheduled FA jobs:", num_fa_jobs_to_be_scheduled, "\nTo be Scheduled FA tech hours:", num_fa_tech_hours_to_be_scheduled)
    print("To be Scheduled Sprinkler jobs:", num_spr_jobs_to_be_scheduled, "\nTo be Scheduled Sprinkler tech hours:", num_spr_tech_hours_to_be_scheduled)


    response_data = {
        "released_fa_jobs": num_fa_jobs_released,
        "released_fa_tech_hours": num_fa_tech_hours_released,
        "released_sprinkler_jobs": num_spr_jobs_released,
        "released_sprinkler_tech_hours": num_spr_tech_hours_released,
        "scheduled_fa_jobs": num_fa_jobs_scheduled,
        "scheduled_fa_tech_hours": num_fa_tech_hours_scheduled,
        "scheduled_sprinkler_jobs": num_spr_jobs_scheduled,
        "scheduled_sprinkler_tech_hours": num_spr_tech_hours_scheduled,
        "to_be_scheduled_fa_jobs": num_fa_jobs_to_be_scheduled,
        "to_be_scheduled_fa_tech_hours": num_fa_tech_hours_to_be_scheduled,
        "to_be_scheduled_sprinkler_jobs": num_spr_jobs_to_be_scheduled,
        "to_be_scheduled_sprinkler_tech_hours": num_spr_tech_hours_to_be_scheduled,
        "jobs_to_be_scheduled" : jobs_to_be_scheduled,
        "not_counted_fa_locations" : not_counted_fa_locations
    }
    return jsonify(response_data)

