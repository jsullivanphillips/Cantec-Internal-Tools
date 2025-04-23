from flask import Blueprint, render_template, jsonify, session, request, current_app
import requests
import json
from datetime import datetime, date
from dateutil.relativedelta import relativedelta
import calendar
from dateutil import parser  # Use dateutil for flexible datetime parsing
from collections import Counter
import re
from app.db_models import SchedulingAttack

scheduling_attack_bp = Blueprint('scheduling_attack', __name__, template_folder='templates')
api_session = requests.Session()

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"


all_locations_by_id = {}

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
    

def get_Fa_service_recurrences_in_month(start_of_month):
    recurrence_endpoint = f"{SERVICE_TRADE_API_BASE}/servicerecurrence"
    safe_max = datetime(3000, 1, 1)
    max_timestamp = safe_max.timestamp()
    start_dt = datetime.fromtimestamp(start_of_month)
    page = 1
    locations_in_month = {}
    service_lines_to_exclude = [702, 699]
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
    while True:
        recurrence_params = {
                "endsOnAfter" : max_timestamp,
                "limit" : 250,
                "page" : page,
                "serviceLineIds" : "168,3,1,2,556"
            }
        try:
            response = api_session.get(recurrence_endpoint, params=recurrence_params)
            response.raise_for_status()
        except requests.RequestException as e:
            print("Request error:", e)
        data = response.json().get("data", {})
        service_recurrences = data.get("serviceRecurrences", [])
        
        for thing in service_recurrences:
            if thing is not None:
                service_line_id = thing.get("serviceLine").get("id")
                if service_line_id in service_lines_to_exclude:
                    continue                
                location_address = thing.get("location").get("address").get("street")
                first_start = datetime.fromtimestamp(thing.get("firstStart"))
                location_id = thing.get("location").get("id")
                service_line_id = thing.get("serviceLine").get("id")
                service_line_name = thing.get("serviceLine").get("name")
                is_location_active = thing.get("location").get("status")
                frequency = thing.get("frequency") # and start_dt.year >= first_start.year
                
                if start_dt.month == first_start.month and start_dt.year >= first_start.year and is_location_active == "active" and frequency == "yearly":
                    locations_in_month[location_id] = {"location": thing.get("location"), "serviceLineName" : service_line_name, "serviceLineId" : service_line_id, "firstStart": first_start}
                


        print(f"page {page} of {data.get("totalPages")}", end='\r', flush=True)
        page +=1 
        if data.get("page") >= data.get("totalPages"):
            print(f"Retreived {page-1} page(s) of data for all Service Recurrence's")
            break
    
    return locations_in_month


def get_Spr_service_recurrences_in_month(start_of_month):
    recurrence_endpoint = f"{SERVICE_TRADE_API_BASE}/servicerecurrence"
    safe_max = datetime(3000, 1, 1)
    max_timestamp = safe_max.timestamp()
    start_dt = datetime.fromtimestamp(start_of_month)
    page = 1
    locations_in_month = {}
    service_lines_to_exclude = [702, 699]
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
    while True:
        recurrence_params = {
                "endsOnAfter" : max_timestamp,
                "limit" : 250,
                "page" : page,
                "serviceLineIds" : "5,13,704,83,703"
            }
        try:
            response = api_session.get(recurrence_endpoint, params=recurrence_params)
            response.raise_for_status()
        except requests.RequestException as e:
            print("Request error:", e)
        data = response.json().get("data", {})
        service_recurrences = data.get("serviceRecurrences", [])
        
        for thing in service_recurrences:
            if thing is not None:
                service_line_id = thing.get("serviceLine").get("id")
                if service_line_id in service_lines_to_exclude:
                    continue                
                location_address = thing.get("location").get("address").get("street")
                first_start = datetime.fromtimestamp(thing.get("firstStart"))
                location_id = thing.get("location").get("id")
                service_line_id = thing.get("serviceLine").get("id")
                service_line_name = thing.get("serviceLine").get("name")
                is_location_active = thing.get("location").get("status")
                frequency = thing.get("frequency") # and start_dt.year >= first_start.year
                
                if start_dt.month == first_start.month and start_dt.year >= first_start.year and is_location_active == "active" and frequency == "yearly":
                    locations_in_month[location_id] = {"location": thing.get("location"), "serviceLineName" : service_line_name, "serviceLineId" : service_line_id, "firstStart": first_start}
                


        print(f"page {page} of {data.get("totalPages")}", end='\r', flush=True)
        page +=1 
        if data.get("page") >= data.get("totalPages"):
            print(f"Retreived {data.get("page")} page(s) of data for all Service Recurrence's")
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
    

