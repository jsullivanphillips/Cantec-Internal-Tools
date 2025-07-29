
from concurrent.futures import ThreadPoolExecutor, as_completed
import os
from datetime import datetime, timedelta, timezone, time
from pytz import UTC
from app import create_app
from app.db_models import db, JobSummary, ProcessorMetrics, ProcessingStatus
from app.routes.processing_attack import get_jobs_processed, get_jobs_processed_by_processor, get_jobs_to_be_marked_complete, get_oldest_job_data, organize_jobs_by_job_type, get_pink_folder_data
from dotenv import load_dotenv

load_dotenv()
app = create_app()

def get_processing_status_data():
    today = datetime.now(timezone.utc).date()
    week_start = today - timedelta(days=today.weekday())
    week_end_datetime = datetime.combine(week_start + timedelta(days=6), time(23, 59, 59), tzinfo=timezone.utc)

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


    jobs_to_be_marked_complete, oldest_job_ids, oldest_inspection_job_id, _ = get_jobs_to_be_marked_complete()
    if jobs_to_be_marked_complete and oldest_job_ids:
        oldest_job_date, oldest_job_address, oldest_job_type = get_oldest_job_data(oldest_job_ids[0])
        oldest_inspection_date, oldest_inspection_address, _ = get_oldest_job_data(oldest_inspection_job_id)
    else:
        oldest_job_date = oldest_job_address = oldest_job_type = oldest_inspection_date = oldest_inspection_address = None

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

    print("Validation: Successfully grabbed the following processing status data:")
    for key, value in status_data.items():
        print(f"  {key}: {value}")

    now_utc = datetime.now(timezone.utc)
    if record:
        for key, value in status_data.items():
            setattr(record, key, value)
        record.updated_at = now_utc
    else:
        record = ProcessingStatus(week_start=week_start, updated_at=now_utc, **status_data)
        db.session.add(record)

    db.session.commit()
    print(f"Database updated successfully for week starting {week_start}.")

def update_job_summary_for_week(week_start_str):
    week_start_date = datetime.strptime(week_start_str, "%Y-%m-%d").date()
    summary = JobSummary.query.filter_by(week_start=week_start_date).first()
    week_end_datetime = datetime.combine(week_start_date + timedelta(days=4), time(23, 59, 59), tzinfo=timezone.utc)

    if summary and summary.updated_at:
        updated_at = summary.updated_at.replace(tzinfo=timezone.utc) if summary.updated_at.tzinfo is None else summary.updated_at
        if updated_at > week_end_datetime:
            print(f"Entry for week {week_start_str} was already updated after the week ended. Skipping update.")
            return
        else:
            print(f"Entry for week {week_start_str} exists but is outdated. Overwriting...")

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
    week_end_datetime = datetime.combine(week_start_date + timedelta(days=4), time(23, 59, 59), tzinfo=timezone.utc)
    existing_record = ProcessorMetrics.query.filter_by(week_start=week_start_date).first()

    if existing_record and existing_record.updated_at:
        updated_at = existing_record.updated_at.replace(tzinfo=timezone.utc) if existing_record.updated_at.tzinfo is None else existing_record.updated_at
        if updated_at > week_end_datetime:
            print(f"Processor metrics for week {week_start_str} were updated after the week ended. Skipping update.")
            return
        else:
            print(f"Processor metrics for week {week_start_str} exist but are outdated. Overwriting...")
            ProcessorMetrics.query.filter_by(week_start=week_start_date).delete()
            db.session.commit()

    jobs_by_processor, hours_by_processor = get_jobs_processed_by_processor(week_start_str)
    now_utc = datetime.now(timezone.utc)
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

def process_week(week_start_str):
    with app.app_context():
        update_job_summary_for_week(week_start_str)
        update_processor_metrics_for_week(week_start_str)



def print_week(week_start_str):
    with app.app_context():
        jobs_by_processor, hours_by_processor = get_jobs_processed_by_processor(week_start_str)

        print(f"\nSummary for week starting {week_start_str}:\n")
        print("{:<25} {:>10} {:>15}".format("Processor", "Jobs", "Hours Logged"))
        print("-" * 50)

        all_processors = set(jobs_by_processor) | set(hours_by_processor)
        total_jobs = 0
        total_hours = 0.0

        for processor in sorted(all_processors):
            jobs = jobs_by_processor.get(processor, 0)
            hours = hours_by_processor.get(processor, 0.0)
            total_jobs += jobs
            total_hours += hours
            print("{:<25} {:>10} {:>15.2f}".format(processor, jobs, hours))

        print("-" * 50)
        print("{:<25} {:>10} {:>15.2f}".format("TOTAL", total_jobs, total_hours))




def update_all_metrics():
    with app.app_context():
        with app.test_request_context():
            from flask import session
            session['username'] = os.environ.get("PROCESSING_USERNAME")
            session['password'] = os.environ.get("PROCESSING_PASSWORD")

            # Get status summary for the current week
            get_processing_status_data()

            today = datetime.now(timezone.utc).date()
            start_date = today - timedelta(days=365)
            start_date -= timedelta(days=start_date.weekday())  # Align to Monday

            current_date = start_date
            while current_date <= today:
                week_start_str = current_date.strftime("%Y-%m-%d")
                try:
                    process_week(week_start_str)
                except Exception as e:
                    print(f"[ERROR]: Week update failed for {week_start_str}: {e}")
                current_date += timedelta(days=7)


def print_last_weeks_metrics():
    with app.app_context():
        with app.test_request_context():
            from flask import session
            session['username'] = os.environ.get("PROCESSING_USERNAME")
            session['password'] = os.environ.get("PROCESSING_PASSWORD")

            # Get the date for 6 days ago
            last_week = datetime.now(timezone.utc).date() - timedelta(days=6)

            # Align it to the Monday of that week
            last_week_monday = last_week - timedelta(days=last_week.weekday())
            week_start_str = last_week_monday.strftime("%Y-%m-%d")
            print_week(week_start_str)
            



if __name__ == '__main__':
    print_last_weeks_metrics()
    #update_all_metrics()
