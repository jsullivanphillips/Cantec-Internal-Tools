from flask import Blueprint, render_template, session, jsonify
from app.db_models import db, Job, ClockEvent, Deficiency
from datetime import datetime, timezone
from tqdm import tqdm
import requests
import numpy as np

performance_summary_bp = Blueprint('performance_summary', __name__, template_folder='templates')
api_session = requests.Session()

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"

@performance_summary_bp.route('/performance_summary', methods=['GET'])
def performance_summary():
    # Serve the HTML page
    return render_template("performance_summary.html")

@performance_summary_bp.route('/api/performance_summary_data', methods=['GET'])
def performance_summary_data():
    # Filter: only completed jobs
    completed_filter = Job.completed_on.isnot(None)

    # Query data
    job_type_counts = dict(
        db.session.query(Job.job_type, db.func.count(Job.job_id))
        .filter(completed_filter)
        .group_by(Job.job_type)
        .all()
    )

    revenue_by_job_type = dict(
        db.session.query(Job.job_type, db.func.sum(Job.revenue))
        .filter(completed_filter)
        .group_by(Job.job_type)
        .all()
    )

    hours_by_job_type = dict(
        db.session.query(Job.job_type, db.func.sum(Job.total_on_site_hours))
        .filter(completed_filter)
        .group_by(Job.job_type)
        .all()
    )

    total_hours_by_tech = dict(
        db.session.query(ClockEvent.tech_name, db.func.sum(ClockEvent.hours))
        .group_by(ClockEvent.tech_name)
        .all()
    )

    # Prep containers
    avg_revenue_by_job_type = {}
    jobs_by_job_type = {}
    bubble_data_by_type = {}

    # Collect data per job type
    all_job_types = set(job_type_counts.keys()).union(revenue_by_job_type.keys())
    for jt in all_job_types:
        jobs = Job.query.filter(Job.job_type == jt, completed_filter).all()
        revenues = [j.revenue for j in jobs if j.revenue is not None]
        filtered_revenues = iqr_filter(revenues)

        used_jobs = [
            {"job_id": job.job_id, "revenue": round(job.revenue, 2)}
            for job in jobs
            if job.revenue is not None and job.revenue in filtered_revenues
        ]
        jobs_by_job_type[jt or "Unknown"] = used_jobs

        avg = round(sum(filtered_revenues) / len(filtered_revenues), 2) if filtered_revenues else 0
        avg_revenue_by_job_type[jt or "Unknown"] = avg

        bubble_data_by_type[jt or "Unknown"] = {
            "count": job_type_counts.get(jt, 0),
            "avg_revenue": avg,
            "total_revenue": revenue_by_job_type.get(jt, 0)
        }

    # Avoid division by zero for avg revenue per hour
    avg_revenue_per_hour_by_job_type = {}
    for jt in all_job_types:
        hours = hours_by_job_type.get(jt, 0)
        revenue = revenue_by_job_type.get(jt, 0)
        avg_revenue_per_hour_by_job_type[jt or "Unknown"] = round(revenue / hours, 2) if hours else 0.0

    return jsonify({
        "job_type_counts": {jt or "Unknown": count for jt, count in job_type_counts.items()},
        "revenue_by_job_type": {jt or "Unknown": rev or 0 for jt, rev in revenue_by_job_type.items()},
        "hours_by_job_type": {jt or "Unknown": hrs or 0 for jt, hrs in hours_by_job_type.items()},
        "avg_revenue_by_job_type": avg_revenue_by_job_type,
        "avg_revenue_per_hour_by_job_type": avg_revenue_per_hour_by_job_type,
        "total_hours_by_tech": {tech or "Unknown": hrs or 0 for tech, hrs in total_hours_by_tech.items()},
        "jobs_by_job_type": jobs_by_job_type,
        "bubble_data_by_type": bubble_data_by_type
    })


def iqr_filter(values):
    if not values:
        return []
    q1 = np.percentile(values, 25)
    q3 = np.percentile(values, 75)
    iqr = q3 - q1
    lower_bound = q1 - 1.5 * iqr
    upper_bound = q3 + 1.5 * iqr
    filtered = [v for v in values if lower_bound <= v <= upper_bound]
    return filtered


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
        raise e

def call_service_trade_api(endpoint, params):
    try:
        response = api_session.get(endpoint, params=params)
        response.raise_for_status()
        return response
    except requests.RequestException as e:
        print(f"[ServiceTrade API Error] Endpoint: {endpoint} | Params: {params} | Error: {str(e)}")
        return None