pattern = r"^(?:\d+(?:_\d+)?(?:t(?:\d+(?:_\d+)?))?|\d+(?:_\d+)?(?:Day(?:s)?)(?:(?:t(?:\d+(?:_\d+)?))|(?:(?:tw|tz)(?:_\d+)?|-\d+(?:_\d+)?Hour(?:s)?(?:t\d+(?:_\d+)?)?))?)$"

########################################################################
# Helper function: Fetch jobs from the API based on parameters.
########################################################################
def fetch_jobs(location_ids_str, scheduleDateFrom, scheduleDateTo, status, job_types, limit=500, initial_page=0):
    """
    Fetch jobs from the jobs endpoint with pagination.
    """
    job_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    all_jobs = []
    page = initial_page
    while True:
        job_params = {
            "page": page,
            "locationId": location_ids_str,
            "limit": limit,
            "scheduleDateFrom": scheduleDateFrom,
            "scheduleDateTo": scheduleDateTo,
            "status": status,
            "type": job_types
        }
        try:
            response = api_session.get(job_endpoint, params=job_params)
            response.raise_for_status()
        except requests.RequestException as e:
            print("Request error (fetch_jobs):", e)
            break
        data = response.json().get("data", {})
        jobs_data = data.get("jobs", [])
        all_jobs.extend(jobs_data)

        page += 1
        print(f"page {page} of {data.get("totalPages")}", end='\r', flush=True)
        if data.get("page") == data.get("totalPages"):
            print(f"Retreived {data.get("page")} page(s) of data for jobs with previously found Service Recurrences")
            break
    return all_jobs

########################################################################
# Helper function: Classify jobs into released and scheduled.
########################################################################
def classify_jobs(all_FA_jobs, all_jobs_to_be_scheduled_from_locations):
    """
    Go through each job and classify it as 'released' or 'scheduled' based on status.
    """
    released_jobs = {}
    scheduled_jobs = {}
    for job in all_FA_jobs:
        location = job.get("location", {})
        location_id = location.get("id")
        location_address = location.get("address", {}).get("street")
        job_status = job.get("status")
        currentAppointment = job.get("currentAppointment")
        # Default released flag to False if there is no appointment.
        is_released = False
        if currentAppointment is not None:
            is_released = currentAppointment.get("released", False)

        # Criteria for "released_jobs"
        if job_status == "completed" or is_released:
            # Use the URL from all_jobs_to_be_scheduled if available.
            url = all_jobs_to_be_scheduled_from_locations.get(location_id, {}).get("url")
            released_jobs[location_id] = {"address": location_address, "url": url}
            
        # Criteria for "scheduled_jobs"
        elif job_status == "scheduled" and not is_released:
            url = all_jobs_to_be_scheduled_from_locations.get(location_id, {}).get("url")
            scheduled_jobs[location_id] = {"address": location_address, "url": url}
    return released_jobs, scheduled_jobs

########################################################################
# Helper function: Build initial jobs_to_be_scheduled.
########################################################################
def initialize_jobs_to_be_scheduled(locations_in_month):
    """
    Construct the initial jobs_to_be_scheduled dictionary from locations_in_month.
    """
    jobs_dict = {}
    for location_id, info in locations_in_month.items():
        location = info.get("location", {})
        location_address = location.get("address", {}).get("street")
        location_url = f"https://app.servicetrade.com/locations/{location_id}"
        if location_id not in jobs_dict:
            jobs_dict[location_id] = {"address": location_address, "url": location_url}
    return jobs_dict

