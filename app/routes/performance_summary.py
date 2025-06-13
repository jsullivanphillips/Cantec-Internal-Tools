from flask import Blueprint, render_template, session, jsonify
from app.db_models import db, Job, ClockEvent, Deficiency, Location, Quote
from collections import defaultdict
from datetime import timedelta
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
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
    completed_filter = Job.completed_on.isnot(None)

    job_type_counts = get_job_type_counts(completed_filter)
    revenue_by_job_type = get_revenue_by_job_type(completed_filter)
    hours_by_job_type = get_hours_by_job_type(completed_filter)
    total_hours_by_tech = get_total_hours_by_tech()

    avg_revenue_by_job_type, jobs_by_job_type, bubble_data_by_type = get_job_type_analytics(
        job_type_counts, revenue_by_job_type, completed_filter
    )

    avg_revenue_per_hour_by_job_type = get_avg_revenue_per_hour(revenue_by_job_type, hours_by_job_type)
    deficiency_insights = get_deficiency_insights()
    time_to_quote_metrics = get_time_to_quote_metrics()
    technician_metrics = get_technician_metrics()
    weekly_revenue_over_time = get_weekly_revenue_over_time()
    location_service_type_counts = get_top_locations_by_service_type()
    top_customer_revenue = get_top_customers_by_revenue()


    return jsonify({
        "job_type_counts": {jt or "Unknown": count for jt, count in job_type_counts.items()},
        "revenue_by_job_type": {jt or "Unknown": rev or 0 for jt, rev in revenue_by_job_type.items()},
        "hours_by_job_type": {jt or "Unknown": hrs or 0 for jt, hrs in hours_by_job_type.items()},
        "avg_revenue_by_job_type": avg_revenue_by_job_type,
        "avg_revenue_per_hour_by_job_type": avg_revenue_per_hour_by_job_type,
        "total_hours_by_tech": {tech or "Unknown": hrs or 0 for tech, hrs in total_hours_by_tech.items()},
        "jobs_by_job_type": jobs_by_job_type,
        "bubble_data_by_type": bubble_data_by_type,
        "deficiency_insights": deficiency_insights,
        "time_to_quote_metrics": time_to_quote_metrics,
        "technician_metrics": technician_metrics,
        "weekly_revenue_over_time": weekly_revenue_over_time,
        "location_service_type_counts": location_service_type_counts,
        "top_customer_revenue": top_customer_revenue,
    })


def get_top_customers_by_revenue():
    results = (
        db.session.query(Job.customer_name, db.func.sum(Job.revenue))
        .filter(Job.completed_on.isnot(None), Job.revenue.isnot(None))
        .group_by(Job.customer_name)
        .all()
    )

    customer_map = {}

    for name, total in results:
        normalized_name = name or "Unknown"
        name_lower = normalized_name.lower()

        if "devon" in name_lower:
            key = "Devon Properties"
        elif "brown brothers" in name_lower:
            key = "Brown Brothers Property Management"
        else:
            key = normalized_name

        customer_map[key] = customer_map.get(key, 0) + (total or 0)

    sorted_customers = sorted(customer_map.items(), key=lambda x: x[1], reverse=True)

    return [
        {"customer": name, "revenue": round(revenue, 2)}
        for name, revenue in sorted_customers
    ]




def get_top_locations_by_service_type():
    # Aggregate service call counts separately
    location_stats = (
        db.session.query(
            Job.address,
            db.func.sum(db.case((Job.job_type == 'emergency_service_call', 1), else_=0)).label("emergency_count"),
            db.func.sum(db.case((Job.job_type == 'service_call', 1), else_=0)).label("service_count")
        )
        .filter(
            Job.job_type.in_(["emergency_service_call", "service_call"]),
            Job.completed_on.isnot(None)
        )
        .group_by(Job.address)
        .all()
    )

    # Sort by combined total descending
    sorted_locations = sorted(
        location_stats,
        key=lambda row: (row.emergency_count or 0) + (row.service_count or 0),
        reverse=True
    )

    return [
        {
            "address": row.address or "Unknown",
            "emergency": int(row.emergency_count or 0),
            "service": int(row.service_count or 0),
            "total": int((row.emergency_count or 0) + (row.service_count or 0))
        }
        for row in sorted_locations
    ]


