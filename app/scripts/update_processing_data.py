# update_processing_data.py
import os
from datetime import datetime, timedelta, timezone
from app import create_app
from app.models import db, JobSummary
from app.routes.processing_attack import get_jobs_processed

# Load environment variables from .env using python-dotenv.
from dotenv import load_dotenv
load_dotenv()

app = create_app()

def update_job_summary_for_week(week_start_str):
    total_jobs_processed, total_tech_hours_processed, jobs_by_type, hours_by_type = get_jobs_processed(week_start_str)
    week_start_date = datetime.strptime(week_start_str, "%Y-%m-%d").date()
    now_utc = datetime.now(timezone.utc)  # Use timezone-aware datetime

    summary = JobSummary.query.filter_by(week_start=week_start_date).first()
    if summary:
        summary.total_jobs_processed = total_jobs_processed
        summary.total_tech_hours_processed = total_tech_hours_processed
        summary.jobs_by_type = jobs_by_type
        summary.hours_by_type = hours_by_type
        summary.updated_at = now_utc
    else:
        summary = JobSummary(
            week_start=week_start_date,
            total_jobs_processed=total_jobs_processed,
            total_tech_hours_processed=total_tech_hours_processed,
            jobs_by_type=jobs_by_type,
            hours_by_type=hours_by_type,
            updated_at=now_utc
        )
        db.session.add(summary)
    db.session.commit()
    print(f"Updated JobSummary for week starting {week_start_str}")

def should_run_today():
    # Monday is represented by 0
    return datetime.now(timezone.utc).weekday() == 0


def update_past_year():
    with app.app_context():
        # Create a test request context so that Flask's session is available.
        with app.test_request_context():
            # Import session from Flask.
            from flask import session

            # Set session credentials from environment variables.
            session['username'] = os.environ.get("PROCESSING_USERNAME")
            session['password'] = os.environ.get("PROCESSING_PASSWORD")

            today = datetime.now(timezone.utc).date()
            # Update for every week from one year ago until now.
            start_date = today - timedelta(days=365)
            # Adjust so we start on a Monday.
            start_date = start_date - timedelta(days=start_date.weekday())
            current_date = start_date

            while current_date <= today:
                week_start_str = current_date.strftime("%Y-%m-%d")
                update_job_summary_for_week(week_start_str)
                current_date += timedelta(days=7)
            
            # Optionally, delete records older than one year.
            cutoff_date = today - timedelta(days=365)
            old_records = JobSummary.query.filter(JobSummary.week_start < cutoff_date).all()
            for record in old_records:
                db.session.delete(record)
            db.session.commit()
            print("Old records deleted.")

if __name__ == '__main__':
    if should_run_today():
        update_past_year()
    else:
        print("Not the scheduled day, skipping job.")
