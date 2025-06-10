from flask import Blueprint, render_template, session
from datetime import datetime, timedelta, timezone
import requests

performance_summary_bp = Blueprint('performance_summary', __name__, template_folder='templates')
api_session = requests.Session()

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"

# Main Route
@performance_summary_bp.route('/performance_summary', methods=['GET'])
def performance_summary():
    """
    Render the main performance_summary page (HTML).
    """
    authenticate()

    #jobs_summary()

    return render_template("performance_summary.html")

# Side Dishes
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
        raise e  # Rethrow the real error


def call_service_trade_api(endpoint, params):
    try:
        response = api_session.get(endpoint, params=params)
        response.raise_for_status()
        return response
    except requests.RequestException as e:
        print(f"[ServiceTrade API Error] Endpoint: {endpoint} | Params: {params} | Error: {str(e)}")
        return {}


# Meat and Potatoes
def jobs_summary():
    
    jobs_endpoint = f"{SERVICE_TRADE_API_BASE}/job"

    window_start = datetime.timestamp(datetime(2024, 5, 1, 0, 0))
    window_end = datetime.timestamp(datetime(2025, 4, 30, 23, 59))

    current_page = 1
    jobs = []
    while True:
        job_params = {
            "status": "completed",
            "completedOnBegin": window_start,
            "completedOnEnd": window_end,
            "page": current_page,
            "limit": 500
        }

        response = call_service_trade_api(jobs_endpoint, job_params)
        data = response.json().get("data")
        jobs.extend(data.get("jobs"))

        if current_page == data.get("totalPages"):
            break

        current_page += 1

    print("number of pages: ", current_page)
    print(f"number of jobs completed in 2024 - 2025 fiscal year: {len(jobs)}")
    # Use a database and then query it later, as db queries are faster than asking the ST api.