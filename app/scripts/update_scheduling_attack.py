# update_processing_data.py
import os
from datetime import datetime, timedelta, timezone, date, time
from dateutil.relativedelta import relativedelta
from pytz import UTC
from app import create_app
from app.db_models import db, SchedulingAttack
from app.routes.scheduling_attack import get_scheduling_attack

from dotenv import load_dotenv
load_dotenv()

app = create_app()

# month_start is a date object (e.g. datetime.date(2024, 7, 1))
def update_scheduling_attack(month_start, force_update=False):
    # Format the month string for get_scheduling_attack.
    month_str = month_start.strftime("%Y-%m")
    
    # Calculate month_end_datetime (last moment of the month)
    month_end_date = (month_start + relativedelta(months=1)) - timedelta(days=1)
    month_end_datetime = datetime.combine(month_end_date, datetime.max.time(), tzinfo=timezone.utc)

    # Check if a record for this month already exists.
    existing_record = SchedulingAttack.query.filter_by(month_start=month_start).first()

    # If force_update is False, check the updated_at timestamp.
    if existing_record and existing_record.updated_at and not force_update:
        updated_at = existing_record.updated_at
        # Ensure updated_at is timezone-aware
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)

        if updated_at > month_end_datetime:
            print(f"Scheduling attack metrics for month {month_str} were updated after the month ended. Skipping update.")
            return
        else:
            print(f"Scheduling attack metrics for month {month_str} exist but are outdated. Overwriting...")
            # Delete the old record(s) for that month
            SchedulingAttack.query.filter_by(month_start=month_start).delete()
            db.session.commit()
    elif existing_record and force_update:
        print(f"Force update enabled. Overwriting scheduling attack metrics for month {month_str}.")
        SchedulingAttack.query.filter_by(month_start=month_start).delete()
        db.session.commit()

    # Call get_scheduling_attack() to get the latest data.
    response = get_scheduling_attack(month_str)
    data = response.get_json()

    # Create a new record using the returned data
    new_record = SchedulingAttack(
        month_start = month_start,
        released_fa_jobs = data.get("released_fa_jobs", 0),
        released_fa_tech_hours = data.get("released_fa_tech_hours", 0.0),
        scheduled_fa_jobs = data.get("scheduled_fa_jobs", 0),
        scheduled_fa_tech_hours = data.get("scheduled_fa_tech_hours", 0.0),
        to_be_scheduled_fa_jobs = data.get("to_be_scheduled_fa_jobs", 0),
        to_be_scheduled_fa_tech_hours = data.get("to_be_scheduled_fa_tech_hours", 0.0),
        released_sprinkler_jobs = data.get("released_sprinkler_jobs", 0),
        released_sprinkler_tech_hours = data.get("released_sprinkler_tech_hours", 0.0),
        scheduled_sprinkler_jobs = data.get("scheduled_sprinkler_jobs", 0),
        scheduled_sprinkler_tech_hours = data.get("scheduled_sprinkler_tech_hours", 0.0),
        to_be_scheduled_sprinkler_jobs = data.get("to_be_scheduled_sprinkler_jobs", 0),
        to_be_scheduled_sprinkler_tech_hours = data.get("to_be_scheduled_sprinkler_tech_hours", 0.0),
        jobs_to_be_scheduled = data.get("jobs_to_be_scheduled"),
        not_counted_fa_locations = data.get("not_counted_fa_locations")
    )
    db.session.add(new_record)
    db.session.commit()
    print(f"Scheduling attack metrics for month {month_str} have been updated.")



def update_all_metrics(force_update):
    with app.app_context():
        with app.test_request_context():
            from flask import session
            session['username'] = os.environ.get("PROCESSING_USERNAME")
            session['password'] = os.environ.get("PROCESSING_PASSWORD")
            today = datetime.now(timezone.utc).date()
            # Get the first day of the current month.
            current_month_start = date(today.year, today.month, 1)
            
            # Iterate from 2 months ago to 3 months ahead (inclusive)
            for offset in range(-2, 3):  # Offsets: -2, -1, 0, 1, 2, 3
                target_month = current_month_start + relativedelta(months=offset)
                print(f"Updating scheduling attack metrics for {target_month.strftime('%Y-%m-%d')}")
                update_scheduling_attack(target_month, force_update)


if __name__ == '__main__':
    force_update = False
    update_all_metrics(force_update)