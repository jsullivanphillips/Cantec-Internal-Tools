from flask import Blueprint, render_template, jsonify, session, request, current_app
import requests
import json
from datetime import datetime
from dateutil.relativedelta import relativedelta
import calendar
from dateutil import parser  # Use dateutil for flexible datetime parsing
from collections import Counter
import re
from app.models import SchedulingAttack

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
    

def get_service_recurrences_in_month(start_of_month):
    recurrence_endpoint = f"{SERVICE_TRADE_API_BASE}/servicerecurrence"
    safe_max = datetime(3000, 1, 1)
    max_timestamp = safe_max.timestamp()
    start_dt = datetime.fromtimestamp(start_of_month)
    page = 1
    locations_in_month = {}
    while True:
        recurrence_params = {
                "endsOnAfter" : max_timestamp,
                "limit" : 250,
                "page" : page
            }
        try:
            response = api_session.get(recurrence_endpoint, params=recurrence_params)
            response.raise_for_status()
        except requests.RequestException as e:
            print("Request error:", e)
        data = response.json().get("data", {})
        service_recurrences = data.get("serviceRecurrences", [])
        print(f"page {page} of {data.get("totalPages")}")
        for thing in service_recurrences:
            if thing is not None:
                first_start = datetime.fromtimestamp(thing.get("firstStart"))
                location_id = thing.get("location").get("id")
                service_line_id = thing.get("serviceLine").get("id")
                service_line_name = thing.get("serviceLine").get("name")
                is_location_active = thing.get("location").get("status")
                frequency = thing.get("frequency")
                if start_dt.month == first_start.month and is_location_active == "active" and frequency == "yearly":
                    locations_in_month[location_id] = {"location": thing.get("location"), "serviceLineName" : service_line_name, "serviceLineId" : service_line_id}

        page +=1 
        if data.get("page") >= data.get("totalPages"):
            break
    
    return locations_in_month

    


## -----
## Routes
## ------
@scheduling_attack_bp.route('/scheduling_attack', methods=['GET'])
def scheduling_attack():
    return render_template("scheduling_attack.html")


@scheduling_attack_bp.route('/scheduling_attack/metrics', methods=['POST'])
def scheduled_jobs():
    data = request.get_json()
    # Expecting the month string in "YYYY-MM" format; default to current month if not provided
    month_str = data.get('month', datetime.now().strftime("%Y-%m"))
    
    # Convert month_str to a date object representing the first day of the month
    try:
        month_date = datetime.strptime(month_str, "%Y-%m").date()
    except ValueError:
        return jsonify({"error": "Invalid month format, expected YYYY-MM"}), 400

    # Query the database for a record with the given month_start date
    record = SchedulingAttack.query.filter_by(month_start=month_date).first()

    if record:
        result = {
            "month_start": record.month_start.strftime("%Y-%m-%d"),
            "released_fa_jobs": record.released_fa_jobs,
            "released_fa_tech_hours": record.released_fa_tech_hours,
            "scheduled_fa_jobs": record.scheduled_fa_jobs,
            "scheduled_fa_tech_hours": record.scheduled_fa_tech_hours,
            "to_be_scheduled_fa_jobs": record.to_be_scheduled_fa_jobs,
            "to_be_scheduled_fa_tech_hours": record.to_be_scheduled_fa_tech_hours,
            "released_sprinkler_jobs": record.released_sprinkler_jobs,
            "released_sprinkler_tech_hours": record.released_sprinkler_tech_hours,
            "scheduled_sprinkler_jobs": record.scheduled_sprinkler_jobs,
            "scheduled_sprinkler_tech_hours": record.scheduled_sprinkler_tech_hours,
            "to_be_scheduled_sprinkler_jobs": record.to_be_scheduled_sprinkler_jobs,
            "to_be_scheduled_sprinkler_tech_hours": record.to_be_scheduled_sprinkler_tech_hours,
            "jobs_to_be_scheduled": record.jobs_to_be_scheduled,
            "not_counted_fa_locations": record.not_counted_fa_locations,
            "updated_at": record.updated_at.isoformat() if record.updated_at else None
        }
        return jsonify(result)
    else:
        return jsonify({
            "error": "No scheduling attack metrics found for month", 
            "month": month_str
        }), 404
    

