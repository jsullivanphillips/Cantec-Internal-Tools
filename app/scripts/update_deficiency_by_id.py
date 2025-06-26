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

    # Lookup if job is complete
    response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/job", params={"id": job_id})
    job_status = response.json().get("data", {}).get("status")
    is_job_complete = job_status == "completed"

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
        "job_id": job_id,
        "is_job_complete": is_job_complete,
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
                    field_changed(existing, item["is_job_complete"], "is_job_complete") or
                    field_changed(existing, item["job_id"], "job_id") or
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
                    existing.job_id = item["job_id"]
                    existing.is_job_complete = item["is_job_complete"]
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
                    job_id=item["job_id"],
                    is_job_complete=item["is_job_complete"],
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


def update_deficiency_by_job_id(job_id: str):
    from app import db

    authenticate()

    # Fetch all matching deficiency_ids for the given job_id from your database
    deficiencies = DeficiencyRecord.query.filter_by(job_id=job_id).all()

    if not deficiencies:
        print(f"⚠️ No deficiency records found in DB for job_id {job_id}")
        return

    deficiency_ids = [d.deficiency_id for d in deficiencies]

    for deficiency_id in deficiency_ids:
        print(f"Updating deficiency {deficiency_id} for job {job_id}")

        deficiency_endpoint = f"{SERVICE_TRADE_API_BASE}/deficiency/{deficiency_id}"
        deficiency_response = call_service_trade_api(deficiency_endpoint, {})

        if not deficiency_response or not deficiency_response.json().get("data"):
            print(f"Deficiency ID {deficiency_id} not found or invalid.")
            continue

        deficiency = deficiency_response.json()["data"]

        # Extract fields (same logic as before)
        status = deficiency.get("status", "")
        timestamp = deficiency.get("reportedOn")
        reported_on = datetime.fromtimestamp(timestamp) if timestamp else None
        address = safe_get(deficiency, "location", "address", "street")
        location_name = safe_get(deficiency, "location", "name")
        description = deficiency.get("description", "")
        proposed_solution = deficiency.get("proposedFix", "")
        tech_name = safe_get(deficiency, "reporter", "name")
        tech_image_link = safe_get(deficiency, "reporter", "avatar", "small")
        job_link = f"{SERVICE_TRADE_JOB_BASE}/{job_id}" if job_id else ""
        service_line_name = safe_get(deficiency, "serviceLine", "name")
        service_line_icon_link = safe_get(deficiency, "serviceLine", "icon")
        severity = deficiency.get("severity", "")

        # Location info
        location_endpoint = f"{SERVICE_TRADE_API_BASE}/location"
        location_params = {"name": location_name}
        location_response = call_service_trade_api(location_endpoint, location_params)
        locations = location_response.json().get("data", {}).get("locations")
        current_location = locations[0] if isinstance(locations, list) and locations else {}
        is_monthly_access = is_location_monthly_access(current_location)
        company = safe_get(current_location, "company", "name")

        # Job status
        response = call_service_trade_api(f"{SERVICE_TRADE_API_BASE}/job", params={"id": job_id})
        job_status = response.json().get("data", {}).get("status")
        is_job_complete = job_status == "completed"

        # Quote info
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

        # Prepare update
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
            "job_id": job_id,
            "is_job_complete": is_job_complete,
            "service_line_name": service_line_name,
            "service_line_icon_link": service_line_icon_link,
            "severity": severity,
            "is_quote_sent": is_quote_sent,
            "is_quote_approved": is_quote_approved,
            "is_quote_in_draft": is_quote_in_draft,
            "quote_expiry": quote_expiry
        }

        try:
            with db.session.no_autoflush:
                existing = DeficiencyRecord.query.filter_by(deficiency_id=deficiency_id).first()

                if existing:
                    if (
                        field_changed(existing, item["status"], "status") or
                        field_changed(existing, item["reported_on"], "reported_on") or
                        field_changed(existing, item["is_monthly_access"], "is_monthly_access") or
                        field_changed(existing, item["company"], "company") or
                        field_changed(existing, item["severity"], "severity") or
                        field_changed(existing, item["job_link"], "job_link") or
                        field_changed(existing, item["job_id"], "job_id") or
                        field_changed(existing, item["is_job_complete"], "is_job_complete") or
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
                        existing.job_id = item["job_id"]
                        existing.is_job_complete = item["is_job_complete"]
                        existing.is_quote_sent = item["is_quote_sent"]
                        existing.is_quote_approved = item["is_quote_approved"]
                        existing.is_quote_in_draft = item["is_quote_in_draft"]
                        existing.quote_expiry = item["quote_expiry"]

                        if item["status"] and item["status"].lower() in ("fixed", "invalid"):
                            existing.is_archived = True

                        print(f"Updated deficiency {deficiency_id}")
                    else:
                        print(f"No update needed for {deficiency_id}")
                else:
                    print(f"Deficiency ID {deficiency_id} not found in DB for job {job_id}")

            db.session.commit()

        except Exception as e:
            db.session.rollback()
            print(f"Error updating deficiency {deficiency_id}: {e}")




if __name__ == '__main__':
    import sys
    import os
    import argparse
    from app import create_app

    # Setup argument parser
    parser = argparse.ArgumentParser(description="Update deficiency records")
    parser.add_argument("--deficiency_id", type=str, help="Specific deficiency ID to update")
    parser.add_argument("--job_id", type=str, help="Job ID to update all related deficiencies")

    args = parser.parse_args()

    if not args.deficiency_id and not args.job_id:
        print("⚠️  Please provide either --deficiency_id or --job_id.")
        print("Example: python update_deficiency.py --deficiency_id 123456")
        print("     or: python update_deficiency.py --job_id 789012")
        sys.exit(1)

    app = create_app()

    with app.app_context():
        with app.test_request_context():
            from flask import session
            import os

            # Populate session with ServiceTrade API credentials
            session['username'] = os.environ.get("PROCESSING_USERNAME")
            session['password'] = os.environ.get("PROCESSING_PASSWORD")

            # Call the updater
            if args.deficiency_id:
                update_deficiency_by_id(args.deficiency_id)
            elif args.job_id:
                update_deficiency_by_job_id(args.job_id)

