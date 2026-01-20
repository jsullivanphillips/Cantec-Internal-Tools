# app/scripts/scheduling_attack_update_v2.py
import os
import requests
from tqdm import tqdm
import logging
import argparse
import json
from datetime import datetime, timedelta, timezone
from dateutil.relativedelta import relativedelta

from app import create_app
from app.db_models import db, Location, SchedulingAttackV2

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
api_session = requests.Session()
api_session.headers.update({"Accept": "application/json"})

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger("backfill")

REQUIRED_KEYS = {
    "location_id",
    "address",
    "month",
    "scheduled",
    "scheduled_date",
    "confirmed",
    "reached_out",
    "completed",
    "canceled",
    "notes",
}

BOOL_KEYS = {"scheduled", "confirmed", "reached_out", "completed", "canceled"}


#region Service Trade Helpers
def authenticate(username: str, password: str) -> None:
    auth_url = f"{SERVICE_TRADE_API_BASE}/auth"
    resp = api_session.post(auth_url, json={"username": username, "password": password})
    resp.raise_for_status()


def call_service_trade_api(endpoint: str, params=None):
    url = f"{SERVICE_TRADE_API_BASE}/{endpoint}"
    resp = api_session.get(url, params=params or {})
    resp.raise_for_status()
    return resp.json()
#endregion


def get_location_ids_to_process(max_locations: int | None):
    q = db.session.query(Location.location_id)
    
    q = q.filter(Location.status == "active")

    if max_locations:
        q = q.limit(max_locations)

    for (loc_id,) in q.yield_per(1000):
        yield loc_id


def normalized_service_month(first_start_ts: int, now: datetime | None = None) -> datetime:
    """
    Returns a month anchor (1st day 00:00) that is always >= start of previous month,
    preferring the future (or current month), except allowing the directly previous month.
    """
    now = now or datetime.now(timezone.utc)

    # window start = first day of previous month at 00:00
    window_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0) - relativedelta(months=1)

    month_anchor = datetime.fromtimestamp(first_start_ts, tz=timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )

    # If it’s too far in the past, roll it forward by years until it's in range
    while month_anchor < window_start:
        month_anchor += relativedelta(years=1)

    return month_anchor

def is_relevant_annual_recurrence(rec: dict) -> bool:
    if rec.get("frequency") != "yearly" or int(rec.get("interval", 0)) != 1:
        return False
  
    sl_id = (rec.get("serviceLine") or {}).get("id", "")
    if sl_id not in {1, 2, 3, 168, 556}:
        return False
    return True
    

def upsert_into_database(location_values: dict) -> SchedulingAttackV2:
    # ---- validate input ----
    if not isinstance(location_values, dict):
        raise TypeError("location_values must be a dict")

    missing = REQUIRED_KEYS - location_values.keys()
    if missing:
        raise ValueError(f"location_values missing keys: {sorted(missing)}")

    location_id = location_values["location_id"]
    if not isinstance(location_id, int):
        raise TypeError("location_values['location_id'] must be an int")

    address = (location_values["address"] or "").strip()
    if not address:
        raise ValueError("location_values['address'] must be non-empty")

    month = location_values["month"]
    if not isinstance(month, datetime):
        raise TypeError("location_values['month'] must be a datetime")
    
    scheduled_date = location_values["scheduled_date"]
    if scheduled_date is not None and not isinstance(scheduled_date, datetime):
        raise TypeError("location_values['scheduled_date'] must be a datetime or None")

    for key in BOOL_KEYS:
        if not isinstance(location_values[key], bool):
            raise TypeError(f"location_values['{key}'] must be bool")

    notes = location_values["notes"]
    if notes is not None and not isinstance(notes, str):
        raise TypeError("location_values['notes'] must be str or None")

    # ---- upsert by location_id ----
    row = (
        db.session.query(SchedulingAttackV2)
        .filter(SchedulingAttackV2.location_id == location_id)
        .one_or_none()
    )

    if row is None:
        row = SchedulingAttackV2(
            location_id=location_id,
            address=address,
            month=month,
            scheduled=location_values["scheduled"],
            scheduled_date = location_values["scheduled_date"],
            confirmed=location_values["confirmed"],
            reached_out=location_values["reached_out"],
            completed=location_values["completed"],
            canceled=location_values["canceled"],
            notes=notes,
        )
        db.session.add(row)
    else:
        row.address = address
        row.month = month
        row.scheduled = location_values["scheduled"]
        row.scheduled_date = location_values["scheduled_date"]
        row.confirmed = location_values["confirmed"]
        row.reached_out = location_values["reached_out"]
        row.completed = location_values["completed"]
        row.canceled = location_values["canceled"]
        row.notes = notes

    db.session.commit()
    return row


