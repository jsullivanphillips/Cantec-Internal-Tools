import os
from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.dialects.postgresql import ARRAY
from zoneinfo import ZoneInfo
from sqlalchemy.orm import foreign

db = SQLAlchemy()

def vancouver_now():
    return datetime.now(ZoneInfo("America/Vancouver"))  # for zoneinfo

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
    job_id = db.Column(db.BIGINT)
    job_link = db.Column(db.String(1024))
    is_job_complete = db.Column(db.Boolean, default=False)
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
    location_id = db.Column(db.BIGINT)  
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_on_st = db.Column(db.DateTime)  

    clock_events = db.relationship("ClockEvent", back_populates="job")
    invoice_items = db.relationship('InvoiceItem', back_populates='job')

    def __repr__(self):
        return f"<Job {self.job_id} - {self.customer_name}>"


class ClockEvent(db.Model):
    __tablename__ = 'clock_event'

    id         = db.Column(db.Integer, primary_key=True)
    job_id     = db.Column(db.BIGINT, db.ForeignKey('job.job_id'), nullable=False)
    tech_name  = db.Column(db.String(255), nullable=False)
    hours      = db.Column(db.Float, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    job = db.relationship("Job", back_populates="clock_events")

    def __repr__(self):
        return (
            f"<ClockEvent {self.tech_name} | "
            f"{self.hours}h on job {self.job_id}>"
        )

class Deficiency(db.Model):
    __tablename__ = 'deficiency'

    id                        = db.Column(db.Integer, primary_key=True)
    deficiency_id             = db.Column(db.BIGINT, unique=True, nullable=False)
    description               = db.Column(db.Text)
    status                    = db.Column(db.String(100))
    reported_by               = db.Column(db.String(255))
    service_line              = db.Column(db.String(100))
    job_id                    = db.Column(db.BIGINT, nullable=False)
    location_id               = db.Column(db.BIGINT, nullable=False)
    deficiency_created_on     = db.Column(db.DateTime)
    orphaned                  = db.Column(db.Boolean, default=False)
    has_attachment            = db.Column(db.Boolean, nullable=False, default=False)
    attachment_uploaded_by    = db.Column(db.String(255), nullable=True)   # ← NEW
    created_at                = db.Column(
                                  db.DateTime(timezone=True),
                                  default=lambda: datetime.now(timezone.utc)
                               )

    def __repr__(self):
        return (f"<Deficiency {self.deficiency_id} | Job {self.job_id} "
                f"| Orphaned: {self.orphaned} | Attachment: {self.has_attachment} "
                f"| Uploaded by: {self.attachment_uploaded_by}>")



class Location(db.Model):
    __tablename__ = 'location'

    id = db.Column(db.Integer, primary_key=True)
    location_id = db.Column(db.BIGINT, unique=True, nullable=False)
    street = db.Column(db.String(255))
    status = db.Column(db.String(50))  # "active" or "inactive"
    company_id = db.Column(db.BIGINT)
    company_name = db.Column(db.String(255))
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_on_st = db.Column(db.DateTime(timezone=True))

    def __repr__(self):
        return f"<Location {self.location_id} | {self.status} | {self.company_name}>"


class Quote(db.Model):
    __tablename__ = 'quote'

    id = db.Column(db.Integer, primary_key=True)
    quote_id = db.Column(db.BIGINT, unique=True, nullable=False)
    customer_name = db.Column(db.String(255))
    location_id = db.Column(db.BIGINT)
    location_address = db.Column(db.String(255))
    status = db.Column(db.String(100))
    quote_created_on = db.Column(db.DateTime)
    total_price = db.Column(db.Float)
    quote_request = db.Column(db.String(100))
    owner_id = db.Column(db.BIGINT)
    owner_email = db.Column(db.String(255))
    job_created = db.Column(db.Boolean, default=False)
    job_id = db.Column(db.BIGINT, nullable=True)
    linked_deficiency_id = db.Column(db.BIGINT, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    items = db.relationship('QuoteItem', back_populates='quote')
    job = db.relationship(
        "Job",
        primaryjoin="foreign(Quote.job_id) == Job.job_id",
        backref="quote",
        lazy="joined",
        uselist=False
    )

    def __repr__(self):
        return f"<Quote {self.quote_id} | {self.status} | Job Created: {self.job_created}>"


class QuoteItem(db.Model):
    __tablename__ = 'quote_item'

    id             = db.Column(db.Integer, primary_key=True)
    quote_id       = db.Column(db.BigInteger, db.ForeignKey('quote.quote_id'), nullable=False)
    service_trade_id = db.Column(db.String(100), nullable=True)   # original ST line-item ID
    description    = db.Column(db.String(255))
    item_type      = db.Column(db.Enum('fa_labour', 'spr_labour', 'part', name='quote_item_type'), nullable=False)
    quantity       = db.Column(db.Float, default=1.0)
    unit_price     = db.Column(db.Float, nullable=False)
    total_price    = db.Column(db.Float, nullable=False)

    quote = db.relationship('Quote', back_populates='items')

class InvoiceItem(db.Model):
    __tablename__ = 'invoice_item'

    id              = db.Column(db.Integer, primary_key=True)
    invoice_id      = db.Column(db.BigInteger, nullable=False)  # or FK if you store invoices
    job_id          = db.Column(db.BigInteger, db.ForeignKey('job.job_id'), nullable=False)
    service_trade_id = db.Column(db.String(100), nullable=True)
    description     = db.Column(db.String(255))
    item_type       = db.Column(db.Enum('fa_labour', 'spr_labour', 'part', name='invoice_item_type'), nullable=False)
    quantity        = db.Column(db.Float, default=1.0)
    unit_price      = db.Column(db.Float, nullable=False)
    total_price     = db.Column(db.Float, nullable=False)

    job = db.relationship('Job', back_populates='invoice_items')

class MeetingMinute(db.Model):
    __tablename__ = 'meeting_minute'

    id = db.Column(db.Integer, primary_key=True)
    week_of = db.Column(db.Date, nullable=False)
    content = db.Column(db.Text, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), default=vancouver_now, onupdate=vancouver_now)
    modified_by = db.Column(db.String(100), nullable=True)
    version = db.Column(db.Integer, default=1)

if __name__ == '__main__':
    from app import create_app
    app = create_app()

    with app.app_context():
        db.create_all()
        print("Database tables created.")