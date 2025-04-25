from app.db_models import DeficiencyRecord
from app.routes.deficiency_tracker import call_service_trade_api, is_location_monthly_access, safe_get, authenticate
from datetime import datetime, timezone

SERVICE_TRADE_API_BASE = "https://api.servicetrade.com/api"
SERVICE_TRADE_JOB_BASE = "https://app.servicetrade.com/job"

def field_changed(existing, incoming, field):
    existing_val = getattr(existing, field)

    if isinstance(existing_val, datetime) and isinstance(incoming, datetime):
        if existing_val.tzinfo is None:
            existing_val = existing_val.replace(tzinfo=timezone.utc)
        if incoming.tzinfo is None:
            incoming = incoming.replace(tzinfo=timezone.utc)
    return existing_val != incoming


def update_deficiency_by_id(deficiency_id: str):
    from app import db

    print(f"Fetching deficiency {deficiency_id}...")

    authenticate()
    
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

    # Quote Info
    is_quote_sent = False
    is_quote_approved = False
    is_quote_in_draft = False
    quote_expiry = None

    quote_endpoint = f"{SERVICE_TRADE_API_BASE}/quote"
    quote_response = call_service_trade_api(quote_endpoint, {"deficiencyId": deficiency_id})
    quote_data = quote_response.json().get("data", {})
    if quote_data:
        quotes = quote_data.get("quotes", [])
        for quote in quotes:
            quote_status = safe_get(quote, "quoteRequest", "status")
            if quote_status == "approved":
                is_quote_approved = True
            elif quote_status == "waiting":
                is_quote_in_draft = True
            elif quote_status == "quote_received":
                is_quote_sent = True
            if quote.get("expiresOn"):
                quote_expiry = datetime.fromtimestamp(quote["expiresOn"], tz=timezone.utc)

    # Prepare incoming item like `update_deficiency_records`
    item = {
        "deficiency_id": deficiency_id,
        "status": status,
        "reported_on": reported_on,
        "address": address,
        "location_name": location_name,
        "is_monthly_access": is_monthly_access,
        "description": description,
        "proposed_solution": proposed_solution,
        "company": company,
        "tech_name": tech_name,
        "tech_image_link": tech_image_link,
        "job_link": job_link,
        "service_line_name": service_line_name,
        "service_line_icon_link": service_line_icon_link,
        "severity": severity,
        "is_quote_sent": is_quote_sent,
        "is_quote_approved": is_quote_approved,
        "is_quote_in_draft": is_quote_in_draft,
        "quote_expiry": quote_expiry
    }

    added = 0
    updated = 0
    skipped = 0

    from sqlalchemy.exc import IntegrityError

    try:
        with db.session.no_autoflush:
            existing = DeficiencyRecord.query.filter_by(deficiency_id=str(deficiency_id)).first()

            if existing:
                # Update if anything changed
                if (
                    field_changed(existing, item["status"], "status") or
                    field_changed(existing, item["reported_on"], "reported_on") or
                    field_changed(existing, item["is_monthly_access"], "is_monthly_access") or
                    field_changed(existing, item["company"], "company") or
                    field_changed(existing, item["severity"], "severity") or
                    field_changed(existing, item["job_link"], "job_link") or
                    field_changed(existing, item["is_quote_sent"], "is_quote_sent") or
                    field_changed(existing, item["is_quote_approved"], "is_quote_approved") or
                    field_changed(existing, item["is_quote_in_draft"], "is_quote_in_draft") or
                    field_changed(existing, item["quote_expiry"], "quote_expiry")
                ):
                    existing.status = item["status"]
                    existing.reported_on = item["reported_on"]
                    existing.is_monthly_access = item["is_monthly_access"]
                    existing.company = item["company"]
                    existing.severity = item["severity"]
                    existing.job_link = item["job_link"]
                    existing.is_quote_sent = item["is_quote_sent"]
                    existing.is_quote_approved = item["is_quote_approved"]
                    existing.is_quote_in_draft = item["is_quote_in_draft"]
                    existing.quote_expiry = item["quote_expiry"]

                    if item["status"] and item["status"].lower() in ("fixed", "invalid"):
                        existing.is_archived = True

                    updated += 1
                else:
                    skipped += 1

            else:
                # Insert new record
                record = DeficiencyRecord(
                    deficiency_id=str(item["deficiency_id"]),
                    status=item["status"],
                    reported_on=item["reported_on"],
                    address=item["address"],
                    location_name=item["location_name"],
                    is_monthly_access=item["is_monthly_access"],
                    description=item["description"],
                    proposed_solution=item["proposed_solution"],
                    company=item["company"],
                    tech_name=item["tech_name"],
                    tech_image_link=item["tech_image_link"],
                    job_link=item["job_link"],
                    service_line_name=item["service_line_name"],
                    service_line_icon_link=item["service_line_icon_link"],
                    severity=item["severity"],
                    is_quote_sent=item["is_quote_sent"],
                    is_quote_approved=item["is_quote_approved"],
                    is_quote_in_draft=item["is_quote_in_draft"],
                    quote_expiry=item["quote_expiry"]
                )
                db.session.add(record)
                added += 1

        db.session.commit()

    except IntegrityError as e:
        db.session.rollback()
        print(f"❌ Duplicate or insert error for deficiency_id {deficiency_id}: {e}")

    print(f"✅ Deficiency {deficiency_id} processed: {added} added, {updated} updated, {skipped} skipped.")


if __name__ == '__main__':
    import sys
    from app import create_app

    if len(sys.argv) < 2:
        print("⚠️  Please provide a deficiency_id.")
        print("Example: python update_deficiency_by_id.py 123456")
        sys.exit(1)

    deficiency_id = sys.argv[1]

    app = create_app()
    with app.app_context():
        from flask import session
        import os

        # Populate session with ServiceTrade API credentials
        session['username'] = os.environ.get("PROCESSING_USERNAME")
        session['password'] = os.environ.get("PROCESSING_PASSWORD")

        # Call the updater
        update_deficiency_by_id(deficiency_id)

