import os
from datetime import datetime, timezone
from enum import Enum
from flask_sqlalchemy import SQLAlchemy
from zoneinfo import ZoneInfo
from sqlalchemy import (
    UniqueConstraint, CheckConstraint, Index, func
)
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.dialects.postgresql import ENUM as PGEnum, BIGINT, NUMERIC

db = SQLAlchemy()

def vancouver_now():
    return datetime.now(ZoneInfo("America/Vancouver"))  # for zoneinfo

# --------- ENUMS (native Postgres enums) ---------
class ServiceType(str, Enum):
    ANNUAL = "ANNUAL"
    PM = "PM"
    PLANNED_MAINT = "PLANNED_MAINT"
    NON_RECURRING = "NON_RECURRING"

class SourceKind(str, Enum):
    HISTORICAL_JOB = "HISTORICAL_JOB"
    SCHEDULED_JOB = "SCHEDULED_JOB"
    LOCATION_TAG = "LOCATION_TAG"

service_type_enum = PGEnum(
    ServiceType, name="service_type_enum", create_type=True
)
source_kind_enum = PGEnum(
    SourceKind, name="source_kind_enum", create_type=True
)

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


class JobItemTechnician(db.Model):
    __tablename__ = 'job_item_technician'

    job_item_id = db.Column(db.BIGINT, primary_key=True)  # ServiceTrade Job Item ID
    user_name = db.Column(db.String(255), default="Unknown User")
    is_tech = db.Column(db.Boolean, default=False)
    avatar_url = db.Column(db.String(1024))
    job_item_name = db.Column(db.String(255), default="Unknown Job Item")
    quantity = db.Column(db.Integer, default=0)
    cost = db.Column(db.Float, default=0.0)
    related_job_id = db.Column(db.BIGINT, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True))
    updated_at = db.Column(db.DateTime(timezone=True))
    created_on_st = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint('job_item_id', name='uq_job_item_id'),
    )

    def __repr__(self):
        return f"<JobItemTechnician {self.job_item_id} - {self.user_name} - {self.job_item_name}>"


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


class ServiceRecurrence(db.Model):
    __tablename__ = 'service_recurrence'
    __table_args__ = (
        # Allow multiple recurrences per location; keep some data hygiene checks.
        db.CheckConstraint('month IS NULL OR (month BETWEEN 1 AND 12)', name='ck_sr_month_1_12'),
        db.CheckConstraint('interval IS NULL OR interval > 0', name='ck_sr_interval_pos'),
        db.Index('ix_sr_location_service', 'location_id', 'service_id'),
        db.Index('ix_sr_location_month', 'location_id', 'month'),
        # st_recurrence_id already has unique=True below; keeping index for fast upserts
        db.Index('ix_sr_st_recurrence_id', 'st_recurrence_id'),
    )

    id = db.Column(db.Integer, primary_key=True)

    # === Identity / linkage ===
    st_recurrence_id = db.Column(db.BIGINT, unique=True, nullable=False, index=True)
    location_id = db.Column(
        db.BIGINT,
        db.ForeignKey('location.location_id'),
        index=True,
        nullable=False,
    )
    service_id = db.Column(db.BIGINT)                 # distinguishes fire alarm vs sprinkler
    service_name = db.Column(db.String(255))          # e.g., "Annual Fire Alarm Inspection"

    # === Recurrence definition from ServiceTrade ===
    frequency = db.Column(db.String(50))              # expect "yearly"
    interval = db.Column(db.SmallInteger)             # expect 1
    first_start = db.Column(db.DateTime(timezone=True))
    first_end   = db.Column(db.DateTime(timezone=True))
    month = db.Column(db.SmallInteger, index=True)    # 1–12, derived from first_start
    updated_on_st = db.Column(db.DateTime(timezone=True), index=True)

    # === Forecasting inputs ===
    est_on_site_hours = db.Column(db.Float)
    travel_minutes = db.Column(db.Integer)
    travel_minutes_is_roundtrip = db.Column(db.Boolean, default=False)

    # === BI provenance ===
    hours_basis = db.Column(db.String(20))            # 'derived', 'manual', 'default'
    basis_job_id = db.Column(db.BIGINT)
    basis_inspection_date = db.Column(db.DateTime(timezone=True))
    basis_clock_events_hours = db.Column(db.Float)
    basis_sample_size = db.Column(db.SmallInteger)

    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    @hybrid_property
    def est_total_hours(self):
        t_hours = (self.travel_minutes or 0) / 60.0
        if self.travel_minutes_is_roundtrip:
            pass
        return (self.est_on_site_hours or 0.0) + t_hours




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


