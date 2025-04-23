# update_processing_data.py
import os
from datetime import datetime, timedelta, timezone, date, time
from pytz import UTC
from app import create_app
from app.db_models import db, JobSummary, ProcessorMetrics, ProcessingStatus
from app.routes.processing_attack import get_jobs_processed, get_jobs_processed_by_processor, get_jobs_to_be_marked_complete, get_oldest_job_data, organize_jobs_by_job_type, get_pink_folder_data

# Load environment variables from .env using python-dotenv.
from dotenv import load_dotenv
load_dotenv()

app = create_app()


def get_processing_status_data():
    """
    Retrieve processing status data in the same format as the response from the
    '/processing_attack/complete_jobs' route, print a validation message,
    and update the ProcessingStatus record in the database.
    """
    today = datetime.now(timezone.utc).date()
    week_start = today - timedelta(days=today.weekday())

    # Define end of week: Sunday 11:59:59 PM UTC
    week_end_datetime = datetime.combine(
        week_start + timedelta(days=6),
        time(hour=23, minute=59, second=59),
        tzinfo=timezone.utc
    )

    # Check if a ProcessingStatus record for this week already exists
    record = ProcessingStatus.query.filter_by(week_start=week_start).first()
    if record and record.updated_at:
        updated_at = record.updated_at
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)

        if updated_at > week_end_datetime:
            print(f"ProcessingStatus for week {week_start} was already updated after the week ended. Skipping update.")
            return
        else:
            print(f"ProcessingStatus for week {week_start} exists but is outdated. Overwriting...")

    # Updated naming for clarity
    jobs_to_be_marked_complete, oldest_job_ids, oldest_inspection_job_id = get_jobs_to_be_marked_complete()

    if jobs_to_be_marked_complete and oldest_job_ids:
        first_oldest_job_id = oldest_job_ids[0]  # ✅ This is safe now
        oldest_job_date, oldest_job_address, oldest_job_type = get_oldest_job_data(first_oldest_job_id)

        oldest_inspection_date, oldest_inspection_address, _ = get_oldest_job_data(oldest_inspection_job_id)
    else:
        oldest_job_date, oldest_job_address, oldest_job_type = None, None, None
        oldest_inspection_date, oldest_inspection_address = None, None



    jobs_by_job_type = organize_jobs_by_job_type(jobs_to_be_marked_complete)
    number_of_pink_folder_jobs, _ = get_pink_folder_data()

    status_data = {
        "jobs_to_be_marked_complete": len(jobs_to_be_marked_complete),
        "oldest_job_date": oldest_job_date,
        "oldest_job_address": oldest_job_address,
        "oldest_job_type": oldest_job_type,
        "job_type_count": jobs_by_job_type,
        "number_of_pink_folder_jobs": number_of_pink_folder_jobs,
        "oldest_inspection_date": oldest_inspection_date,
        "oldest_inspection_address": oldest_inspection_address
    }

    # Print validation details to confirm data retrieval
    print("Validation: Successfully grabbed the following processing status data:")
    for key, value in status_data.items():
        print(f"  {key}: {value}")

    now_utc = datetime.now(timezone.utc)

    if record:
        # Update existing record
        record.jobs_to_be_marked_complete = status_data["jobs_to_be_marked_complete"]
        record.oldest_job_date = status_data["oldest_job_date"]
        record.oldest_job_address = status_data["oldest_job_address"]
        record.oldest_job_type = status_data["oldest_job_type"]
        record.job_type_count = status_data["job_type_count"]
        record.number_of_pink_folder_jobs = status_data["number_of_pink_folder_jobs"]
        record.oldest_inspection_date = status_data["oldest_inspection_date"]
        record.oldest_inspection_address = status_data["oldest_inspection_address"]
        record.updated_at = now_utc
    else:
        # Create new record
        record = ProcessingStatus(
            week_start=week_start,
            jobs_to_be_marked_complete=status_data["jobs_to_be_marked_complete"],
            oldest_job_date=status_data["oldest_job_date"],
            oldest_job_address=status_data["oldest_job_address"],
            oldest_job_type=status_data["oldest_job_type"],
            job_type_count=status_data["job_type_count"],
            number_of_pink_folder_jobs=status_data["number_of_pink_folder_jobs"],
            oldest_inspection_date=status_data["oldest_inspection_date"],
            oldest_inspection_address=status_data["oldest_inspection_address"],
            updated_at=now_utc
        )
        db.session.add(record)

    db.session.commit()
    print(f"Database updated successfully for week starting {week_start}.")


def update_job_summary_for_week(week_start_str):
    week_start_date = datetime.strptime(week_start_str, "%Y-%m-%d").date()
    summary = JobSummary.query.filter_by(week_start=week_start_date).first()

    # End of week is Friday 11:59:59 PM UTC
    week_end_datetime = datetime.combine(
        week_start_date + timedelta(days=4),
        time(hour=23, minute=59, second=59),
        tzinfo=timezone.utc
    )

    if summary and summary.updated_at:
        updated_at = summary.updated_at

        # Ensure updated_at is timezone-aware
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)

        if updated_at > week_end_datetime:
            print(f"Entry for week {week_start_str} was already updated after the week ended. Skipping update.")
            return
        else:
            print(f"Entry for week {week_start_str} exists but is outdated. Overwriting...")

    # Gather data and update/create the record
    total_jobs_processed, total_tech_hours_processed, jobs_by_type, hours_by_type = get_jobs_processed(week_start_str)
    now_utc = datetime.now(timezone.utc)

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

def update_processor_metrics_for_week(week_start_str):
    week_start_date = datetime.strptime(week_start_str, "%Y-%m-%d").date()

    # Define end of the week: Friday at 11:59:59 PM UTC
    week_end_datetime = datetime.combine(
        week_start_date + timedelta(days=4),
        time(hour=23, minute=59, second=59),
        tzinfo=timezone.utc
    )

    # Check if any processor metrics already exist for this week
    existing_record = ProcessorMetrics.query.filter_by(week_start=week_start_date).first()

    if existing_record and existing_record.updated_at:
        updated_at = existing_record.updated_at
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)

        if updated_at > week_end_datetime:
            print(f"Processor metrics for week {week_start_str} were updated after the week ended. Skipping update.")
            return
        else:
            print(f"Processor metrics for week {week_start_str} exist but are outdated. Overwriting...")

            # Delete old metrics for that week
            ProcessorMetrics.query.filter_by(week_start=week_start_date).delete()
            db.session.commit()

    # Fetch updated data
    jobs_by_processor, hours_by_processor = get_jobs_processed_by_processor(week_start_str)
    now_utc = datetime.now(timezone.utc)

    # Insert updated records
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
            get_processing_status_data()
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
            
            db.session.commit()



if __name__ == '__main__':
    update_all_metrics()



