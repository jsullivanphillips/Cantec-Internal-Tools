import os
from app import create_app, db
from flask import current_app as app
from app.routes.deficiency_tracker import fetch_deficiencies
from app.db_models import DeficiencyRecord
from datetime import datetime, timezone
from sqlalchemy.exc import IntegrityError

app = create_app()

FIELDS_TO_CHECK = [
    "status", "reported_on", "is_monthly_access", "company", "severity", "job_link"
]

def field_changed(existing, incoming, field):
    existing_val = getattr(existing, field)
    
    if isinstance(existing_val, datetime) and isinstance(incoming, datetime):
        # Normalize both to UTC-aware
        if existing_val.tzinfo is None:
            existing_val = existing_val.replace(tzinfo=timezone.utc)
        if incoming.tzinfo is None:
            incoming = incoming.replace(tzinfo=timezone.utc)
    
    return existing_val != incoming



def update_deficiency_records(start_date: datetime, end_date: datetime):
    with app.test_request_context():
        from flask import session
        session['username'] = os.environ.get("PROCESSING_USERNAME")
        session['password'] = os.environ.get("PROCESSING_PASSWORD")

        print("Fetching deficiencies...")
        response = fetch_deficiencies(start_date, end_date)
        deficiencies_data = response.get_json()["data"]

        print(f"Processing {len(deficiencies_data)} deficiencies...")
        added = 0
        skipped = 0
        updated = 0

        for item in deficiencies_data:
            incoming_reported_on = datetime.fromisoformat(item["reported_on"]) if item["reported_on"] else None
            try:
                with db.session.no_autoflush:
                    existing = DeficiencyRecord.query.filter_by(deficiency_id=str(item["deficiency_id"])).first()

                    if existing:
                        # Detect if anything actually changed
                        if (
                            field_changed(existing, item["status"], "status") or
                            field_changed(existing, incoming_reported_on, "reported_on") or
                            field_changed(existing, item["is_monthly_access"], "is_monthly_access") or
                            field_changed(existing, item["company"], "company") or
                            field_changed(existing, item["severity"], "severity") or 
                            field_changed(existing, item["job_link"], "job_link") or 
                            field_changed(existing, item["is_quote_sent"], "is_quote_sent") or 
                            field_changed(existing, item["is_quote_approved"], "is_quote_approved") or
                            field_changed(existing, item["is_quote_in_draft"], "is_quote_in_draft")
                        ):
                            existing.status = item["status"]
                            existing.reported_on = incoming_reported_on
                            existing.is_monthly_access = item["is_monthly_access"]
                            existing.company = item["company"]
                            existing.severity = item["severity"]
                            existing.job_link = item["job_link"]
                            existing.is_quote_sent = item["is_quote_sent"]
                            existing.is_quote_approved = item["is_quote_approved"]
                            existing.is_quote_in_draft = item["is_quote_in_draft"]

                            if item["status"].lower() in ("fixed", "invalid"):
                                existing.is_archived = True

                            updated += 1
                        else:
                            skipped += 1
                            continue

                    else:
                        # 🔒 Double-check before adding, even inside no_autoflush
                        if not DeficiencyRecord.query.filter_by(deficiency_id=str(item["deficiency_id"])).first():
                            record = DeficiencyRecord(
                                deficiency_id=str(item["deficiency_id"]),
                                status=item["status"],
                                reported_on=incoming_reported_on,
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
                                is_quote_in_draft=item["is_quote_in_draft"]
                            )
                            db.session.add(record)
                            added += 1
                        else:
                            print(f"⚠️ Skipped duplicate insert attempt for {item['deficiency_id']}")
                            skipped += 1

                db.session.commit()

            except IntegrityError as e:
                db.session.rollback()
                print(f"❌ Duplicate or insert error for deficiency_id {item['deficiency_id']}: {e}")

        print(f"✅ {added} new deficiencies added.")
        print(f"🛠️  {updated} deficiencies updated.")
        print(f"⚠️  {skipped} unchanged deficiencies skipped.")
            

if __name__ == '__main__':
    app = create_app()
    with app.app_context():
        with app.test_request_context():
            from flask import session
            session['username'] = os.environ.get("PROCESSING_USERNAME")
            session['password'] = os.environ.get("PROCESSING_PASSWORD")
            update_deficiency_records(
                start_date=datetime(2025, 4, 1),
                end_date=datetime.today()
            )
