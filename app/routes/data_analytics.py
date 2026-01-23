from flask import Blueprint, render_template, jsonify, session, request, current_app
import requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from dateutil.relativedelta import relativedelta
from flask_caching import Cache

# Initialize Flask-Caching
cache = Cache(config={'CACHE_TYPE': 'SimpleCache'})

# Register the cache with the Flask app
def init_cache(app):
    cache.init_app(app)
    app.logger.info("LOG!")

data_analytics_bp = Blueprint('data_analytics', __name__, url_prefix='/data-analytics')

@data_analytics_bp.route('/')
def index():
    return render_template('data_analytics.html')

@data_analytics_bp.route('/metric1')
@cache.cached(timeout=300, query_string=True)  # Cache for 5 minutes (300 seconds)
def metric1():
    print("METRICS")
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

    # Determine date range from query parameters (expected as YYYY-MM-DD)
    date_after_str = request.args.get('dateAfter')
    date_before_str = request.args.get('dateBefore')
    if date_after_str and date_before_str:
        try:
            date_after = datetime.strptime(date_after_str, "%Y-%m-%d")
            date_before = datetime.strptime(date_before_str, "%Y-%m-%d")
            transactionDateAfter = int(date_after.timestamp())
            transactionDateBefore = int(date_before.timestamp())
        except Exception as e:
            current_app.logger.error("Error parsing dates: %s", e)
            one_month_ago = datetime.now() - timedelta(days=30)
            now = datetime.now()
            transactionDateAfter = int(one_month_ago.timestamp())
            transactionDateBefore = int(now.timestamp())
    else:
        one_month_ago = datetime.now() - timedelta(days=30)
        now = datetime.now()
        transactionDateAfter = int(one_month_ago.timestamp())
        transactionDateBefore = int(now.timestamp())

    # Query the Company API
    company_url = "https://api.servicetrade.com/api/company"
    try:
        company_response = api_session.get(company_url)
        company_response.raise_for_status()
    except Exception as e:
        current_app.logger.error("Company API error: %s", e)
        return jsonify({"error": "Company API error", "details": str(e)}), 500

    companies_data = company_response.json().get("data", {})
    companies_list = companies_data.get("companies", [])
    company_dict = {}
    for comp in companies_list:
        comp_id = comp.get("id")
        comp_name = comp.get("name")
        if comp_id and comp_name:
            company_dict[comp_id] = comp_name

    # Query the Invoice API with the date range and pagination
    invoice_url = "https://api.servicetrade.com/api/invoice"
    company_invoice_sums = {}
    page = 1
    while True:
        invoice_params = {
            "transactionDateAfter": transactionDateAfter,
            "transactionDateBefore": transactionDateBefore,
            "limit": 2000,
            "page": page
        }
        try:
            invoice_response = api_session.get(invoice_url, params=invoice_params)
            invoice_response.raise_for_status()
        except Exception as e:
            current_app.logger.error("Invoice API error: %s", e)
            return jsonify({"error": "Invoice API error", "details": str(e)}), 500

        invoices_data = invoice_response.json().get("data", {})
        invoices_list = invoices_data.get("invoices", [])

        # Group invoices by company (customer id) and sum totalPrice
        for invoice in invoices_list:
            customer = invoice.get("customer", {})
            company_id = customer.get("id")
            if not company_id:
                continue
            total_price = invoice.get("totalPrice", 0.0)
            company_invoice_sums[company_id] = company_invoice_sums.get(company_id, 0.0) + total_price

        # Check if there are more pages
        total_pages = invoices_data.get("totalPages", 1)
        if page >= total_pages:
            break
        page += 1

    # Map sums using company names
    company_invoice_sums_named = {}
    for comp_id, sum_value in company_invoice_sums.items():
        comp_name = company_dict.get(comp_id, f"Company {comp_id}")
        company_invoice_sums_named[comp_name] = sum_value

    # Sort companies by largest sum and select the top 10
    sorted_companies = sorted(company_invoice_sums_named.items(), key=lambda x: x[1], reverse=True)
    top_10 = sorted_companies[:10]

    return jsonify({"topCompanies": top_10})

