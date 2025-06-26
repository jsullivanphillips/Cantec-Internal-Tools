from flask import Blueprint, render_template, jsonify, session, request
from dataclasses import asdict
import requests
import json
from datetime import datetime, timedelta, timezone
from app.models.deficiency import Deficiency
from typing import Any, Dict
from app.db_models import DeficiencyRecord
from sqlalchemy import and_
import pytz

deficiency_tracker_bp = Blueprint('deficiency_tracker', __name__, template_folder='templates')
api_session = requests.Session()

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
SERVICE_TRADE_JOB_BASE = "https://app.servicetrade.com/jobs"
SERVICE_TRADE_DEFICIENCY_BASE = "https://app.servicetrade.com/deficiency/details/id"
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
    

    if not payload["username"] or not payload["password"]:
        raise Exception("Missing ServiceTrade credentials in session.")

    try:
        auth_response = api_session.post(auth_url, json=payload)
        auth_response.raise_for_status()
        print("✅ Authenticated successfully with ServiceTrade!")
    except Exception as e:
        print("❌ Authentication with ServiceTrade failed!")
        raise e  # Rethrow the real error



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
        return response
    except requests.RequestException as e:
        print(f"[ServiceTrade API Error] Endpoint: {endpoint} | Params: {params} | Error: {str(e)}")
        return {}


def is_location_monthly_access(location):
    tags = location.get("tags", [])
    for tag in tags:
        tag_name = tag.get("name")
        if tag_name == "Monthlies":
            return True
    return False


def serialize_deficiency(d):
    d_dict = asdict(d)
    if d.reported_on:
        d_dict["reported_on"] = d.reported_on.isoformat()
    return d_dict


@deficiency_tracker_bp.route('/deficiency_tracker/deficiency_list', methods=['POST'])
def deficiency_tracker_deficiency_list():
    deficiencies = DeficiencyRecord.active().order_by(DeficiencyRecord.reported_on.desc()).all()

    return jsonify([
        {
            "deficiency_id": d.deficiency_id,
            "status": d.status,
            "reported_on": d.reported_on.isoformat() if d.reported_on else None,
            "address": d.address,
            "monthly_access": d.is_monthly_access,
            "severity": d.severity,
            "description": d.description,
            "proposed_solution": d.proposed_solution,
            "company": d.company,
            "reported_by": d.tech_name,
            "reporter_image_link": d.tech_image_link,
            "job_link": d.job_link,
            "service_line": d.service_line_name,
            "service_line_icon_link": d.service_line_icon_link,
            "is_quote_sent": d.is_quote_sent,
            "is_quote_approved": d.is_quote_approved,
            "is_quote_in_draft": d.is_quote_in_draft,
            "hidden": d.hidden,
            "quote_expiry": d.quote_expiry
        }
    for d in deficiencies])
    
@deficiency_tracker_bp.route('/deficiency_tracker/hide_toggle', methods=['POST'])
def deficiency_tracker_hide_toggle():
    body = request.get_json()
    deficiency_id = body.get("deficiency_id")
    hidden = body.get("hidden", False)

    record = DeficiencyRecord.query.filter_by(deficiency_id=deficiency_id).first()
    if not record:
        return jsonify({"error": "Deficiency not found"}), 404

    record.hidden = hidden
    from app import db
    db.session.commit()

    return jsonify({"success": True})