# ========= DIMENSIONS =========

class DimDate(db.Model):
    """
    One row per calendar date. Use `id` as a surrogate key everywhere.
    """
    __tablename__ = "dim_date"

    id = db.Column(db.Integer, primary_key=True)            # surrogate key
    d = db.Column(db.Date, nullable=False, unique=True)     # actual date

    # Helpful breakdowns for grouping/filters
    day = db.Column(db.SmallInteger, nullable=False)
    month = db.Column(db.SmallInteger, nullable=False)
    year = db.Column(db.SmallInteger, nullable=False)
    quarter = db.Column(db.SmallInteger, nullable=False)

    # Month helpers
    month_start = db.Column(db.Date, nullable=False)        # first day of that month
    month_name = db.Column(db.String(12), nullable=False)

    # Optional helpers
    week_of_year = db.Column(db.SmallInteger, nullable=True)
    is_month_start = db.Column(db.Boolean, nullable=False, default=False)
    is_month_end = db.Column(db.Boolean, nullable=False, default=False)

    __table_args__ = (
        Index("ix_dim_date_month_start", month_start),
    )

    def __repr__(self):
        return f"<DimDate {self.d.isoformat()}>"

class DimService(db.Model):
    """
    Service descriptor (type + line). Keep it small, reference by id.
    """
    __tablename__ = "dim_service"

    id = db.Column(db.Integer, primary_key=True)
    service_type = db.Column(service_type_enum, nullable=False)
    service_line = db.Column(db.String(100), nullable=True)  # e.g., 'Fire Alarm', 'Sprinkler'
    is_recurring = db.Column(db.Boolean, nullable=False, default=True)
    description = db.Column(db.String(255), nullable=True)

    __table_args__ = (
        UniqueConstraint("service_type", "service_line",
                         name="uq_dim_service_type_line"),
        Index("ix_dim_service_type", "service_type"),
        Index("ix_dim_service_is_recurring", "is_recurring"),
    )

    def __repr__(self):
        return f"<DimService {self.service_type} | {self.service_line}>"

class DimSource(db.Model):
    """
    Where the 'evidence' came from (historical job, scheduled job, tag).
    Priority lets you pick the best source when rolling up.
    """
    __tablename__ = "dim_source"

    id = db.Column(db.Integer, primary_key=True)
    source_kind = db.Column(source_kind_enum, nullable=False, unique=True)
    priority = db.Column(db.SmallInteger, nullable=False, default=100)  # higher = stronger

    def __repr__(self):
        return f"<DimSource {self.source_kind} p={self.priority}>"

# ========= FACTS =========