def fetch_invoice_and_clock(job):
    job_id = job.get("id")

    # Skip processing if job already exists in DB
    existing_job = Job.query.filter_by(job_id=job_id).first()
    if existing_job:
        tqdm.write(f"Skipping job {job_id} (already exists in DB)")
        return job_id, {
            "job": existing_job,
            "clockEvents": {},  # Skipped, so nothing fresh
            "onSiteHours": existing_job.total_on_site_hours
        }

    # Job details
    job_type = job.get("type")
    address = job.get("location", {}).get("address", {}).get("street", "Unknown")
    customer_name = job.get("customer", {}).get("name", "Unknown")
    job_status = job.get("displayStatus", "Unknown")
    scheduled_date = datetime.fromtimestamp(job.get("scheduledDate")) if job.get("scheduledDate") else None
    completed_on_raw = job.get("completedOn")
    completed_on = datetime.fromtimestamp(completed_on_raw) if completed_on_raw else None

    db_job = Job(job_id=job_id)
    db_job.job_type = job_type
    db_job.address = address
    db_job.customer_name = customer_name
    db_job.job_status = job_status
    db_job.scheduled_date = scheduled_date
    db_job.completed_on = completed_on

    invoice_total = 0
    total_on_site_hours = 0
    clock_events = {}

    if completed_on:
        # --- Invoice ---
        invoice_endpoint = f"{SERVICE_TRADE_API_BASE}/invoice"
        invoice_params = {"jobId": job_id}
        invoice_response = call_service_trade_api(invoice_endpoint, invoice_params)
        if invoice_response:
            try:
                invoices = invoice_response.json().get("data", {}).get("invoices", [])
                invoice_total = sum(inv.get("totalPrice", 0) for inv in invoices)
            except Exception as e:
                tqdm.write(f"⚠️ Failed parsing invoice data for job {job_id}: {e}")
        db_job.revenue = invoice_total

        # --- Clock Events ---
        clock_endpoint = f"{SERVICE_TRADE_API_BASE}/job/{job_id}/clockevent"
        clock_params = {"activity": "onsite"}
        clock_response = call_service_trade_api(clock_endpoint, clock_params)
        if clock_response:
            try:
                ClockEvent.query.filter_by(job_id=job_id).delete()
                clock_event_pairs = clock_response.json().get("data", {}).get("pairedEvents", [])
                for pair in clock_event_pairs:
                    clock_in = datetime.fromtimestamp(pair.get("start", {}).get("eventTime", 0))
                    clock_out = datetime.fromtimestamp(pair.get("end", {}).get("eventTime", 0))
                    if not clock_in or not clock_out:
                        continue
                    delta = clock_out - clock_in
                    hours = delta.total_seconds() / 3600
                    tech = pair.get("start", {}).get("user", {}).get("name")
                    if not tech:
                        continue
                    db.session.add(ClockEvent(
                        job_id=job_id,
                        tech_name=tech,
                        hours=hours,
                        created_at=datetime.now(timezone.utc)
                    ))
                    clock_events[tech] = clock_events.get(tech, 0) + hours
                    total_on_site_hours += hours
            except Exception as e:
                tqdm.write(f"⚠️ Error processing clock events for job {job_id}: {e}")

    # Even if job is just scheduled (no invoice or clock), we save the basic job record
    db_job.total_on_site_hours = total_on_site_hours
    db_job.revenue = invoice_total  # Will be 0 if skipped
    db.session.add(db_job)
    db.session.commit()

    return job_id, {
        "job": db_job,
        "clockEvents": clock_events,
        "onSiteHours": total_on_site_hours
    }


def get_jobs_with_params(params, desc="Fetching Jobs"):
    """
    Generalized job fetcher based on params.
    Returns a full list of jobs across paginated responses.
    """
    jobs = []

    response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/job", params)
    if not response:
        tqdm.write("Failed to fetch jobs.")
        return jobs

    data = response.json().get("data", {})
    total_pages = data.get("totalPages", 1)
    jobs.extend(data.get("jobs", []))

    if total_pages > 1:
        for page_num in tqdm(range(2, total_pages + 1), desc=desc):
            params["page"] = page_num
            response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/job", params)
            if not response:
                tqdm.write(f"Failed to fetch page {page_num}")
                continue
            page_data = response.json().get("data", {})
            jobs.extend(page_data.get("jobs", []))
    tqdm.write(f"Number of jobs with params: {len(jobs)}")

    return jobs


def jobs_summary(short_run=False):
    authenticate()

    db_job_entry = {}

    # --- Standard completed jobs from fiscal year ---
    window_start = datetime.timestamp(datetime(2024, 5, 1, 0, 0))
    window_end = datetime.timestamp(datetime(2025, 4, 30, 23, 59))

    base_params = {
        "status": "completed",
        "completedOnBegin": window_start,
        "completedOnEnd": window_end,
        "page": 1,
        "limit": 100
    }

    if short_run:
        tqdm.write("Running in short mode (fetching only first page).")
        response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/job", base_params)
        jobs = response.json().get("data", {}).get("jobs", []) if response else []
    else:
        jobs = get_jobs_with_params(base_params, desc="Fetching Completed Job Pages")

    tqdm.write(f"Jobs completed in 2024–2025 fiscal year: {len(jobs)}")

    # --- Insert or update those jobs ---
    with tqdm(total=len(jobs), desc="Processing Completed Jobs") as pbar:
        for job in jobs:
            try:
                job_id, job_data = fetch_invoice_and_clock(job)
                db_job_entry[job_id] = job_data
            except Exception as exc:
                tqdm.write(f"A job failed with exception: {exc}")
            pbar.update(1)

    # --- Scheduled jobs that are not complete from fiscal year ---
    scheduled_job_params = {
        "status": "scheduled",
        "scheduleDateFrom": window_start,
        "scheduleDateTo": window_end,
        "page": 1,
        "limit": 100
    }
    scheduled_jobs = get_jobs_with_params(scheduled_job_params, desc="Fetching Additional Jobs")

    if scheduled_jobs:
        tqdm.write(f"Processing {len(scheduled_jobs)} additional jobs with alternate criteria.")
        with tqdm(total=len(scheduled_jobs), desc="Processing Additional Jobs") as pbar:
            for job in scheduled_jobs:
                try:
                    job_id, job_data = fetch_invoice_and_clock(job)
                    db_job_entry[job_id] = job_data
                except Exception as exc:
                    tqdm.write(f"A job failed with exception: {exc}")
                pbar.update(1)


    tqdm.write("\nAll jobs processed.")


