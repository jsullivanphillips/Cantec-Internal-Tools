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

class DeficiencyRecord(db.Model):
    __tablename__ = 'deficiency_record'

    id = db.Column(db.Integer, primary_key=True)
    deficiency_id = db.Column(db.String(100), unique=True, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    status = db.Column(db.String(50))
    reported_on = db.Column(db.DateTime(timezone=True))
    address = db.Column(db.String(255))
    location_name = db.Column(db.String(255))
    is_monthly_access = db.Column(db.Boolean, default=False)
    description = db.Column(db.Text)
    proposed_solution = db.Column(db.Text)
    company = db.Column(db.String(255))
    tech_name = db.Column(db.String(255))
    tech_image_link = db.Column(db.String(1024))
    job_link = db.Column(db.String(1024))
    service_line_name = db.Column(db.String(255))
    service_line_icon_link = db.Column(db.String(1024))
    severity = db.Column(db.String(50))
    is_archived = db.Column(db.Boolean, default=False, index=True)  
    is_quote_sent = db.Column(db.Boolean, default=False, nullable=False)
    is_quote_approved = db.Column(db.Boolean, default=False, nullable=False)
    is_quote_in_draft = db.Column(db.Boolean, default=False, nullable=False)
    hidden = db.Column(db.Boolean, default=False)
    quote_expiry = db.Column(db.DateTime(timezone=True))


    def __repr__(self):
        return f"<DeficiencyRecord {self.deficiency_id}>"

    @classmethod
    def active(cls):
        return cls.query.filter_by(is_archived=False)

    @classmethod
    def archived(cls):
        return cls.query.filter_by(is_archived=True)


class Job(db.Model):
    __tablename__ = 'job'

    job_id = db.Column(db.BIGINT, primary_key=True)
    job_type = db.Column(db.String(255))
    address = db.Column(db.String(255))
    customer_name = db.Column(db.String(255))
    job_status = db.Column(db.String(255))
    scheduled_date = db.Column(db.DateTime)
    completed_on = db.Column(db.DateTime)
    revenue = db.Column(db.Float)
    total_on_site_hours = db.Column(db.Float)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    clock_events = db.relationship("ClockEvent", back_populates="job")

    def __repr__(self):
        return f"<Job {self.job_id} - {self.customer_name}>"

class ClockEvent(db.Model):
    __tablename__ = 'clock_event'

    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.BIGINT, db.ForeignKey('job.job_id'), nullable=False)
    tech_name = db.Column(db.String(255))
    hours = db.Column(db.Float)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    job = db.relationship("Job", back_populates="clock_events")

    def __repr__(self):
        return f"<ClockEvent {self.tech_name} - {self.hours}h on job {self.job_id}>"

class Deficiency(db.Model):
    __tablename__ = 'deficiency'

    id = db.Column(db.Integer, primary_key=True)
    deficiency_id = db.Column(db.BIGINT, unique=True, nullable=False)
    description = db.Column(db.Text)
    status = db.Column(db.String(100))
    reported_by = db.Column(db.String(255))
    service_line = db.Column(db.String(100))
    job_id = db.Column(db.BIGINT, nullable=False)
    location_id = db.Column(db.BIGINT, nullable=False)
    deficiency_created_on = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    orphaned = db.Column(db.Boolean, default=False)

    def __repr__(self):
        return f"<Deficiency {self.deficiency_id} | Job {self.job_id} | Orphaned: {self.orphaned}>"


if __name__ == '__main__':
    from app import create_app
    app = create_app()

    with app.app_context():
        db.create_all()
        print("Database tables created.")