@data_analytics_bp.route('/metric2')
def metric2():
    """
    Returns total invoice amounts for the last year, segmented by month.
    Due to API limits (max 2000 items per call), we query the invoices in 1-month segments
    and page through results if needed.
    """
    # Initialize API session and authenticate.
    api_session = requests.Session()
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {"username": session.get('username'), "password": session.get('password')}
    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception as e:
        current_app.logger.error("Authentication error: %s", e)
        return jsonify({"error": "Authentication failed"}), 401

    now = datetime.now()
    monthly_totals = []

    # Loop over the last 12 months.
    # We calculate each month's segment boundaries.
    for i in range(12):
        # Compute the target month/year by subtracting i months from current month.
        month = now.month - i
        year = now.year
        if month <= 0:
            month += 12
            year -= 1

        # Start date: first day of this month.
        start_date = datetime(year, month, 1)
        # End date: last second of this month.
        if month == 12:
            end_date = datetime(year + 1, 1, 1) - timedelta(seconds=1)
        else:
            end_date = datetime(year, month + 1, 1) - timedelta(seconds=1)

        total_for_month = 0.0
        page = 1
        while True:
            invoice_url = "https://api.servicetrade.com/api/invoice"
            invoice_params = {
                "transactionDateAfter": int(start_date.timestamp()),
                "transactionDateBefore": int(end_date.timestamp()),
                "limit": 2000,
                "page": page
            }
            try:
                invoice_response = api_session.get(invoice_url, params=invoice_params)
                invoice_response.raise_for_status()
            except Exception as e:
                current_app.logger.error("Invoice API error for %s-%02d: %s", year, month, e)
                break

            invoice_data = invoice_response.json().get("data", {})
            invoices_list = invoice_data.get("invoices", [])
            for invoice in invoices_list:
                total_price = invoice.get("totalPrice", 0.0)
                total_for_month += total_price

            total_pages = invoice_data.get("totalPages", 1)
            if page >= total_pages:
                break
            page += 1

        # Create a label for the month (e.g., "2022-09").
        label = f"{year}-{month:02d}"
        monthly_totals.append({"month": label, "total": total_for_month})

    # Reverse the list so that the earliest month is first.
    monthly_totals = list(reversed(monthly_totals))
    return jsonify({"monthlyTotals": monthly_totals})


# Apply caching to the /metric3 route
@data_analytics_bp.route('/metric3')
@cache.cached(timeout=300, query_string=True)  # Cache for 5 minutes (300 seconds)
def metric3():
    """
    Calculate the number of jobs scheduled per week for a given range.
    Handles pagination to ensure all jobs are counted.
    """
    # Initialize API session and authenticate
    api_session = requests.Session()
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {"username": session.get('username'), "password": session.get('password')}
    try:
        api_session.post(auth_url, json=payload).raise_for_status()
    except Exception as e:
        current_app.logger.error("Authentication error: %s", e)
        return jsonify({"error": "Authentication failed"}), 401

    # Parse date range from query parameters
    date_after_str = request.args.get('dateAfter')
    date_before_str = request.args.get('dateBefore')
    if date_after_str and date_before_str:
        try:
            start_date = datetime.strptime(date_after_str, "%Y-%m-%d")
            end_date = datetime.strptime(date_before_str, "%Y-%m-%d")
        except Exception as e:
            current_app.logger.error("Error parsing dates: %s", e)
            return jsonify({"error": "Invalid date format"}), 400
    else:
        # Default to the last 6 weeks if no range is provided
        end_date = datetime.now()
        start_date = end_date - timedelta(weeks=6)

    # Initialize a dictionary to store job counts per week
    weekly_job_counts = {}

    # Iterate through each week in the range
    current_week_start = start_date - timedelta(days=start_date.weekday())  # Start of the week (Monday)
    while current_week_start <= end_date:
        current_week_end = current_week_start + timedelta(days=6, hours=23, minutes=59, seconds=59)  # End of the week (Sunday)
        week_label = current_week_start.strftime("%Y-%m-%d")  # Label for the week (e.g., "2023-10-02")

        # Initialize job count for the week
        weekly_job_counts[week_label] = 0

        # Query the Job API for the current week with pagination
        page = 1
        while True:
            params = {
                "scheduleDateFrom": int(current_week_start.timestamp()),
                "scheduleDateTo": int(current_week_end.timestamp()),
                "status": "all",
                "limit": 2000,
                "page": page
            }
            try:
                response = api_session.get("https://api.servicetrade.com/api/job", params=params)
                response.raise_for_status()
                jobs_data = response.json().get("data", {})
                jobs_list = jobs_data.get("jobs", [])
                weekly_job_counts[week_label] += len(jobs_list)

                # Check if there are more pages
                total_pages = jobs_data.get("totalPages", 1)
                if page >= total_pages:
                    break
                page += 1
            except Exception as e:
                current_app.logger.error("Job API error: %s", e)
                return jsonify({"error": "Job API error", "details": str(e)}), 500

        # Move to the next week
        current_week_start += timedelta(weeks=1)

    # Format the response
    response_data = [
        {"interval": f"Week of {week_start}", "job_count": count}
        for week_start, count in weekly_job_counts.items()
    ]

    return jsonify({"scheduledJobs": response_data})