########################################################################
# Helper function: Filter out locations with cancelled inspections.
########################################################################
def filter_cancelled_jobs(jobs_to_be_scheduled, scheduleDateFrom, scheduleDateTo):
    """
    Remove locations from jobs_to_be_scheduled if their most recent inspection job was cancelled.
    """
    location_ids_str = ",".join(str(loc_id) for loc_id in jobs_to_be_scheduled.keys())
    job_params = {
        "locationId": location_ids_str,
        "limit": 2000,
        "status": "scheduled,completed,canceled,new",
        "type": "inspection"
    }
    job_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    try:
        response = api_session.get(job_endpoint, params=job_params)
        response.raise_for_status()
    except requests.RequestException as e:
        print("Request error (filter_cancelled_jobs):", e)
        return jobs_to_be_scheduled
    data = response.json().get("data", {})
    jobs = data.get("jobs", [])
    most_recent_job = {}
    for job in jobs:
        created_date = job.get("created")  # Unix timestamp
        job_status = job.get("status")
        location_id = job.get("location", {}).get("id")
        
        # Update if new or first time seen.
        if (location_id not in most_recent_job) or (created_date > most_recent_job[location_id]["created"]):
            most_recent_job[location_id] = {"created": created_date, "status": job_status}
    for location_id, info in most_recent_job.items():
        if info["status"] == "canceled" and location_id in jobs_to_be_scheduled:
            jobs_to_be_scheduled.pop(location_id)
    return jobs_to_be_scheduled

########################################################################
# Helper function: Filter out locations with replacement/installation/upgrade.
########################################################################
def filter_replacement_jobs(jobs_to_be_scheduled):
    """
    Remove locations that have had a replacement, installation, or upgrade this year.
    """
    location_ids_str = ",".join(str(loc_id) for loc_id in jobs_to_be_scheduled.keys())
    job_params = {
        "locationId": location_ids_str,
        "limit": 2000,
        "status": "completed,scheduled,new",
        "type": "replacement, installation, upgrade"
    }
    job_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    try:
        response = api_session.get(job_endpoint, params=job_params)
        response.raise_for_status()
    except requests.RequestException as e:
        print("Request error (filter_replacement_jobs):", e)
        return jobs_to_be_scheduled
    job_data = response.json().get("data", {})
    jobs = job_data.get("jobs", [])
    current_year_start_ts = int(datetime(datetime.now().year, 1, 1).timestamp())
    for job in jobs:
        created_date = job.get("created")  # Unix timestamp
        if created_date and created_date >= current_year_start_ts:
            location_id = job.get("location", {}).get("id")
            if location_id in jobs_to_be_scheduled:
                jobs_to_be_scheduled.pop(location_id)
    return jobs_to_be_scheduled



########################################################################
# Helper function: Filter out locations that have had an inspection in the last year
########################################################################
def filter_completed_jobs(jobs_to_be_scheduled):
    """
    Remove locations that have had a completed inspection in the past 11 months.
    """
    if not jobs_to_be_scheduled:
        return jobs_to_be_scheduled

    # Create a comma-separated list of location IDs
    location_ids_str = ",".join(str(loc_id) for loc_id in jobs_to_be_scheduled.keys())

    # Get current time and 11 months prior as UNIX timestamps
    today = int(datetime.now().timestamp())
    ten_months_before_today = int((datetime.now() - relativedelta(months=10)).timestamp())

    job_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    job_params = {
        "locationId": location_ids_str,
        "limit": 2000,
        "status": "completed",
        "type": "inspection",
        "scheduleDateFrom": ten_months_before_today,
        "scheduleDateTo": today,
    }

    try:
        response = api_session.get(job_endpoint, params=job_params)
        response.raise_for_status()
    except requests.RequestException as e:
        print("Request error (filter_completed_jobs):", e)
        return jobs_to_be_scheduled

    job_data = response.json().get("data", {})
    jobs = job_data.get("jobs", [])

    # Remove any locations that had a completed inspection in the last 10 months
    for job in jobs:
        location_id = job.get("location", {}).get("id")
        if location_id in jobs_to_be_scheduled:
            jobs_to_be_scheduled.pop(location_id)

    return jobs_to_be_scheduled


