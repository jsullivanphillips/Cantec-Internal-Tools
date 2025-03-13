from flask import Blueprint, render_template, jsonify, session, request, current_app
import requests
from datetime import datetime, timedelta

data_analytics_bp = Blueprint('data_analytics', __name__, url_prefix='/data-analytics')

@data_analytics_bp.route('/')
def index():
    return render_template('data_analytics.html')

@data_analytics_bp.route('/metric1')
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

    # Query the Invoice API with the date range
    invoice_url = "https://api.servicetrade.com/api/invoice"
    invoice_params = {
        "transactionDateAfter": transactionDateAfter,
        "transactionDateBefore": transactionDateBefore,
        "limit": 2000
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
    company_invoice_sums = {}
    for invoice in invoices_list:
        customer = invoice.get("customer", {})
        company_id = customer.get("id")
        if not company_id:
            continue
        total_price = invoice.get("totalPrice", 0.0)
        company_invoice_sums[company_id] = company_invoice_sums.get(company_id, 0.0) + total_price

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


@data_analytics_bp.route('/metric3')
def metric3():
    """
    Returns the number of jobs that were created and scheduled per month for the last 6 months.
    """
    api_session = requests.Session()
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {"username": session.get('username'), "password": session.get('password')}
    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception as e:
        current_app.logger.error("Authentication error: %s", e)
        return jsonify({"error": "Authentication failed"}), 401

    monthly_counts = []
    today = datetime.now()

    # Iterate over the last 6 months
    for i in range(6):
        month = today.month - i
        year = today.year
        if month <= 0:
            month = month + 12
            year -= 1

        start_date = datetime(year, month, 1)
        if month == 12:
            end_date = datetime(year + 1, 1, 1) - timedelta(seconds=1)
        else:
            end_date = datetime(year, month + 1, 1) - timedelta(seconds=1)

        createdAfter = int(start_date.timestamp())
        createdBefore = int(end_date.timestamp())

        page = 1
        count_this_month = 0

        while True:
            job_url = "https://api.servicetrade.com/api/job"
            params = {
                "createdAfter": createdAfter,
                "createdBefore": createdBefore,
                "status": "all",
                "limit": 2000,
                "page": page
            }
            try:
                response = api_session.get(job_url, params=params)
                response.raise_for_status()
                job_data = response.json().get("data", {})
            except Exception as e:
                current_app.logger.error("Job API error: %s", e)
                break

            jobs_list = job_data.get("jobs", [])
            
            # Filter jobs that have been scheduled at some point (scheduledDate is not null)
            scheduled_jobs = [job for job in jobs_list if job.get("scheduledDate")]
            count_this_month = len(scheduled_jobs)

            total_pages = job_data.get("totalPages", 1)
            if page >= total_pages:
                break
            page += 1

        monthly_counts.append({
            "month": start_date.strftime("%Y-%m"),
            "job_count": count_this_month
        })

    monthly_counts.reverse()  # oldest month first
    return jsonify({"monthlyScheduled": monthly_counts})


