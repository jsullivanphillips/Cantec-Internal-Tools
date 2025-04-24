from app.db_models import DeficiencyRecord
from app.routes.deficiency_tracker import call_service_trade_api, is_location_monthly_access, safe_get
from datetime import datetime

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
SERVICE_TRADE_JOB_BASE = "https://app.servicetrade.com/job"

def update_deficiency_by_id(deficiency_id: str):
    from app import db
    deficiency_endpoint = f"{SERVICE_TRADE_API_BASE}/deficiency/{deficiency_id}"
    deficiency_response = call_service_trade_api(deficiency_endpoint, {})

    if not deficiency_response or not deficiency_response.json().get("data"):
        print(f"⚠️ Deficiency ID {deficiency_id} not found or invalid.")
        return

    deficiency = deficiency_response.json()["data"]

    # Extract fields
    status = deficiency.get("status", "")
    timestamp = deficiency.get("reportedOn")
    reported_on = datetime.fromtimestamp(timestamp) if timestamp else None
    address = safe_get(deficiency, "location", "address", "street")
    location_name = safe_get(deficiency, "location", "name")
    description = deficiency.get("description", "")
    proposed_solution = deficiency.get("proposedFix", "")
    tech_name = safe_get(deficiency, "reporter", "name")
    tech_image_link = safe_get(deficiency, "reporter", "avatar", "small")
    job_id = safe_get(deficiency, "job", "id")
    job_link = f"{SERVICE_TRADE_JOB_BASE}/{job_id}" if job_id else ""
    service_line_name = safe_get(deficiency, "serviceLine", "name")
    service_line_icon_link = safe_get(deficiency, "serviceLine", "icon")
    severity = deficiency.get("severity", "")

    # Lookup location info (for tags & company)
    location_endpoint = f"{SERVICE_TRADE_API_BASE}/location"
    location_params = {"name": location_name}
    location_response = call_service_trade_api(location_endpoint, location_params)
    locations = location_response.json().get("data", {}).get("locations")
    current_location = locations[0] if isinstance(locations, list) and locations else {}
    is_monthly_access = is_location_monthly_access(current_location)
    company = safe_get(current_location, "company", "name")

    with db.session.begin():
        record = DeficiencyRecord.query.filter_by(deficiency_id=deficiency_id).first()

        if record:
            record.status = status
            record.reported_on = reported_on
            record.is_monthly_access = is_monthly_access
            record.company = company
            record.severity = severity

            if status.lower() in ("fixed", "invalid"):
                record.is_archived = True
        else:
            record = DeficiencyRecord(
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
                service_line_name=service_line_name,
                service_line_icon_link=service_line_icon_link,
                severity=severity,
                is_archived=(status.lower() in ("fixed", "invalid"))
            )
            db.session.add(record)

    print(f"✅ Deficiency {deficiency_id} processed successfully.")