def get_weekly_revenue_over_time():
    # Get all jobs with revenue and completed date
    jobs = db.session.query(Job.completed_on, Job.revenue)\
        .filter(Job.completed_on.isnot(None), Job.revenue.isnot(None))\
        .all()

    revenue_by_week = defaultdict(float)

    for completed_on, revenue in jobs:
        if not completed_on:
            continue
        # Convert to Monday of the ISO week
        monday = completed_on - timedelta(days=completed_on.weekday())
        week_start = monday.date()
        revenue_by_week[week_start] += revenue or 0

    # Sort by week start date
    sorted_weekly = sorted(revenue_by_week.items())

    return [{"week_start": week.isoformat(), "revenue": round(rev, 2)} for week, rev in sorted_weekly]


def get_technician_metrics():
    # Revenue per on-site hour
    revenue_by_tech = {}
    hours_by_tech = {}

    tech_jobs = (
        db.session.query(Job.job_id, Job.revenue, ClockEvent.tech_name, ClockEvent.hours)
        .join(ClockEvent, Job.job_id == ClockEvent.job_id)
        .filter(
            Job.completed_on.isnot(None),
            ClockEvent.tech_name != "Shop Tech"
        )
        .all()
    )


    jobs_completed_by_tech = {}

    for job_id, revenue, tech, hours in tech_jobs:
        tech = tech or "Unknown"
        revenue = revenue or 0
        hours = hours or 0

        revenue_by_tech[tech] = revenue_by_tech.get(tech, 0) + revenue
        hours_by_tech[tech] = hours_by_tech.get(tech, 0) + hours

        # Count jobs (once per job per tech)
        jobs_completed_by_tech.setdefault(tech, set()).add(job_id)

    # Jobs completed by technician (as integer count)
    jobs_completed_by_tech = {tech: len(job_ids) for tech, job_ids in jobs_completed_by_tech.items()}

    # Revenue per hour
    revenue_per_hour = {
        tech: round(revenue_by_tech[tech] / hours_by_tech[tech], 2)
        if hours_by_tech[tech] else 0
        for tech in revenue_by_tech
    }


    return {
        "revenue_per_hour": revenue_per_hour,
        "jobs_completed_by_tech": jobs_completed_by_tech,
    }



def get_job_type_counts(completed_filter):
    return dict(
        db.session.query(Job.job_type, db.func.count(Job.job_id))
        .filter(completed_filter)
        .group_by(Job.job_type)
        .all()
    )

def get_revenue_by_job_type(completed_filter):
    return dict(
        db.session.query(Job.job_type, db.func.sum(Job.revenue))
        .filter(completed_filter)
        .group_by(Job.job_type)
        .all()
    )

def get_hours_by_job_type(completed_filter):
    return dict(
        db.session.query(Job.job_type, db.func.sum(Job.total_on_site_hours))
        .filter(completed_filter)
        .group_by(Job.job_type)
        .all()
    )

def get_total_hours_by_tech():
    return dict(
        db.session.query(ClockEvent.tech_name, db.func.sum(ClockEvent.hours))
        .group_by(ClockEvent.tech_name)
        .all()
    )

def get_job_type_analytics(job_type_counts, revenue_by_job_type, completed_filter):
    avg_revenue_by_job_type = {}
    jobs_by_job_type = {}
    bubble_data_by_type = {}

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

    return avg_revenue_by_job_type, jobs_by_job_type, bubble_data_by_type

def get_avg_revenue_per_hour(revenue_by_job_type, hours_by_job_type):
    all_job_types = set(revenue_by_job_type.keys()).union(hours_by_job_type.keys())
    result = {}
    for jt in all_job_types:
        hours = hours_by_job_type.get(jt, 0)
        revenue = revenue_by_job_type.get(jt, 0)
        result[jt or "Unknown"] = round(revenue / hours, 2) if hours else 0.0
    return result

def get_deficiency_insights():
    total_deficiencies = db.session.query(Deficiency).count()

    quoted_deficiencies = db.session.query(Quote.linked_deficiency_id)\
        .filter(Quote.linked_deficiency_id.isnot(None))\
        .distinct()\
        .count()

    quoted_with_job = db.session.query(Quote.linked_deficiency_id)\
        .filter(Quote.linked_deficiency_id.isnot(None), Quote.job_created.is_(True))\
        .distinct()\
        .count()

    quoted_with_completed_job = db.session.query(Quote.linked_deficiency_id)\
        .join(Job, Quote.job_id == Job.job_id)\
        .filter(
            Quote.linked_deficiency_id.isnot(None),
            Quote.job_created.is_(True),
            Job.completed_on.isnot(None)
        )\
        .distinct()\
        .count()

    return {
        "total_deficiencies": total_deficiencies,
        "quoted_deficiencies": quoted_deficiencies,
        "quoted_with_job": quoted_with_job,
        "quoted_with_completed_job": quoted_with_completed_job
    }