def get_deficiencies_with_params(params, desc="Fetching deficiencies"):
    """
    Generalized job fetcher based on params.
    Returns a full list of deficiencies across paginated responses.
    """
    deficiencies = []

    response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/deficiency", params)
    if not response:
        tqdm.write("Failed to fetch deficiencies.")
        return deficiencies

    data = response.json().get("data", {})
    total_pages = data.get("totalPages", 1)
    deficiencies.extend(data.get("deficiencies", []))

    if total_pages > 1:
        for page_num in tqdm(range(2, total_pages + 1), desc=desc):
            params["page"] = page_num
            response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/deficiency", params)
            if not response:
                tqdm.write(f"Failed to fetch page {page_num}")
                continue
            page_data = response.json().get("data", {})
            deficiencies.extend(page_data.get("deficiencies", []))
    tqdm.write(f"Number of deficiencies with params: {len(deficiencies)}")

    return deficiencies

def update_deficiencies():
    authenticate()

    fiscal_year_start = datetime.timestamp(datetime(2024, 5, 1, 0, 0))
    fiscal_year_end = datetime.timestamp(datetime(2025, 4, 30, 23, 59))

    deficiency_params = {
        "createdAfter": fiscal_year_start,
        "createdBefore": fiscal_year_end,
        "limit": 500
    }

    deficiencies = get_deficiencies_with_params(params=deficiency_params)

    tqdm.write(f"Number of deficiencies fetched: {len(deficiencies)}")

    with tqdm(total=len(deficiencies), desc="Saving Deficiencies to DB") as pbar:
        for d in deficiencies:
            try:
                reporter = d.get("reporter")
                service_line = d.get("serviceLine")
                job = d.get("job")
                location = d.get("location")

                job_id = job["id"] if job else -1
                location_id = location["id"] if location else -1

                deficiency = Deficiency.query.filter_by(deficiency_id=d["id"]).first()
                if not deficiency:
                    deficiency = Deficiency(deficiency_id=d["id"])

                deficiency.description = d["description"]
                deficiency.status = d["status"]
                deficiency.reported_by = reporter["name"] if reporter else "Unknown"
                deficiency.service_line = service_line["name"] if service_line else "Unknown"
                deficiency.job_id = job_id
                deficiency.location_id = location_id
                deficiency.deficiency_created_on = datetime.fromtimestamp(d["created"])
                deficiency.orphaned = job_id == -1

                db.session.add(deficiency)

            except Exception as e:
                tqdm.write(f"[WARNING] Skipped deficiency {d.get('id')} | Error: {type(e).__name__}: {e}")
            pbar.update(1)

    db.session.commit()
    tqdm.write("✅ All deficiencies processed and saved.")

def get_locations_with_params(params, desc="Fetching locations"):
    """
    Generalized job fetcher based on params.
    Returns a full list of deficiencies across paginated responses.
    """
    locations = []

    response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/location", params)
    if not response:
        tqdm.write("Failed to fetch locations.")
        return locations

    data = response.json().get("data", {})
    total_pages = data.get("totalPages", 1)
    locations.extend(data.get("locations", []))

    if total_pages > 1:
        for page_num in tqdm(range(2, total_pages + 1), desc=desc):
            params["page"] = page_num
            response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/location", params)
            if not response:
                tqdm.write(f"Failed to fetch page {page_num}")
                continue
            page_data = response.json().get("data", {})
            locations.extend(page_data.get("locations", []))

    return locations 

def update_locations():
    authenticate()


    params = {
        "page": 1,
        "limit": 500,
        "status": "active"
    }

    active_locations = get_locations_with_params(params=params)
    tqdm.write(f"number of active locations: {len(active_locations)}")

    

    params = {
        "page": 1,
        "limit": 500,
        "status": "inactive"
    }

    inactive_locations = get_locations_with_params(params=params)
    tqdm.write(f"number of active locations: {len(inactive_locations)}")

def update_quotes():
    authenticate()
    print("💬 Updating quotes... (add logic here)")