########################################################################
# Helper function: Fetch full location details.
########################################################################
def fetch_all_locations_by_id():
    """
    Create a dictionary of all locations on ServiceTrade
    """
    local_all_locations_by_id = {}
    locations_endpoint = f"{SERVICE_TRADE_API_BASE}/location"
    page = 1
    while True:
        location_params = {
            "page" : page,
            "limit": 2000,
        }
        
        try:
            response = api_session.get(locations_endpoint, params=location_params)
            response.raise_for_status()
        except requests.RequestException as e:
            print("Request error (fetch_all_locations_by_id):", e)
            return {}
        location_data = response.json().get("data", {})
        locations = location_data.get("locations", [])

       
        for location in locations:
            loc_id = location.get("id")
            local_all_locations_by_id[loc_id] = location
        
        print(f"page {page} of {location_data.get("totalPages")}", end='\r', flush=True)
        page += 1
        if location_data.get("page") >= location_data.get("totalPages"):
            print(f"Retreived {location_data.get("page")} page(s) of data for all locations")
            break
    
    return local_all_locations_by_id

########################################################################
# Helper function: Process tags for a given job group.
########################################################################
def process_job_group(job_group, all_locations_by_id, group_label):
    """
    Process jobs in a group (e.g., released, scheduled, to-be-scheduled) to compute:
     - Number of FA jobs and tech hours.
     - Number of sprinkler jobs and tech hours.
    Returns a dictionary with these counts.
    """
    num_fa_jobs = 0
    num_fa_tech_hours = 0.0
    num_spr_jobs = 0
    num_spr_tech_hours = 0.0
    not_found_location_ids = []

    for location_id in job_group.keys():
        location = all_locations_by_id.get(location_id)
        if not location:
            not_found_location_ids.append(location_id)
            continue
        tags = location.get("tags", [])
        sprinkler_job_counted = False
        fa_job_counted = False
        fa_tech_count = 0
        fa_time = 0.0

        for tag in tags:
            tag_str = tag.get("name", "")
            # Process sprinkler-related tags.
            if ("Spr_Cantec" in tag_str or "Backflow_Testing_Cantec" in tag_str):
                if not sprinkler_job_counted:
                    num_spr_jobs += 1
                    sprinkler_job_counted = True
            elif tag_str.startswith("Spr_") and ("Spr_Cantec" not in tag_str and "Backflow_Testing_Cantec" not in tag_str and "Spr_Cascade" not in tag_str):
                if not sprinkler_job_counted:
                    num_spr_jobs += 1
                    sprinkler_job_counted = True
                try:
                    num_tech, hours = parse_spr_tag(tag_str)
                    num_spr_tech_hours += num_tech * hours
                except Exception as e:
                    print("Error parsing sprinkler tag", tag_str, ":", e)
            # Process FA-related tags (skip any tag starting with "Spr_").
            elif tag_str.endswith("_tech") and "Spr_" not in tag_str:
                try:
                    fa_tech_count = int(tag_str.split("_tech")[0])
                except ValueError:
                    fa_tech_count = 0
            elif re.fullmatch(pattern, tag_str):
                try:
                    fa_time = parse_fa_timing_tag(tag_str)
                except Exception as e:
                    print("Error parsing FA timing tag", tag_str, ":", e)
        total_fa_hours = 0.0
        if fa_time > 0:
            if fa_tech_count > 0:
                total_fa_hours = fa_tech_count * fa_time
            else:
                total_fa_hours = fa_time
        if total_fa_hours > 0 and not fa_job_counted:
            num_fa_jobs += 1
            num_fa_tech_hours += total_fa_hours
            fa_job_counted = True


    return {
        "fa_jobs": num_fa_jobs,
        "fa_tech_hours": num_fa_tech_hours,
        "spr_jobs": num_spr_jobs,
        "spr_tech_hours": num_spr_tech_hours
    }