def get_scheduling_attack(month_str):
    authenticate()
    start_of_month, _ = convert_month_to_unix_timestamp(month_str)
    # locations_in_month[location_id] = {"location": location, "serviceLineName" : service_line_name, "serviceLineId" : service_line_id}
    locations_in_month = get_service_recurrences_in_month(start_of_month)

    # get a list of all locations id's
    location_ids_str = ",".join(str(location_id) for location_id in locations_in_month.keys())

    job_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    all_jobs = []
    all_jobs_by_location_id = {}
    page = 1
    now = datetime.now()

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
        jobs_data = data.get("jobs", [])
        
        for job in jobs_data:
            location_id = job.get("location", {}).get("id")
            all_jobs_by_location_id[location_id] = job

        all_jobs.extend(jobs_data)
        page +=1 
        if data.get("page") == data.get("totalPages"):
            break

    # Initialize dictionaries to hold locations for each category.
    released_jobs = {}
    scheduled_jobs = {}
    all_jobs_to_be_scheduled = {}

    for location_id in locations_in_month:
        location_address = locations_in_month[location_id].get("location").get("address").get("street")
        location_url = f"https://app.servicetrade.com/locations/{location_id}"
        if location_id not in all_jobs_to_be_scheduled:
            all_jobs_to_be_scheduled[location_id] = {"address": location_address, "url":location_url}

    print(f"all jobs to be scheduled length: {len(all_jobs_to_be_scheduled)}")

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

    print(f"number of released_jobs: {len(released_jobs)}")
    print(f"number of scheduled_jobs: {len(scheduled_jobs)}")
    print(f"number of jobs_to_be_scheduled: {len(jobs_to_be_scheduled)}")

    location_ids_str = ",".join(str(location_id) for location_id in jobs_to_be_scheduled.keys())
    print("location_id_strings--\n", location_ids_str)
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
                    
    
    location_ids_str = ",".join(str(location_id) for location_id in locations_in_month.keys())
    print("location strings ", location_ids_str)
    all_locations_by_id = {}
    locations_endpoint = f"{SERVICE_TRADE_API_BASE}/location"
    location_params = {
            "locationId" : location_ids_str,
            "limit" : 2000,
        }
    try:
        response = api_session.get(locations_endpoint, params=location_params)
        response.raise_for_status()
    except requests.RequestException as e:
        print("Request error:", e)
        response = None
    if response:
        # Get the list of jobs from the response
        location_data = response.json().get("data", {})
        locations = location_data.get("locations", [])
        for location in locations:
            location_id = location.get("id")
            all_locations_by_id[location_id] = location

    print("length of all locations ", len(all_jobs_by_location_id))
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
    print(f"number of released_jobs: {len(released_jobs)}")
    print(f"number of scheduled_jobs: {len(scheduled_jobs)}")
    print(f"number of jobs_to_be_scheduled: {len(jobs_to_be_scheduled)}")

    # Process released_jobs
    for location_id in released_jobs.keys():
        # locations_in_month[location_id] = {"location": location, "serviceLineName" : service_line_name, "serviceLineId" : service_line_id}
        # Basically, if the location isn't in "all locations by id" the job hasn't been scheduled? TODO: Investigate more
        if location_id in all_locations_by_id.keys():
            location = all_locations_by_id[location_id]
        else:
            print(f"{location_id} not in all all locations_by_id")
            location = None
        if not location:
            continue
        tags = location.get("tags", [])
        print(f"Tags for {location.get("address").get("street")}: {tags}")
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

    spr_jobs_scheduled = {}
    fa_jobs_scheduled = {}
    # Process scheduled_jobs similarly
    for location_id in scheduled_jobs.keys():
        if location_id in all_locations_by_id.keys():
            location = all_locations_by_id[location_id]
        else:
            print(f"{location_id} not in all all locations_by_id")
            location = None
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
                    num_spr_jobs_scheduled += 1
                    spr_jobs_scheduled[location_id] = {"address": location.get("address").get("street")}
                    sprinkler_job_counted = True
            elif tag_str.startswith("Spr_") and ("Spr_Cantec" not in tag_str and "Backflow_Testing_Cantec" not in tag_str):
                if not sprinkler_job_counted:
                    num_spr_jobs_scheduled += 1
                    spr_jobs_scheduled[location_id] = {"address": location.get("address").get("street")}
                    sprinkler_job_counted = True
                num_tech, hours = parse_spr_tag(tag_str)
                num_spr_tech_hours_scheduled += num_tech * hours
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
            fa_jobs_scheduled[location_id] = {"address": location.get("address").get("street")}
            num_fa_tech_hours_scheduled += total_fa_hours
            fa_job_counted = True


    spr_jobs_to_be_scheduled = {}
    fa_jobs_to_be_scheduled = {}
    # Process jobs_to_be_scheduled similarly
    for location_id in jobs_to_be_scheduled.keys():
        if location_id in all_locations_by_id.keys():
            location = all_locations_by_id[location_id]
        else:
            print(f"{location_id} not in all all locations_by_id")
            location = None
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
                    num_spr_jobs_to_be_scheduled += 1
                    spr_jobs_to_be_scheduled[location_id] = {"address": location.get("address").get("street")}
                    sprinkler_job_counted = True
            elif tag_str.startswith("Spr_") and ("Spr_Cantec" not in tag_str and "Backflow_Testing_Cantec" not in tag_str):
                if not sprinkler_job_counted:
                    num_spr_jobs_to_be_scheduled += 1
                    spr_jobs_to_be_scheduled[location_id] = {"address": location.get("address").get("street")}
                    sprinkler_job_counted = True
                num_tech, hours = parse_spr_tag(tag_str)
                num_spr_tech_hours_to_be_scheduled += num_tech * hours
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
            fa_jobs_to_be_scheduled[location_id] = {"address": location.get("address").get("street")}
            num_fa_tech_hours_to_be_scheduled += total_fa_hours

        elif total_fa_hours <= 0:
            not_counted_fa_locations[location_id] = jobs_to_be_scheduled[location_id]

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

