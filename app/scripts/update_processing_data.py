# update_processing_data.py
import os
from datetime import datetime, timedelta, timezone
from app import create_app
from app.models import db, JobSummary, ProcessorMetrics
from app.routes.processing_attack import get_jobs_processed, get_jobs_processed_by_processor

# Load environment variables from .env using python-dotenv.
from dotenv import load_dotenv
load_dotenv()

app = create_app()

def update_job_summary_for_week(week_start_str):
    week_start_date = datetime.strptime(week_start_str, "%Y-%m-%d").date()
    summary = JobSummary.query.filter_by(week_start=week_start_date).first()
    if summary:
        print(f"Entry for week {week_start_str} already exists. Skipping update.")
        return  # Exit the function if the record exists

    # Otherwise, gather the data and create a new record.
    total_jobs_processed, total_tech_hours_processed, jobs_by_type, hours_by_type = get_jobs_processed(week_start_str)
    now_utc = datetime.now(timezone.utc)
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

def update_processor_metrics_for_week(week_start_str):
    week_start_date = datetime.strptime(week_start_str, "%Y-%m-%d").date()

    # Check if any processor metrics already exist for this week
    if ProcessorMetrics.query.filter_by(week_start=week_start_date).first():
        print(f"Processor metrics already exist for week starting {week_start_str}. Skipping update.")
        return

    # Only call the API if no records exist for this week
    jobs_by_processor, hours_by_processor = get_jobs_processed_by_processor(week_start_str)
    now_utc = datetime.now(timezone.utc)

    # Loop through the processors from the API results and add new records
    for processor, job_count in jobs_by_processor.items():
        hours = hours_by_processor.get(processor, 0)
        record = ProcessorMetrics(
            week_start=week_start_date,
            processor_name=processor,
            jobs_processed=job_count,
            hours_processed=hours,
            updated_at=now_utc
        )
        db.session.add(record)
    db.session.commit()
    print(f"Processor metrics updated for week starting {week_start_str}")


def update_all_metrics():
    with app.app_context():
        # Create a test request context so Flask's session is available.
        with app.test_request_context():
            from flask import session
            session['username'] = os.environ.get("PROCESSING_USERNAME")
            session['password'] = os.environ.get("PROCESSING_PASSWORD")

            today = datetime.now(timezone.utc).date()
            # Start one year ago, aligned to a Monday.
            start_date = today - timedelta(days=365)
            start_date = start_date - timedelta(days=start_date.weekday())
            current_date = start_date

            while current_date <= today:
                week_start_str = current_date.strftime("%Y-%m-%d")
                update_job_summary_for_week(week_start_str)
                update_processor_metrics_for_week(week_start_str)
                current_date += timedelta(days=7)
            
            # Optionally, delete records older than one year.
            cutoff_date = today - timedelta(days=365)
            old_job_summaries = JobSummary.query.filter(JobSummary.week_start < cutoff_date).all()
            for record in old_job_summaries:
                db.session.delete(record)
            old_processor_records = ProcessorMetrics.query.filter(ProcessorMetrics.week_start < cutoff_date).all()
            for record in old_processor_records:
                db.session.delete(record)
            db.session.commit()
            print("Old records deleted.")

def should_run_today():
    # Monday is represented by 0
    return datetime.now(timezone.utc).weekday() == 0


if __name__ == '__main__':
    update_all_metrics() # delete once in prod
    if should_run_today():
        update_all_metrics()
    else:
        print("Not the scheduled day, skipping job.")