@data_analytics_bp.route('/metric4')
@cache.cached(timeout=300, query_string=True)  # Cache for 5 minutes
def metric4():
    """
    Jobs completed after scheduling, grouped by intervals depending on the range.
    For 1week, show Mon -> today in local time, labeled by weekday names.
    """
    # 1) AUTHENTICATION
    api_session = requests.Session()
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {"username": session.get('username'), "password": session.get('password')}

    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception as e:
        current_app.logger.error(f"Authentication error: {e}")
        return jsonify({"error": "Authentication failed"}), 401

    # 2) DETERMINE TIME ZONE FROM SESSION
    #    Defaults to UTC if not set
    account_timezone = session.get("account_timezone", "UTC")
    local_tz = ZoneInfo(account_timezone)

    # 3) PARSE RANGE TYPE
    range_type = request.args.get('range', '1week')
    # We'll define end_date in local time
    now_local = datetime.now(tz=local_tz)

    # 4) SET START_DATE AND END_DATE (LOCAL TIME)
    if range_type == "1week":
        # For 1week, we only want Monday of this current week up to *today*
        # (No need to extend to Sunday, because we only want up to now_local)
        end_date_local = now_local
        monday_of_this_week = now_local - timedelta(days=now_local.weekday())
        start_date_local = monday_of_this_week.replace(hour=0, minute=0, second=0, microsecond=0)
    elif range_type == "4weeks":
        end_date_local = now_local + timedelta(days=(6 - now_local.weekday()))  # end on Sunday
        start_date_local = end_date_local - timedelta(days=28)
    elif range_type == "3months":
        end_date_local = now_local + timedelta(days=(6 - now_local.weekday()))
        start_date_local = end_date_local - timedelta(days=90)
    elif range_type == "6months":
        end_date_local = now_local + timedelta(days=(6 - now_local.weekday()))
        start_date_local = end_date_local - timedelta(days=180)
    else:
        # default to 6months if something unexpected
        end_date_local = now_local + timedelta(days=(6 - now_local.weekday()))
        start_date_local = end_date_local - timedelta(days=180)

    # Convert to UNIX timestamps for the API call (ServiceTrade expects UTC-based timestamps)
    completed_on_begin = int(start_date_local.timestamp())
    completed_on_end = int(end_date_local.timestamp())

    # 5) FETCH JOBS
    job_url = "https://api.servicetrade.com/api/job"
    job_params = {
        "completedOnBegin": completed_on_begin,
        "completedOnEnd": completed_on_end,
        "limit": 2000,
        "page": 1,
        "status": "completed"
    }

    jobs_list = []
    while True:
        try:
            job_response = api_session.get(job_url, params=job_params)
            job_response.raise_for_status()
        except Exception as e:
            current_app.logger.error(f"Job API error: {e}")
            return jsonify({"error": "Job API error", "details": str(e)}), 500

        jobs_data = job_response.json().get("data", {})
        jobs_page = jobs_data.get("jobs", [])
        jobs_list.extend(jobs_page)

        total_pages = jobs_data.get("totalPages", 1)
        if job_params["page"] >= total_pages:
            break
        job_params["page"] += 1

    # 6) GROUP THE JOBS BY INTERVAL (DEPENDS ON range_type)
    if range_type == "1week":
        # Pre-populate Monday through Friday of the *current* week with 0
        # in correct order. We only fill up to 'today_local'.
        # If it's Friday, we fill Monday, Tuesday, Wednesday, Thursday, Friday.
        # If it's Wednesday, we fill Monday, Tuesday, Wednesday, etc.
        # We'll store them in a dict day_name -> count
        day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
        grouped_jobs = {dn: 0 for dn in day_names}

        # Tally up jobs only if they fall between start_date_local & end_date_local
        # (in local time) and only if Monday–Friday.
        for job in jobs_list:
            # Convert from UTC to local time
            # The job "completedOn" is a Unix timestamp in UTC
            completed_utc = datetime.utcfromtimestamp(job.get("completedOn"))
            completed_local = completed_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(local_tz)

            if start_date_local.date() <= completed_local.date() <= end_date_local.date():
                # completed_local.weekday() < 5 means Monday=0 to Friday=4
                if 0 <= completed_local.weekday() < 5:
                    day_str = completed_local.strftime("%A")  # e.g. "Monday"
                    grouped_jobs[day_str] += 1

        # Build final array in chronological order, only up to "today"
        # For example, if today is Wednesday, we skip Thursday/Friday
        jobs_completed = []
        for i, day_str in enumerate(day_names):
            # The local date for this i-th weekday (starting from Monday)
            day_date = start_date_local + timedelta(days=i)
            if day_date.date() <= end_date_local.date():
                jobs_completed.append({
                    "interval": day_str,
                    "jobs_completed": grouped_jobs[day_str]
                })

    elif range_type in ["4weeks", "3months"]:
        # Group by "Week of YYYY-MM-DD" (Mon-Sun).
        grouped_jobs = {}
        for job in jobs_list:
            # Convert to local time
            completed_utc = datetime.utcfromtimestamp(job.get("completedOn"))
            completed_local = completed_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(local_tz)

            # Find the Monday of that job's week
            week_start_local = completed_local - timedelta(days=completed_local.weekday())
            week_key = f"Week of {week_start_local.strftime('%Y-%m-%d')}"
            grouped_jobs[week_key] = grouped_jobs.get(week_key, 0) + 1

        # Turn into a list of dicts
        jobs_completed = [
            {"interval": wk, "jobs_completed": ct}
            for wk, ct in grouped_jobs.items()
        ]
        # Sort them by the actual date in the key (strip off "Week of ")
        jobs_completed.sort(key=lambda x: x["interval"].replace("Week of ", ""))

    elif range_type == "6months":
        # Group by month (YYYY-MM)
        grouped_jobs = {}
        for job in jobs_list:
            completed_utc = datetime.utcfromtimestamp(job.get("completedOn"))
            completed_local = completed_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(local_tz)
            month_key = completed_local.strftime("%Y-%m")
            grouped_jobs[month_key] = grouped_jobs.get(month_key, 0) + 1

        jobs_completed = [
            {"interval": mk, "jobs_completed": ct}
            for mk, ct in grouped_jobs.items()
        ]
        # Sort by year-month string
        jobs_completed.sort(key=lambda x: x["interval"])
    else:
        # Fallback / default if an unknown range is provided
        jobs_completed = []

    return jsonify({"jobsCompleted": jobs_completed})
