# update_processing_data.py
from app import create_app  # your app factory
from app.models import db, JobSummary
from app.routes.processing_attack import get_jobs_processed
from datetime import datetime, timedelta
import os

app = create_app()

def update_job_summary_for_week(week_start_str):
    total_jobs_processed, total_tech_hours_processed, jobs_by_type, hours_by_type = get_jobs_processed(week_start_str)
    week_start_date = datetime.strptime(week_start_str, "%Y-%m-%d").date()
    summary = JobSummary.query.filter_by(week_start=week_start_date).first()
    now_utc = datetime.now()  # or use timezone-aware if you prefer

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

def update_past_year():
    with app.app_context():
        today = datetime.utcnow().date()
        # For example, update for every week from one year ago until now.
        start_date = today - timedelta(days=365)
        # Ensure we start on a Monday.
        start_date = start_date - timedelta(days=start_date.weekday())
        current_date = start_date

        while current_date <= today:
            week_start_str = current_date.strftime("%Y-%m-%d")
            update_job_summary_for_week(week_start_str)
            # Move to the next week.
            current_date += timedelta(days=7)
        
        # Optionally, delete records older than one year.
        cutoff_date = today - timedelta(days=365)
        old_records = JobSummary.query.filter(JobSummary.week_start < cutoff_date).all()
        for record in old_records:
            db.session.delete(record)
        db.session.commit()
        print("Old records deleted.")

if __name__ == '__main__':
    update_past_year()
