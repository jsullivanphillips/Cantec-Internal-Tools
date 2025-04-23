import os
from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

class JobSummary(db.Model):
    __tablename__ = 'job_summary'
    
    id = db.Column(db.Integer, primary_key=True)
    week_start = db.Column(db.Date, unique=True, nullable=False)
    total_jobs_processed = db.Column(db.Integer, default=0)
    total_tech_hours_processed = db.Column(db.Float, default=0.0)
    jobs_by_type = db.Column(db.JSON)  # Stores a JSON object of job counts per type
    hours_by_type = db.Column(db.JSON) # Stores a JSON object of tech hours per type
    updated_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    def __repr__(self):
        return f'<JobSummary {self.week_start}: {self.total_jobs_processed} jobs>'

class ProcessorMetrics(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    week_start = db.Column(db.Date, nullable=False)
    processor_name = db.Column(db.String(255), nullable=False)
    jobs_processed = db.Column(db.Integer, default=0)
    hours_processed = db.Column(db.Float, default=0.0)
    updated_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (db.UniqueConstraint('week_start', 'processor_name', name='unique_week_processor'),)

# New model for capturing the processing status snapshot
class ProcessingStatus(db.Model):
    __tablename__ = 'processing_status'
    
    id = db.Column(db.Integer, primary_key=True)
    week_start = db.Column(db.Date, unique=True, nullable=False)
    jobs_to_be_marked_complete = db.Column(db.Integer, default=0)
    oldest_job_date = db.Column(db.Date, nullable=True)
    oldest_job_address = db.Column(db.String(255), nullable=True)
    oldest_job_type = db.Column(db.String(255), nullable=True)
    job_type_count = db.Column(db.JSON)  # Stores a JSON object of job counts per type
    number_of_pink_folder_jobs = db.Column(db.Integer, default=0)
    oldest_inspection_date = db.Column(db.Date, nullable=True)
    oldest_inspection_address = db.Column(db.String(255), nullable=True)
    updated_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    def __repr__(self):
        return f'<ProcessingStatus {self.week_start}: {self.jobs_to_be_marked_complete} jobs marked complete>'


class SchedulingAttack(db.Model):
    __tablename__ = 'scheduling_attack'

    id = db.Column(db.Integer, primary_key=True)
    month_start = db.Column(db.Date, unique=True, nullable=False)

    # FA job stats
    released_fa_jobs = db.Column(db.Integer, default=0)
    released_fa_tech_hours = db.Column(db.Float, default=0.0)
    scheduled_fa_jobs = db.Column(db.Integer, default=0)
    scheduled_fa_tech_hours = db.Column(db.Float, default=0.0)
    to_be_scheduled_fa_jobs = db.Column(db.Integer, default=0)
    to_be_scheduled_fa_tech_hours = db.Column(db.Float, default=0.0)

    # Sprinkler job stats
    released_sprinkler_jobs = db.Column(db.Integer, default=0)
    released_sprinkler_tech_hours = db.Column(db.Float, default=0.0)
    scheduled_sprinkler_jobs = db.Column(db.Integer, default=0)
    scheduled_sprinkler_tech_hours = db.Column(db.Float, default=0.0)
    to_be_scheduled_sprinkler_jobs = db.Column(db.Integer, default=0)
    to_be_scheduled_sprinkler_tech_hours = db.Column(db.Float, default=0.0)

    # Raw JSON data for deeper inspection
    jobs_to_be_scheduled = db.Column(db.JSON)
    not_counted_fa_locations = db.Column(db.JSON)

    # Timestamps
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc)
    )

    def __repr__(self):
        return f'<SchedulingAttack {self.month_start}>'

if __name__ == '__main__':
    from app import create_app
    app = create_app()

    with app.app_context():
        db.create_all()
        print("Database tables created.")