class FactServiceEvent(db.Model):
    """
    Atomic events: a completed job, a scheduled job, or a tag-derived estimate.
    Grain: location × service × (event date) × source × (optional job)
    """
    __tablename__ = "fact_service_event"

    id = db.Column(db.BigInteger, primary_key=True)  # bigserial
    location_pk = db.Column(db.Integer, db.ForeignKey("location.id"), nullable=False)
    service_id = db.Column(db.Integer, db.ForeignKey("dim_service.id"), nullable=False)
    date_id = db.Column(db.Integer, db.ForeignKey("dim_date.id"), nullable=False)
    source_id = db.Column(db.Integer, db.ForeignKey("dim_source.id"), nullable=False)

    # Optional job linkage (ServiceTrade or internal)
    job_id = db.Column(BIGINT, nullable=True, index=True)

    # Timestamps (tz-aware)
    completed_on = db.Column(db.DateTime(timezone=True), nullable=True)
    scheduled_for = db.Column(db.DateTime(timezone=True), nullable=True)

    # Measured/estimated effort (hours)
    hours_actual = db.Column(NUMERIC(10, 2), nullable=True)
    hours_booked = db.Column(NUMERIC(10, 2), nullable=True)
    hours_estimated = db.Column(NUMERIC(10, 2), nullable=True)

    # Operational flags
    tech_count = db.Column(db.SmallInteger, nullable=True)
    multi_day = db.Column(db.Boolean, nullable=True)
    multi_tech_required = db.Column(db.Boolean, nullable=True)

    # Audit
    ingested_at = db.Column(db.DateTime(timezone=True), nullable=False,
                            default=lambda: datetime.now(timezone.utc))

    # Relationships
    location = db.relationship("Location", lazy="joined")
    service = db.relationship("DimService", lazy="joined")
    event_date = db.relationship("DimDate", lazy="joined")
    source = db.relationship("DimSource", lazy="joined")

    __table_args__ = (
        # Non-negative hours (any present must be >= 0)
        CheckConstraint(
            "(hours_actual IS NULL OR hours_actual >= 0) AND "
            "(hours_booked IS NULL OR hours_booked >= 0) AND "
            "(hours_estimated IS NULL OR hours_estimated >= 0)",
            name="ck_fse_nonnegative_hours"
        ),
        Index("ix_fse_loc_serv_date", "location_pk", "service_id", "date_id"),
        Index("ix_fse_date", "date_id"),
        Index("ix_fse_source", "source_id"),
    )

    def __repr__(self):
        return f"<FactServiceEvent loc={self.location_pk} svc={self.service_id} date_id={self.date_id}>"

class FactMonthlyServiceNeed(db.Model):
    """
    Monthly roll-up: one row per (month × location × service).
    Populated by an ETL/materialization that prefers actual > booked > estimated.
    """
    __tablename__ = "fact_monthly_service_need"

    id = db.Column(db.BigInteger, primary_key=True)  # bigserial
    month_id = db.Column(db.Integer, db.ForeignKey("dim_date.id"), nullable=False)  # points to month_start row
    location_pk = db.Column(db.Integer, db.ForeignKey("location.id"), nullable=False)
    service_id = db.Column(db.Integer, db.ForeignKey("dim_service.id"), nullable=False)

    # The chosen monthly figure
    hours_needed = db.Column(NUMERIC(10, 2), nullable=False, default=0)
    is_booked = db.Column(db.Boolean, nullable=False, default=False)
    evidence_level = db.Column(db.SmallInteger, nullable=True)  # e.g., 100 actual > 80 scheduled > 50 tag
    events_count = db.Column(db.Integer, nullable=False, default=0)

    last_computed_at = db.Column(db.DateTime(timezone=True), nullable=False,
                                 default=lambda: datetime.now(timezone.utc))

    # Relationships
    month = db.relationship("DimDate", lazy="joined")
    location = db.relationship("Location", lazy="joined")
    service = db.relationship("DimService", lazy="joined")

    __table_args__ = (
        UniqueConstraint("month_id", "location_pk", "service_id",
                         name="uq_fmsn_month_loc_service"),
        Index("ix_fmsn_month", "month_id"),
        Index("ix_fmsn_loc", "location_pk"),
        Index("ix_fmsn_service", "service_id"),
    )

    def __repr__(self):
        return f"<FMSN month_id={self.month_id} loc={self.location_pk} svc={self.service_id}>"