def filter_completed_services(jobs_to_be_scheduled, fa_locations, spr_locations):
    """
    For each location in jobs_to_be_scheduled, query for completed jobs:
       - For FA: completed inspections (job type "inspection")
       - For SPR: completed maintenance (job types "planned_maintenance" and "preventative_maintenance")
    Then, remove the location only if it has no outstanding service (i.e. both services are up-to-date).
    """
    # Prepare lists (or sets) of location IDs for each service type.
    fa_ids = set(fa_locations.keys())
    spr_ids = set(spr_locations.keys())
    
    # Set time window: here, we use 10 months (or your threshold) prior to now.
    today_ts = int(datetime.now().timestamp())
    threshold_ts = int((datetime.now() - relativedelta(months=10)).timestamp())
    
    # 1. Query for completed FA inspection jobs for locations in fa_ids
    fa_loc_ids_str = ",".join(str(loc_id) for loc_id in fa_ids)
    fa_jobs = fetch_jobs(fa_loc_ids_str, threshold_ts, today_ts,
                         status="completed", job_types="inspection", limit=2000)
    completed_fa_ids = { job.get("location", {}).get("id") for job in fa_jobs }
    
    # 2. Query for completed sprinkler maintenance jobs for locations in spr_ids.
    spr_loc_ids_str = ",".join(str(loc_id) for loc_id in spr_ids)
    spr_jobs = fetch_jobs(spr_loc_ids_str, threshold_ts, today_ts,
                          status="completed", job_types="planned_maintenance,preventative_maintenance", limit=2000)
    completed_spr_ids = { job.get("location", {}).get("id") for job in spr_jobs }
    
    # 3. Now filter the jobs_to_be_scheduled dictionary.
    # For each location, check:
    #   - If the location has FA service, then it is up-to-date if its ID is in completed_fa_ids.
    #   - Likewise for SPR service.
    filtered_jobs = {}
    
    for loc_id, info in jobs_to_be_scheduled.items():
        # Assume by default that each service is due.
        fa_due = True
        spr_due = True
        
        if loc_id in fa_ids:
            # If the location offers FA service and we have a recent inspection, mark FA as up-to-date.
            if loc_id in completed_fa_ids:
                fa_due = False

        if loc_id in spr_ids:
            # If the location offers sprinkler service and we have a recent maintenance, mark SPR as up-to-date.
            if loc_id in completed_spr_ids:
                spr_due = False

        # Now, if the location offers both types of service, we only want to remove it 
        # if BOTH services are up-to-date.
        if (loc_id in fa_ids and loc_id in spr_ids):
            if fa_due or spr_due:  # at least one is due
                filtered_jobs[loc_id] = info
        # If it only offers FA service:
        elif loc_id in fa_ids:
            if fa_due:
                filtered_jobs[loc_id] = info
        # If it only offers sprinkler service:
        elif loc_id in spr_ids:
            if spr_due:
                filtered_jobs[loc_id] = info
        # If it doesn't appear in either list, you can either keep or discard it.
        else:
            filtered_jobs[loc_id] = info

    return filtered_jobs

