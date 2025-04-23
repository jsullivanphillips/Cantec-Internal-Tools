from flask import Blueprint, render_template, jsonify, session
import requests
import json
from datetime import datetime, timedelta
from app.models.deficiency import Deficiency
from typing import Any, Dict

deficiency_tracker_bp = Blueprint('deficiency_tracker', __name__, template_folder='templates')
api_session = requests.Session()

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
SERVICE_TRADE_JOB_BASE = "https://app.servicetrade.com/jobs/"
API_KEY = "YOUR_API_KEY"


# Main Route
@deficiency_tracker_bp.route('/deficiency_tracker', methods=['GET'])
def deficiency_tracker():
    """
    Render the main processing_attack page (HTML).
    """
    return render_template("deficiency_tracker.html")

# Helper Authentication
def authenticate():
    auth_url = "https://api.servicetrade.com/api/auth"
    payload = {"username": session.get('username'), "password": session.get('password')}
    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
    except Exception as e:
        return jsonify({"error": "Authentication failed"}), 401

def safe_get(d: Dict[str, Any], *keys) -> Any:
    """Safely retrieve a nested value from a dictionary."""
    for key in keys:
        if not isinstance(d, dict):
            return None
        d = d.get(key)
        if d is None:
            return None
    return d


def call_service_trade_api(endpoint, params):
    try:
        response = api_session.get(endpoint, params=params)
        response.raise_for_status()
    except requests.RequestException as e:
        return {}
    return response

# Grabbing Deficiencies from Service Trade API
@deficiency_tracker_bp.route('/deficiency_tracker/deficiency_list', methods=['POST'])
def deficiency_tracker_deficiency_list():

    # Authenticate
    authenticate()

    # prepare param variables
    today = datetime.today()
    start_date = today - timedelta(days=10)

    # Prepare API call
    deficiency_endpoint = f"{SERVICE_TRADE_API_BASE}/deficiency"
    deficiency_params = {
        "createdBefore" : int(today.timestamp()),
        "createdAfter": int(start_date.timestamp())
    }

    response = call_service_trade_api(deficiency_endpoint, deficiency_params)
    
    response_data = response.json().get("data", {})
    deficiencies_json = response_data.get("deficiencies", {})

    print(f"received data from deficiencies endpoint for range {start_date} -> {today}")
    print(f"Number of deficiencies found: {len(deficiencies_json)}")

    deficiencies = []
    for deficiency in deficiencies_json:
        status = deficiency.get("status", "")
        timestamp = deficiency.get("reportedOn")
        reported_on = datetime.fromtimestamp(timestamp) if timestamp else None
        address = safe_get(deficiency, "location", "address", "street")
        description = deficiency.get("description", "")
        proposed_solution = deficiency.get("proposedFix", "")
        tech_name = safe_get(deficiency, "reporter", "name")
        tech_image_link = safe_get(deficiency, "reporter", "avatar", "small")
        job_id = safe_get(deficiency, "job", "id")
        job_link = f"{SERVICE_TRADE_JOB_BASE}/{job_id}" if job_id else ""
        service_line_name = safe_get(deficiency, "serviceLine", "name")
        service_line_icon_link = safe_get(deficiency, "serviceLine", "icon")
        severity = deficiency.get("severity", "")

        deficiency_obj = Deficiency(
            status=status,
            reported_on=reported_on,
            address=address,
            is_monthly_access=False,  # placeholder; to be filled after Location API call
            description=description,
            proposed_solution=proposed_solution,
            company="",               # placeholder; to be filled after Location API call
            tech_name=tech_name,
            tech_image_link=tech_image_link,
            job_link=job_link,
            service_line_name=service_line_name,
            service_line_icon_link=service_line_icon_link,
            severity=severity
        )

        deficiencies.append(deficiency_obj)
        
    print(deficiencies[0])

    response_data = {
        "data" : "nothing"
    }

    return response_data