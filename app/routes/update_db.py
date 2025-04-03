from flask import Blueprint, jsonify, request, current_app
from datetime import datetime, timedelta, timezone
from app.models import db, JobSummary
from app.routes.processing_attack import get_jobs_processed  # Adjust the import based on your project structure

update_db_bp = Blueprint('update_db', __name__)

@update_db_bp.route('/update_db', methods=['POST'])
def update_db():
    # Check if the incoming request is JSON; if not, return a 415 error.
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 415

    data = request.get_json() or {}
    selected_monday = data.get('selectedMonday')
    
    # If not provided, default to last week's Monday.
    if not selected_monday:
        today = datetime.now(timezone.utc).date()
        selected_monday = (today - timedelta(days=today.weekday() + 7)).strftime("%Y-%m-%d")
    
    print(selected_monday)
    # Retrieve processed data using your existing function.
    total_jobs_processed, total_tech_hours_processed, jobs_by_type, hours_by_type = get_jobs_processed(selected_monday)
    
    # Convert the selected Monday string to a date object.
    week_start_date = datetime.strptime(selected_monday, "%Y-%m-%d").date()
    
    # Check if a record for this week already exists.
    summary = JobSummary.query.filter_by(week_start=week_start_date).first()
    now_utc = datetime.now(timezone.utc)
    if summary:
        # Update existing record.
        summary.total_jobs_processed = total_jobs_processed
        summary.total_tech_hours_processed = total_tech_hours_processed
        summary.jobs_by_type = jobs_by_type
        summary.hours_by_type = hours_by_type
        summary.updated_at = now_utc
    else:
        # Create a new record.
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

    return jsonify({
        "message": f"Database updated for week starting {selected_monday}",
        "data": {
            "total_jobs_processed": total_jobs_processed,
            "total_tech_hours_processed": total_tech_hours_processed
        }
    })

@update_db_bp.route('/view_db', methods=['GET'])
def view_db():
    # Query all records from JobSummary.
    summaries = JobSummary.query.all()
    # Format the records into a list of dictionaries.
    results = []
    for summary in summaries:
        results.append({
            'id': summary.id,
            'week_start': summary.week_start.isoformat(),
            'total_jobs_processed': summary.total_jobs_processed,
            'total_tech_hours_processed': summary.total_tech_hours_processed,
            'jobs_by_type': summary.jobs_by_type,
            'hours_by_type': summary.hours_by_type,
            'updated_at': summary.updated_at.isoformat() if summary.updated_at else None
        })
    return jsonify(results)

