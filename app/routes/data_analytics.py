from flask import Blueprint, render_template, jsonify, session, request, current_app
import requests
from datetime import datetime, timedelta
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
@cache.cached(timeout=300, query_string=True)  # Cache for 5 minutes (300 seconds)
def metric4():
    print("Starting Metric 4 calculation")  # Debug statement

    # Initialize API session and authenticate
    api_session = requests.Session()
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {"username": session.get('username'), "password": session.get('password')}
    try:
        print("Authenticating with ServiceTrade API...")  # Debug statement
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
        print("Authentication successful")  # Debug statement
    except Exception as e:
        print(f"Authentication error: {e}")  # Debug statement
        return jsonify({"error": "Authentication failed"}), 401

    # Parse date range from query parameters
    range_type = request.args.get('range', '1week')

    # Define the date range based on the range_type
    end_date = datetime.now()
    if range_type == "1week":
        start_date = end_date - timedelta(days=7)  # Last 7 days
    elif range_type == "4weeks":
        start_date = end_date - timedelta(days=28)  # Last 4 weeks
    elif range_type == "3months":
        start_date = end_date - timedelta(days=90)  # Last 3 months
    elif range_type == "6months":
        start_date = end_date - timedelta(days=180)  # Last 6 months
    else:
        start_date = end_date - timedelta(days=180)  # Default to last 6 months

    # Align the start and end dates with full weeks (Monday to Sunday)
    start_date = start_date - timedelta(days=start_date.weekday())  # Start of the week (Monday)
    end_date = end_date + timedelta(days=(6 - end_date.weekday()))  # End of the week (Sunday)

    # Convert dates to UNIX timestamps
    completed_on_begin = int(start_date.timestamp())
    completed_on_end = int(end_date.timestamp())

    # Log the timestamps
    print(f"Completed On Begin (Unix): {completed_on_begin}")  # Debug statement
    print(f"Completed On End (Unix): {completed_on_end}")  # Debug statement

    # Query the Job API for all jobs within the specified date range
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
            print(f"Fetching jobs (Page {job_params['page']})...")  # Debug statement
            job_response = api_session.get(job_url, params=job_params)
            job_response.raise_for_status()
            print(f"Jobs fetched successfully (Page {job_params['page']})")  # Debug statement
        except Exception as e:
            print(f"Job API error: {e}")  # Debug statement
            return jsonify({"error": "Job API error", "details": str(e)}), 500

        jobs_data = job_response.json().get("data", {})
        jobs_list.extend(jobs_data.get("jobs", []))

        # Log the number of jobs fetched
        print(f"Jobs fetched on Page {job_params['page']}: {len(jobs_data.get('jobs', []))}")  # Debug statement

        # Check if there are more pages
        total_pages = jobs_data.get("totalPages", 1)
        if job_params["page"] >= total_pages:
            print("No more pages to fetch")  # Debug statement
            break
        job_params["page"] += 1

    # Log the total number of jobs fetched
    print(f"Total Jobs Fetched: {len(jobs_list)}")  # Debug statement

    # Group jobs by interval based on the range type
    grouped_jobs = {}
    for job in jobs_list:
        completed_date = datetime.fromtimestamp(job.get("completedOn"))

        if range_type == "1week":
            # For 1 week, group by day (Monday to Friday)
            if completed_date.weekday() < 5:  # Only include Monday to Friday
                interval_key = completed_date.strftime("%Y-%m-%d")  # Daily intervals
            else:
                continue  # Skip weekends
        elif range_type in ["4weeks", "3months"]:
            # For 4 weeks and 3 months, group into Monday-Friday segments
            week_start = (completed_date - timedelta(days=completed_date.weekday())).strftime("%Y-%m-%d")
            interval_key = f"Week of {week_start}"  # Weekly intervals
        elif range_type == "6months":
            # For 6 months, group by month (1st to last day of the month)
            interval_key = completed_date.strftime("%Y-%m")  # Monthly intervals
        else:
            interval_key = "Unknown"

        if interval_key not in grouped_jobs:
            grouped_jobs[interval_key] = 0
        grouped_jobs[interval_key] += 1

    # Format the response
    jobs_completed = [
        {"interval": interval, "jobs_completed": count}
        for interval, count in grouped_jobs.items()
    ]

    # Sort by interval
    jobs_completed.sort(key=lambda x: x["interval"])

    # Log the final result
    print(f"Jobs Completed: {jobs_completed}")  # Debug statement

    return jsonify({"jobsCompleted": jobs_completed})