def get_time_to_quote_metrics():
    deficiency_to_quote_deltas = []
    quote_to_job_deltas = []

    linked_quotes = (
        db.session.query(Quote, Deficiency, Job)
        .outerjoin(Deficiency, Quote.linked_deficiency_id == Deficiency.deficiency_id)
        .outerjoin(Job, Quote.job_id == Job.job_id)
        .filter(Quote.linked_deficiency_id.isnot(None))
        .all()
    )

    for quote, deficiency, job in linked_quotes:
        if deficiency and deficiency.deficiency_created_on and quote.quote_created_on:
            delta1 = quote.quote_created_on - deficiency.deficiency_created_on
            deficiency_to_quote_deltas.append(delta1.days)

        if quote.quote_created_on and job:
            job_date = job.scheduled_date or job.completed_on
            if job_date:
                delta2 = job_date - quote.quote_created_on
                quote_to_job_deltas.append(delta2.days)

    avg_def_to_quote = (
        round(sum(deficiency_to_quote_deltas) / len(deficiency_to_quote_deltas), 1)
        if deficiency_to_quote_deltas else 0
    )
    avg_quote_to_job = (
        round(sum(quote_to_job_deltas) / len(quote_to_job_deltas), 1)
        if quote_to_job_deltas else 0
    )

    return {
        "avg_days_deficiency_to_quote": avg_def_to_quote,
        "avg_days_quote_to_job": avg_quote_to_job
    }




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

    # Check if job already exists
    existing_job = Job.query.filter_by(job_id=job_id).first()
    if existing_job:
        # Patch missing location_id if needed
        if not existing_job.location_id:
            new_loc_id = job.get("location", {}).get("id")
            if new_loc_id:
                existing_job.location_id = new_loc_id
                db.session.commit()
                tqdm.write(f"✅ Patched location_id for job {job_id} to {new_loc_id}")
        else:
            tqdm.write(f"Skipping job {job_id} (already exists in DB)")
        return job_id, {
            "job": existing_job,
            "clockEvents": {},  # Skipped updating clock events
            "onSiteHours": existing_job.total_on_site_hours
        }

    # Job does not exist → create new record
    job_type = job.get("type")
    address = job.get("location", {}).get("address", {}).get("street", "Unknown")
    customer_name = job.get("customer", {}).get("name", "Unknown")
    job_status = job.get("displayStatus", "Unknown")
    scheduled_date = datetime.fromtimestamp(job.get("scheduledDate")) if job.get("scheduledDate") else None
    completed_on_raw = job.get("completedOn")
    completed_on = datetime.fromtimestamp(completed_on_raw) if completed_on_raw else None

    db_job = Job(job_id=job_id)
    db_job.location_id = job.get("location", {}).get("id")
    db_job.job_type = job_type
    db_job.address = address
    db_job.customer_name = customer_name
    db_job.job_status = job_status
    db_job.scheduled_date = scheduled_date
    db_job.completed_on = completed_on
    db_job.total_on_site_hours = 0
    db_job.revenue = 0
    db.session.add(db_job)
    db.session.commit()

    invoice_total = 0
    total_on_site_hours = 0
    clock_events = {}

    if completed_on:
        # Invoice fetch
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

        # Clock events
        clock_endpoint = f"{SERVICE_TRADE_API_BASE}/job/{job_id}/clockevent"
        clock_params = {"activity": "onsite"}
        clock_response = call_service_trade_api(clock_endpoint, clock_params)
        if clock_response:
            try:
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

    db_job.total_on_site_hours = total_on_site_hours
    db_job.revenue = invoice_total
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


def jobs_summary(short_run=False, overwrite=False):
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

    all_locations = []
    for status in ["active", "inactive"]:
        params = {
            "page": 1,
            "limit": 500,
            "status": status
        }
        locations = get_locations_with_params(params=params)
        tqdm.write(f"Number of {status} locations: {len(locations)}")

        for loc in locations:
            loc["status"] = status  # attach status inline
        all_locations.extend(locations)

    tqdm.write(f"Total locations to process: {len(all_locations)}")

    with tqdm(total=len(all_locations), desc="Saving Locations to DB") as pbar:
        for l in all_locations:
            try:
                location_id = l["id"]
                street = l["address"]["street"]
                status = l["status"]
                company_name = l["company"]["name"]
                company_id = l["company"]["id"]

                location = Location.query.filter_by(location_id=location_id).first()
                if not location:
                    location = Location(location_id=location_id)

                location.street = street
                location.status = status
                location.company_name = company_name
                location.company_id = company_id

                db.session.add(location)

            except Exception as e:
                tqdm.write(f"[WARNING] Skipped location {l.get('id')} | Error: {type(e).__name__}: {e}")
            pbar.update(1)

    db.session.commit()
    tqdm.write("✅ All locations processed and saved.")