def fetch_deficiencies(start_date: datetime, end_date: datetime):
    # Authenticate
    authenticate()

    # Convert dates to UNIX timestamps
    deficiency_params = {
        "createdBefore": int(end_date.timestamp()),
        "createdAfter": int(start_date.timestamp())
    }

    deficiency_endpoint = f"{SERVICE_TRADE_API_BASE}/deficiency"
    location_endpoint = f"{SERVICE_TRADE_API_BASE}/location"
    job_endpoint = f"{SERVICE_TRADE_API_BASE}/job"
    quote_endpoint = f"{SERVICE_TRADE_API_BASE}/quote"

    response = call_service_trade_api(deficiency_endpoint, deficiency_params)
    response_data = response.json().get("data", {})
    deficiencies_json = response_data.get("deficiencies", {})

    print(f"Received data from deficiencies endpoint for range {start_date} -> {end_date}")
    print(f"Number of deficiencies found: {len(deficiencies_json)}")

    deficiencies = []
    print("Processing Deficiencies")
    total_deficiencies = len(deficiencies_json)

    for i, deficiency in enumerate(deficiencies_json, start=1):
        print(f"Processing Deficiency {i}/{total_deficiencies}", end="\r", flush=True)
        job_id = safe_get(deficiency, "job", "id")
        deficiency_id = deficiency.get("id", "")
        status = deficiency.get("status", "")
        timestamp = deficiency.get("reportedOn")
        reported_on = datetime.fromtimestamp(timestamp) if timestamp else None
        address = safe_get(deficiency, "location", "address", "street")
        location_name = safe_get(deficiency, "location", "name")
        description = deficiency.get("description", "")
        proposed_solution = deficiency.get("proposedFix", "")
        tech_name = safe_get(deficiency, "reporter", "name")
        tech_image_link = safe_get(deficiency, "reporter", "avatar", "small")
        job_link = f"{SERVICE_TRADE_DEFICIENCY_BASE}/{deficiency_id}" if deficiency_id else ""
        service_line_name = safe_get(deficiency, "serviceLine", "name")
        service_line_icon_link = safe_get(deficiency, "serviceLine", "icon")
        severity = deficiency.get("severity", "")

        # Lookup location details
        response = call_service_trade_api(location_endpoint, {"name": location_name})
        locations = response.json().get("data", {}).get("locations")
        current_location = locations[0] if isinstance(locations, list) and locations else {}

        if not current_location:
            continue

        is_monthly_access = is_location_monthly_access(current_location)
        company = safe_get(current_location, "company", "name")

        # Lookup if job is complete
        if job_id:
            response = call_service_trade_api(job_endpoint, params={"id": job_id})
            job_status = response.json().get("data", {}).get("status")
            is_job_complete = job_status == "completed"
        else:
            is_job_complete = False

        # Lookup if deficiency is out for quote
        response = call_service_trade_api(quote_endpoint, {"deficiencyId": deficiency_id})
        is_deficiency_quote_approved = False
        is_quote_in_draft = False
        is_quote_sent = False
        quote_expiry = None
        response_data = response.json().get("data", {})
        if response_data:
            quotes = response_data.get("quotes")
            if len(quotes) > 0:
                for quote in quotes:
                    expires_on_ts = quote.get("expiresOn")
                    if expires_on_ts:
                        # First, create UTC-aware datetime
                        quote_expiry_utc = datetime.fromtimestamp(expires_on_ts, tz=timezone.utc)

                        # If you want it in PDT (Pacific Time), use pytz
                        pdt = pytz.timezone('America/Los_Angeles')
                        quote_expiry = quote_expiry_utc.astimezone(pdt)
                    else:
                        quote_expiry = None
                    
                    quote_status = quote.get("quoteRequest").get("status")
                    print(f"{deficiency.get("title")} | quote status: {quote_status} | deficiency id: {deficiency_id}")
                    if quote_status == "approved":
                        is_deficiency_quote_approved = True
                    elif quote_status == "waiting":
                        is_quote_in_draft = True
                    elif quote_status == "quote_received":
                        is_quote_sent = True


        deficiency_obj = Deficiency(
            deficiency_id=deficiency_id,
            status=status,
            reported_on=reported_on,
            address=address,
            location_name=location_name,
            is_monthly_access=is_monthly_access,
            description=description,
            proposed_solution=proposed_solution,
            company=company,
            tech_name=tech_name,
            tech_image_link=tech_image_link,
            job_link=job_link,
            is_job_complete=is_job_complete,
            job_id=job_id,
            service_line_name=service_line_name,
            service_line_icon_link=service_line_icon_link,
            severity=severity,
            is_quote_sent=is_quote_sent,
            is_quote_approved=is_deficiency_quote_approved,
            is_quote_in_draft=is_quote_in_draft,
            quote_expiry=quote_expiry
        )
        deficiencies.append(deficiency_obj)

    print()
    return jsonify({"data": [serialize_deficiency(d) for d in deficiencies]})