def main():
    # Program updates scheduling_attack_v2 table. There are X update scenarios for a location
    # CASE 1: Service exists, job is not yet scheduled.
    # CASE 2: Service exists, job is completed.
    # CASE 3: Service exists, job is scheduled, job is confirmed
    # CASE 4: Service exists, job is scheduled, job is not confirmed
    parser = argparse.ArgumentParser(description="Update service events for all locations or a specific location from ServiceTrade.")
    parser.add_argument("--location-id", type=int, help="Single ServiceTrade locationId to backfill")
    parser.add_argument("--max-locations", type=int, help="Process at most N locations")
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        # Authenticate with ServiceTrade API
        username = os.getenv("PROCESSING_USERNAME")
        password = os.getenv("PROCESSING_PASSWORD")
        if not username or not password:
            raise SystemExit("Missing PROCESSING_USERNAME/PROCESSING_PASSWORD environment vars.")
        authenticate(username, password)

        # Fetch location_ids to process
        if args.location_id:
            loc_ids = [args.location_id]
        else:
            loc_ids = list(get_location_ids_to_process(
                max_locations=args.max_locations
            ))

        total = len(loc_ids)
        log.info("Locations to process: %s", total)

        jobs_processed = 0
        skipped = 0
        errors = 0

        # Main Loop
        with tqdm(loc_ids, total=total, desc="Updating SchedulingAttack V2", mininterval=0.5) as pbar:
            for location_id in pbar:
                # Step 0: Prepare values and validate location
                location_values = {
                    "location_id": None,   # Step 0
                    "address": "",         # Step 0
                    "month": datetime,     # Step 1
                    "scheduled": False,    # Step 2
                    "scheduled_date": None,# Step 2
                    "confirmed": False,    # Step 3
                    "reached_out": False,  # Manual Insertion
                    "completed": False,    # Step 3
                    "canceled": False,
                    "notes": ""            # Manual Insertion
                }

                # Fetch location resource from ServiceTrade
                response = call_service_trade_api(f"location/{location_id}")
                
                # Check for errors
                if response.get("data") is None:
                    errors += 1
                    log.warning(f"Skipping location [{location_id}] due to missing data in service trade API response")
                    continue
                
                location_data = response.get("data")

                # Check if location is "On-Hold"
                tags = location_data.get("tags")
                if any(tag.get("name") == "On_Hold" for tag in tags):
                    skipped += 1
                    log.info(f"Skipping location [{location_id}] due to On_Hold tag")
                    continue
                # Save address
                location_values["address"] = location_data.get("address").get("street")
                location_values["location_id"] = location_id
                
                # Step 1: Find month inspection service is due.
                params = {"locationIds": str(location_id), "limit": 500}
                location_services_response = call_service_trade_api("servicerecurrence", params=params)
                location_services = location_services_response.get("data", {}).get("serviceRecurrences")

                # ServiceTrade has a weird system for tracking recurring services. See notes below.
                relevant_annual_services = []
                for service in location_services:
                    # When there is a recurring service, the ServiceTrade's API creates a new service each time
                    # the service is completed. The completed service instance has it's "endsOn" value set to the date that the service was completed.
                    # A new identical service is then created with its "endsOn" set to None. 
                    if service.get("endsOn") is None:
                        # Only track relevant annual service lines (annual inspections)
                        if is_relevant_annual_recurrence(service):
                            relevant_annual_services.append(service)

                # Handle locations with no relevant annual services
                if not relevant_annual_services:
                    # Scenarios to handle:
                    # A) Site was created so we can generate a quote for them. 
                    # Check if there are any COMPLETED INSPECTION jobs on this location. If not, ignore.
                    params = {
                        "locationId": str(location_id), "limit": 500,
                        "type": "inspection","status": "completed"
                    }
                
                    inspection_jobs_response = call_service_trade_api("job", params=params)
                    inspection_jobs = inspection_jobs_response.get("data", {}).get("jobs", [])
                    if len(inspection_jobs) < 1:
                        skipped += 1
                        continue
                    
                    # B) We previously have done an inspection, but no recurring service was created.
                    log.warning(f"No services on location {location_id}")
                    continue

                
                for service in relevant_annual_services:
                    location_values["month"] = normalized_service_month(service["firstStart"])
                
                # Step 2: Find if a job has been scheduled.
                # Is there some value in only searching in the month and surrounding months that the service was set to?
                # I think so.
                # Possibly revisit this if the values we are displaying are not in line with Michelle's experience.
                month_prior_to_service_date = location_values["month"] - timedelta(days=31)
                month_post_to_service_date = location_values["month"] + timedelta(days=60)
                
                
                params = {"locationId": str(location_id), "limit": 500,
                          "scheduleDateFrom": datetime.timestamp(month_prior_to_service_date),
                          "scheduleDateTo": datetime.timestamp(month_post_to_service_date),
                          "type": "inspection,replacement,installation,upgrade",
                          "status": "scheduled,completed"
                        }
                
                inspection_jobs_response = call_service_trade_api("job", params=params)
                inspection_jobs = inspection_jobs_response.get("data", {}).get("jobs", [])

                # There should be 1 or 0 jobs returned by this query.
                # If there is a different result, throw a warning.
                if len(inspection_jobs) > 1:
                    errors += 1
                    log.warning(f"More than 2 inspection jobs found in location [{location_id}] annual service month.")
                
                if not inspection_jobs:
                    # CASE 1: Service exists, but no job is scheduled.
                    # Did an inspection get cancelled?
                    params = {"locationId": str(location_id), "limit": 500,
                          "type": "inspection,",
                          "status": "canceled"
                        }
                    canceled_inspection_jobs_response = call_service_trade_api("job", params=params)
                    canceled_inspection_jobs = canceled_inspection_jobs_response.get("data", {}).get("jobs", [])
                    if canceled_inspection_jobs is None:
                        jobs_processed += 1
                        # No inspection jobs within search window - job is not scheduled - job is not canceled
                        # Update location as service in with recurrence month and no job scheduled
                        upsert_into_database(location_values)
                        continue
                    else:
                        # A canceled job was found
                        for canceled_job in canceled_inspection_jobs:
                            # Find the date of the inspection job via appointment 
                            # because ServiceTrade does not store this information on canceled jobs
                            params = {"jobId": str(canceled_job.get("id")), "limit": 500}
                            appointments_response = call_service_trade_api("appointment", params=params)
                            appointments = appointments_response.get("data", {}).get("appointments")

                            if not appointments:
                                errors += 1
                                log.warning(f"No appointments on canceled job [{canceled_job.get("id")}]")
                            
                            for appointment in appointments:
                                if appointment.get("windowStart"):
                                    jobs_processed += 1
                                    location_values["scheduled_date"] = datetime.fromtimestamp(appointment.get("windowStart"))
                                    location_values["canceled"] = True
                                    upsert_into_database(location_values)
                                    continue
                                else:
                                    jobs_processed += 1
                                    # If the canceled job has no dates associated with it
                                    # Update location as service in with recurrence month and no job scheduled
                                    upsert_into_database(location_values)
                                    continue
                else:
                    # A scheduled or completed inspection job exist
                    inspection_job = inspection_jobs[0]
                    # If a job exists and was returned by our API request, it is at least scheduled.
                    location_values["scheduled"] = True
                    if not inspection_job.get("scheduledDate"):
                        log.warning(f"Job [{inspection_job.get("id")} has no scheduledDate]")
                        continue
                    location_values["scheduled_date"] = datetime.fromtimestamp(inspection_job.get("scheduledDate"))
                    
                    if inspection_job.get("status") == "completed":
                        # CASE 2: Service exists, job is completed.
                        jobs_processed += 1
                        # If the job is completed, update all values to True and upsert into DB.
                        location_values["reached_out"] = True
                        location_values["confirmed"] = True
                        location_values["completed"] = True
                        upsert_into_database(location_values)
                        continue

                    # Step 3: Job is scheduled. Time to find out to what degree.
                    params = {"jobId": str(inspection_job.get("id")), "limit": 500}
                    appointments_response = call_service_trade_api("appointment", params=params)
                    appointments = appointments_response.get("data", {}).get("appointments")

                    if not appointments:
                        errors += 1
                        log.warning(f"No appointments on scheduled job [{inspection_job.get("id")}]")
                    
                    confirmed = False
                    for appointment in appointments:
                        confirmed = confirmed or appointment.get("released", False)
                    
                    # CASE 3 & 4: Service exists, job is scheduled, job is confirmed or not confirmed
                    location_values["confirmed"] = confirmed
                    # If the job is confirmed, we have reached out. 
                    location_values["reached_out"] = confirmed
                    upsert_into_database(location_values)


            
        print("skipped: ", skipped)
        print("errors: ", errors)
        




                    


                        
                        

                    
                


            
                    

                


if __name__ == "__main__":
    main()