########################################################################
# Main function: get_scheduling_attack
########################################################################
def get_scheduling_attack(month_str):
    # Step 1: Authenticate and convert month_str to start-of-month timestamp.
    authenticate()
    start_of_month, _ = convert_month_to_unix_timestamp(month_str)
    
    # Step 1: Get all locations in our account.
    all_locations_by_id = fetch_all_locations_by_id()

    # Step 2: Get service recurrences (locations for the month).
    # locations_in_month: {location_id: {"location": location, "serviceLineName":..., "serviceLineId":...} }
    fa_locations_in_month = get_Fa_service_recurrences_in_month(start_of_month)
    spr_locations_in_month = get_Spr_service_recurrences_in_month(start_of_month)
    print("# of locations with Fa services in month: ", len(fa_locations_in_month))
    print("# of locations with Spr services in month: ", len(spr_locations_in_month))
    location_ids_str = ",".join(str(loc_id) for loc_id in fa_locations_in_month.keys())

    # Step 3: Fetch all jobs in a 6‑month window (3 months back and 3 months ahead).
    now = datetime.now()
    scheduleDateFrom = int((now - relativedelta(months=4)).timestamp())
    scheduleDateTo = int((now + relativedelta(months=4)).timestamp())
    scheduled_and_completed_jobs = fetch_jobs(location_ids_str, scheduleDateFrom, scheduleDateTo,
                            status="scheduled,completed",
                            job_types="inspection,planned_maintenance,preventative_maintenance",
                            limit=500)

    # Step 4: Build initial dictionary for jobs to be scheduled using the locations from recurrences.
    all_jobs_to_be_scheduled_from_locations = initialize_jobs_to_be_scheduled(fa_locations_in_month)

    # Step 5: Classify jobs into released and scheduled.
    released_jobs, scheduled_jobs = classify_jobs(scheduled_and_completed_jobs, all_jobs_to_be_scheduled_from_locations)

    # Step 6: Determine jobs_to_be_scheduled as those not in released_jobs or scheduled_jobs.
    jobs_to_be_scheduled = {loc_id: info for loc_id, info in all_jobs_to_be_scheduled_from_locations.items()
                            if (loc_id not in released_jobs) and (loc_id not in scheduled_jobs)}

    # Step 7: Remove locations with cancelled inspections.
    jobs_to_be_scheduled = filter_cancelled_jobs(jobs_to_be_scheduled, scheduleDateFrom, scheduleDateTo)

    # Step 8: Remove locations with replacement/installation/upgrade this year.
    jobs_to_be_scheduled = filter_replacement_jobs(jobs_to_be_scheduled)

    # Step 9: Remove locations with recently (within the last 10 months) completed inspections
    jobs_to_be_scheduled = filter_completed_services(jobs_to_be_scheduled, fa_locations_in_month, spr_locations_in_month)

    # Step 9: Process tag data for each job category.
    released_metrics = process_job_group(released_jobs, all_locations_by_id, "released")
    scheduled_metrics = process_job_group(scheduled_jobs, all_locations_by_id, "scheduled")
    to_be_scheduled_metrics = process_job_group(jobs_to_be_scheduled, all_locations_by_id, "to_be_scheduled")


    # Step 10: Assemble the response data.
    response_data = {
        "released_fa_jobs": released_metrics.get("fa_jobs", 0),
        "released_fa_tech_hours": released_metrics.get("fa_tech_hours", 0.0),
        "released_sprinkler_jobs": released_metrics.get("spr_jobs", 0),
        "released_sprinkler_tech_hours": released_metrics.get("spr_tech_hours", 0.0),
        "scheduled_fa_jobs": scheduled_metrics.get("fa_jobs", 0),
        "scheduled_fa_tech_hours": scheduled_metrics.get("fa_tech_hours", 0.0),
        "scheduled_sprinkler_jobs": scheduled_metrics.get("spr_jobs", 0),
        "scheduled_sprinkler_tech_hours": scheduled_metrics.get("spr_tech_hours", 0.0),
        "to_be_scheduled_fa_jobs": to_be_scheduled_metrics.get("fa_jobs", 0),
        "to_be_scheduled_fa_tech_hours": to_be_scheduled_metrics.get("fa_tech_hours", 0.0),
        "to_be_scheduled_sprinkler_jobs": to_be_scheduled_metrics.get("spr_jobs", 0),
        "to_be_scheduled_sprinkler_tech_hours": to_be_scheduled_metrics.get("spr_tech_hours", 0.0),
        "jobs_to_be_scheduled": jobs_to_be_scheduled,
        # For debugging, also include any FA locations not counted.
        "not_counted_fa_locations": {}  # (if you later wish to capture these separately)
    }
    return jsonify(response_data)