def get_quotes_with_params(params, desc="Fetching quotes"):
    """
    Generalized job fetcher based on params.
    Returns a full list of quotes across paginated responses.
    """
    quotes = []

    response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/quote", params)
    if not response:
        tqdm.write("Failed to fetch quotes.")
        return quotes

    data = response.json().get("data", {})
    total_pages = data.get("totalPages", 1)
    quotes.extend(data.get("quotes", []))

    if total_pages > 1:
        for page_num in tqdm(range(2, total_pages + 1), desc=desc):
            params["page"] = page_num
            response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/quote", params)
            if not response:
                tqdm.write(f"Failed to fetch page {page_num}")
                continue
            page_data = response.json().get("data", {})
            quotes.extend(page_data.get("quotes", []))

    return quotes 

def update_quotes():
    authenticate()

    fiscal_year_start = datetime.timestamp(datetime(2024, 5, 1, 0, 0))
    fiscal_year_end = datetime.timestamp(datetime(2025, 4, 30, 23, 59))

    base_params = {
        "createdAfter": fiscal_year_start,
        "createdBefore": fiscal_year_end,
    }

    # --- 1. Fetch all quotes within the timeframe
    all_quotes = get_quotes_with_params(params=base_params)
    tqdm.write(f"✅ Found {len(all_quotes)} quotes in fiscal year")

    # --- 2. Fetch deficiency-linked quotes in same window
    known_deficiencies = Deficiency.query.with_entities(Deficiency.deficiency_id).all()
    deficiency_ids = [d[0] for d in known_deficiencies]

    linked_quotes = []
    for d_id in tqdm(deficiency_ids, desc="Fetching linked quotes"):
        params = {
            "createdAfter": fiscal_year_start,
            "createdBefore": fiscal_year_end,
            "deficiencyId": d_id
        }
        quotes = get_quotes_with_params(params=params)
        for q in quotes:
            q["linked_deficiency_id"] = d_id
        linked_quotes.extend(quotes)

    # Index linked quotes by ID for later matching
    quote_deficiency_map = {q["id"]: q["linked_deficiency_id"] for q in linked_quotes}

    # --- 3. Save all quotes, with any link if present
    with tqdm(total=len(all_quotes), desc="Saving quotes to DB") as pbar:
        for q in all_quotes:
            try:
                quote_id = q["id"]
                customer_name = q["customer"]["name"]
                location_id = q["location"]["id"]
                location_address = q["location"]["address"]["street"]
                status = q["status"]
                quote_created_on = datetime.fromtimestamp(q["created"])
                total_price_raw = q["totalPrice"]
                total_price = float(total_price_raw.replace(",", "")) if isinstance(total_price_raw, str) else total_price_raw
                quote_request = q["quoteRequest"]["status"]
                owner_id = q["owner"]["id"]
                owner_email = q["owner"]["email"]

                job_created = len(q["jobs"]) > 0
                job_id = q["jobs"][0]["id"] if job_created else -1
                linked_deficiency_id = quote_deficiency_map.get(quote_id)

                quote = Quote.query.filter_by(quote_id=quote_id).first()
                if not quote:
                    quote = Quote(quote_id=quote_id)

                quote.customer_name = customer_name
                quote.location_id = location_id
                quote.location_address = location_address
                quote.status = status
                quote.quote_created_on = quote_created_on
                quote.total_price = total_price
                quote.quote_request = quote_request
                quote.owner_id = owner_id
                quote.owner_email = owner_email
                quote.job_created = job_created
                quote.job_id = job_id
                quote.linked_deficiency_id = linked_deficiency_id

                db.session.add(quote)

            except Exception as e:
                tqdm.write(f"[WARNING] Skipped quote {q.get('id')} | Error: {type(e).__name__}: {e}")
            pbar.update(1)

    db.session.commit()
    tqdm.write("✅ All quotes processed and saved.")


    
    


