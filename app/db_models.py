from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy
from zoneinfo import ZoneInfo
from sqlalchemy.orm import relationship
from sqlalchemy import (
    UniqueConstraint,
    Index,
    ForeignKey
)
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.dialects.postgresql import JSONB


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

    # Snapshot values captured by update_processing_data.py
    # (Monday 1:00pm local week, based on America/Vancouver).
    jobs_to_be_invoiced = db.Column(db.Integer, default=0)
    jobs_to_be_converted = db.Column(db.Integer, default=0)  # report_conversion locations/jobs count
    earliest_job_to_be_converted_date = db.Column(db.Date, nullable=True)
    earliest_job_to_be_converted_address = db.Column(db.String(255), nullable=True)
    earliest_job_to_be_converted_job_id = db.Column(db.BIGINT, nullable=True)

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


class ProcessingStatusDaily(db.Model):
    """Weekday (Mon–Fri) snapshots of the same KPI fields as ProcessingStatus."""

    __tablename__ = "processing_status_daily"

    id = db.Column(db.Integer, primary_key=True)
    snapshot_date = db.Column(db.Date, unique=True, nullable=False)
    jobs_processed_today = db.Column(db.Integer, nullable=True)
    jobs_to_be_marked_complete = db.Column(db.Integer, default=0)
    jobs_to_be_invoiced = db.Column(db.Integer, default=0)
    jobs_to_be_converted = db.Column(db.Integer, default=0)
    earliest_job_to_be_converted_date = db.Column(db.Date, nullable=True)
    earliest_job_to_be_converted_address = db.Column(db.String(255), nullable=True)
    earliest_job_to_be_converted_job_id = db.Column(db.BIGINT, nullable=True)
    oldest_job_date = db.Column(db.Date, nullable=True)
    oldest_job_address = db.Column(db.String(255), nullable=True)
    oldest_job_type = db.Column(db.String(255), nullable=True)
    job_type_count = db.Column(db.JSON)
    number_of_pink_folder_jobs = db.Column(db.Integer, default=0)
    oldest_inspection_date = db.Column(db.Date, nullable=True)
    oldest_inspection_address = db.Column(db.String(255), nullable=True)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    def __repr__(self):
        return f"<ProcessingStatusDaily {self.snapshot_date}: {self.jobs_to_be_marked_complete} jobs>"


class ProcessingStatusIntraday(db.Model):
    """Intraday Vancouver-time snapshots for the Jobs To Be Marked Complete KPI."""

    __tablename__ = "processing_status_intraday"
    __table_args__ = (
        db.Index(
            "ix_processing_status_intraday_snapshot_date_captured_at",
            "snapshot_date",
            "captured_at",
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    snapshot_date = db.Column(db.Date, nullable=False, index=True)
    captured_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )
    jobs_to_be_marked_complete = db.Column(db.Integer, nullable=False, default=0)

    def __repr__(self):
        return (
            f"<ProcessingStatusIntraday {self.snapshot_date} "
            f"{self.captured_at}: {self.jobs_to_be_marked_complete} jobs>"
        )


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
    first_scheduled_at = db.Column(db.DateTime(timezone=True), nullable=True)
    completed_on = db.Column(db.DateTime)
    revenue = db.Column(db.Float)
    total_on_site_hours = db.Column(db.Float)
    location_id = db.Column(db.BIGINT)  
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_on_st = db.Column(db.DateTime)
    created_by_name = db.Column(db.String(255), nullable=True)

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


class DeficiencyNonQuoteablePhrase(db.Model):
    __tablename__ = "deficiency_non_quoteable_phrase"
    __table_args__ = (
        db.UniqueConstraint("phrase", name="uq_deficiency_non_quoteable_phrase"),
    )

    id = db.Column(db.Integer, primary_key=True)
    phrase = db.Column(db.String(255), nullable=False)
    label = db.Column(db.String(255), nullable=True)
    active = db.Column(db.Boolean, nullable=False, default=True)
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=vancouver_now, nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=vancouver_now,
        onupdate=vancouver_now,
        nullable=False,
    )

    def __repr__(self):
        return f"<DeficiencyNonQuoteablePhrase {self.phrase!r} active={self.active}>"


class DeficiencyServiceEligibility(db.Model):
    __tablename__ = "deficiency_service_eligibility"

    deficiency_id = db.Column(
        db.BIGINT,
        db.ForeignKey("deficiency.deficiency_id", ondelete="CASCADE"),
        primary_key=True,
    )
    eligible = db.Column(db.Boolean, nullable=False, default=True)
    reason = db.Column(db.String(32), nullable=False, default="eligible")
    detail = db.Column(db.String(512), nullable=True)
    description_hash = db.Column(db.String(64), nullable=True)
    included_override = db.Column(db.Boolean, nullable=False, default=False)
    classified_at = db.Column(db.DateTime(timezone=True), default=vancouver_now, nullable=False)

    deficiency = db.relationship("Deficiency", backref=db.backref("service_eligibility", uselist=False))

    def __repr__(self):
        return (
            f"<DeficiencyServiceEligibility {self.deficiency_id} "
            f"eligible={self.eligible} reason={self.reason}>"
        )


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

class QuoteDeficiencyLink(db.Model):
    __tablename__ = "quote_deficiency_link"

    id = db.Column(db.Integer, primary_key=True)
    quote_id = db.Column(db.BIGINT, db.ForeignKey("quote.quote_id"), nullable=False)
    deficiency_id = db.Column(db.BIGINT, db.ForeignKey("deficiency.deficiency_id"), nullable=False)


class Quote(db.Model):
    __tablename__ = 'quote'

    id = db.Column(db.Integer, primary_key=True)
    quote_id = db.Column(db.BIGINT, unique=True, nullable=False)
    customer_name = db.Column(db.String(255))
    location_id = db.Column(db.BIGINT)
    location_address = db.Column(db.String(255))
    status = db.Column(db.String(100))
    quote_created_on = db.Column(db.DateTime)
    items = db.relationship('QuoteItem', back_populates='quote')
    total_price = db.Column(db.Float)
    quote_request = db.Column(db.String(100))
    owner_id = db.Column(db.BIGINT)
    owner_email = db.Column(db.String(255))
    job_created = db.Column(db.Boolean, default=False)
    job_id = db.Column(db.BIGINT, nullable=True)
    quote_accepted_on = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


    # NEW RELATION
    deficiencies = db.relationship(
        "Deficiency",
        secondary="quote_deficiency_link",
        backref="quotes"
    )


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

class ServiceOccurrence(db.Model):
    __tablename__ = "service_occurrence"
    __table_args__ = (
        # fast lookups by month and location
        db.Index("ix_so_month", "observed_month"),
        db.Index("ix_so_location_month", "location_id", "observed_month"),
        # enforce one row per job
        db.UniqueConstraint("job_id", name="uq_so_job"),
    )

    id = db.Column(db.Integer, primary_key=True)

    # Identity / linkage
    job_id        = db.Column(db.BigInteger, nullable=False)                 # ST job id (row is keyed by this)
    location_id   = db.Column(db.BigInteger, db.ForeignKey("location.location_id"),
                              index=True, nullable=False)

    # Helpful labels from ST
    job_type      = db.Column(db.String(255))                                # inspection / planned_maintenance / preventive_maintenance / service

    # Lifecycle (all tz-aware; store UTC)
    job_created_at = db.Column(db.DateTime(timezone=True))                   # when job was created in ST
    scheduled_for  = db.Column(db.DateTime(timezone=True))                   # when first appt was scheduled (start)
    completed_at   = db.Column(db.DateTime(timezone=True))                   # when job completed

    # Month attribution for forecasting/rollups (first day of month)
    observed_month = db.Column(db.Date, nullable=False)                      # e.g., date(2025, 8, 1)

    # Classification
    is_recurring   = db.Column(db.Boolean, nullable=False, default=False)    # True for annual/PM/planned

    # Hours (split by line so you can separate FA vs Spr work recorded on same job)
    spr_hours_actual  = db.Column(db.Numeric(8, 2))
    fa_hours_actual   = db.Column(db.Numeric(8, 2))

    # Scheduling Meta
    number_of_fa_days    = db.Column(db.Integer, nullable=False, default=1)         # how many days the job spanned
    number_of_spr_days    = db.Column(db.Integer, nullable=False, default=1)         # how many days the job spanned
    number_of_fa_techs = db.Column(db.Integer, nullable=False, default=0)        # count of FA techs that worked on it
    number_of_spr_techs = db.Column(db.Integer, nullable=False, default=0)       # count of Sprinkler techs that worked on it

    # Travel time derived from location tags (store both per-appt default and what you applied)
    travel_minutes_per_appt   = db.Column(db.Integer)                        # default from tags
    travel_minutes_total      = db.Column(db.Integer)                        # per-appt * tech-on-appt (or summed)

    # Status snapshot (optional but useful to query quickly)
    status = db.Column(db.String(32), nullable=False, default="created")     # 'created' | 'scheduled' | 'completed' | 'cancelled'
    is_confirmed = db.Column(db.Boolean, nullable=False, default=False)        # location confirmed job

    # location on hold?
    location_on_hold = db.Column(db.Boolean, nullable=False, default=False)

    # Provenance / extras
    source    = db.Column(db.String(64), nullable=False, default="servicetrade")
    tags_json = db.Column(db.JSON)                                           # raw tags if you want to stash them
    meta      = db.Column(db.JSON)                                           # any other diagnostics

    # Audit (row bookkeeping; separate from ST job creation time)
    row_inserted_at = db.Column(db.DateTime(timezone=True),
                                server_default=db.func.now(), nullable=False)
    row_updated_at  = db.Column(db.DateTime(timezone=True),
                                server_default=db.func.now(),
                                onupdate=db.func.now(), nullable=False)

    def __repr__(self):
        return f"<ServiceOccurrence job={self.job_id} loc={self.location_id} month={self.observed_month}>"
    
class BackflowAutomationMetric(db.Model):
    __tablename__ = "metric"

    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(100), unique=True, nullable=False)
    value = db.Column(db.Integer, default=0, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self):
        return f"<Metric {self.key}={self.value}>"


# models/technician.py
class Technician(db.Model):
    __tablename__ = 'technician'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), unique=True, nullable=False)
    type = db.Column(db.String(100), nullable=True)  # e.g., 'Senior Tech', 'Mid-Level Tech'
    active = db.Column(db.Boolean, default=True)
    updated_on_st = db.Column(db.DateTime(timezone=True))

    def __repr__(self):
        return f"<Technician {self.name} | {self.type or 'Unassigned'}>"


class MonthlyRoute(db.Model):
    """
    One calendar route (e.g. Excel route number 7 = first Wednesday).
    ``weekday_iso`` matches ``datetime.weekday()`` (Monday=0 .. Sunday=6).
    ``week_occurrence`` is 1-based (1 = first such weekday in the month).

    ``service_trade_route_location_id`` is the ServiceTrade *route* location used
    for clock-ins / jobs aggregated for specialists — not a real street address.
    """

    __tablename__ = "monthly_route"
    __table_args__ = (
        db.UniqueConstraint("route_number", name="uq_monthly_route_route_number"),
        db.Index("ix_monthly_route_weekday_occurrence", "weekday_iso", "week_occurrence"),
    )

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    route_number = db.Column(db.Integer, nullable=False)
    #: Optional human-readable label (e.g. internal subset name); not used for routing logic.
    display_name = db.Column(db.String(255), nullable=True)
    weekday_iso = db.Column(db.SmallInteger, nullable=False)
    week_occurrence = db.Column(db.SmallInteger, nullable=False)

    service_trade_route_location_id = db.Column(
        db.BigInteger,
        nullable=True,
        unique=True,
        index=True,
    )
    #: Office note shown to technicians on the portal worksheet header (route-level).
    technician_note = db.Column(db.Text, nullable=True)
    #: Office override for expense breakdown tech count (null = default 2).
    tech_count = db.Column(db.SmallInteger, nullable=True)

    created_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        nullable=False,
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        onupdate=db.func.now(),
        nullable=False,
    )

    locations = db.relationship(
        "MonthlyLocation",
        back_populates="monthly_route",
        foreign_keys="MonthlyLocation.monthly_route_id",
    )
    route_comments = db.relationship(
        "MonthlyRouteComment",
        back_populates="monthly_route",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )
    specialist_months = db.relationship(
        "MonthlyRouteSpecialistMonth",
        back_populates="monthly_route",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )
    run_timing_months = db.relationship(
        "MonthlyRouteRunTimingMonth",
        back_populates="monthly_route",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )
    runs = db.relationship(
        "MonthlyRouteRun",
        back_populates="monthly_route",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )
    calculated_paths = db.relationship(
        "MonthlyRouteCalculatedPath",
        back_populates="monthly_route",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )

    def __repr__(self):
        return f"<MonthlyRoute R{self.route_number}>"


class MonthlyRouteCalculatedPath(db.Model):
    """Cached current Mapbox Directions geometry for a monthly route's ordered stops."""

    __tablename__ = "monthly_route_calculated_path"
    __table_args__ = (
        db.UniqueConstraint(
            "monthly_route_id",
            "profile",
            name="uq_monthly_route_calculated_path_route_profile",
        ),
        db.Index(
            "ix_monthly_route_calculated_path_route_profile",
            "monthly_route_id",
            "profile",
        ),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    monthly_route_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_route.id", ondelete="CASCADE"),
        nullable=False,
    )
    profile = db.Column(db.String(32), nullable=False, server_default="driving")
    provider = db.Column(db.String(32), nullable=False, server_default="mapbox")
    stop_signature = db.Column(db.String(64), nullable=False)
    geometry_geojson = db.Column(db.JSON, nullable=False)
    distance_meters = db.Column(db.Float, nullable=True)
    duration_seconds = db.Column(db.Float, nullable=True)
    waypoint_count = db.Column(db.Integer, nullable=False)
    provider_response_summary = db.Column(db.JSON, nullable=True)
    calculated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        nullable=False,
    )
    created_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        nullable=False,
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        onupdate=db.func.now(),
        nullable=False,
    )

    monthly_route = db.relationship("MonthlyRoute", back_populates="calculated_paths")


class MonthlyRouteRun(db.Model):
    """
    One execution of a monthly route in a calendar month — the "run file."

    A Run groups together every ``MonthlyRouteTestHistory`` row for a
    ``(monthly_route_id, month_date)`` pair, plus a status / timestamps so the
    office can later see when the techs started, when it was completed, and
    which surface created it (``technician_app``, ``csv_import``, ``office_manual``).
    """

    __tablename__ = "monthly_route_run"
    __table_args__ = (
        db.UniqueConstraint(
            "monthly_route_id",
            "month_date",
            name="uq_monthly_route_run_route_month",
        ),
        db.Index("ix_monthly_route_run_month_date", "month_date"),
    )

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    monthly_route_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_route.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    month_date = db.Column(db.Date, nullable=False)
    #: First time the run file / worksheet rows existed (staff open, CSV import, etc.).
    opened_at = db.Column(db.DateTime(timezone=True), nullable=True)
    #: Field technicians explicitly started the run (portal ``POST …/runs``); not auto-set on browse.
    started_at = db.Column(db.DateTime(timezone=True), nullable=True)
    #: Office released the route-month for field work (``POST …/runs/prepare``).
    prepared_at = db.Column(db.DateTime(timezone=True), nullable=True)
    prepared_by = db.Column(db.String(128), nullable=True)
    #: Field technicians ended active testing (portal ``POST …/runs/end``).
    field_ended_at = db.Column(db.DateTime(timezone=True), nullable=True)
    #: Office finished review checklist (``POST …/runs/review_complete``).
    office_review_completed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    office_review_completed_by = db.Column(db.String(128), nullable=True)
    #: Run marked completed (office ``POST …/runs/complete``).
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    #: Office prep note shown to technicians on the route hub before/during the run.
    pre_run_message = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(16), nullable=False, server_default="open")
    source = db.Column(db.String(32), nullable=False, server_default="technician_app")
    created_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        nullable=False,
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        onupdate=db.func.now(),
        nullable=False,
    )

    monthly_route = db.relationship("MonthlyRoute", back_populates="runs")
    location_month_rows = db.relationship(
        "MonthlyLocationMonth",
        back_populates="run",
        foreign_keys="MonthlyLocationMonth.run_id",
    )

    def __repr__(self):
        return f"<MonthlyRouteRun route={self.monthly_route_id} month={self.month_date}>"


class MonthlyRouteSpecialistMonth(db.Model):
    """
    Cached top technicians per calendar month (Pacific) for a monthly route,
    from completed ServiceTrade jobs at the route pseudo-location.
    """

    __tablename__ = "monthly_route_specialist_month"
    __table_args__ = (
        db.UniqueConstraint(
            "monthly_route_id",
            "month_first",
            name="uq_monthly_route_specialist_month_route_month",
        ),
        db.Index(
            "ix_monthly_route_specialist_month_route_month_first",
            "monthly_route_id",
            "month_first",
        ),
    )

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    monthly_route_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_route.id", ondelete="CASCADE"),
        nullable=False,
    )
    month_first = db.Column(db.Date, nullable=False)
    top_technicians = db.Column(JSONB, nullable=False)
    completed_jobs_attributed = db.Column(db.Integer, nullable=False)
    #: Latest Pacific calendar day among attributed jobs (appointment window / completion).
    route_tested_on = db.Column(db.Date, nullable=True)

    last_updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        onupdate=db.func.now(),
        nullable=False,
    )

    monthly_route = db.relationship("MonthlyRoute", back_populates="specialist_months")


class MonthlyRouteRunTimingMonth(db.Model):
    """
    Cached route run start/end from ServiceTrade testing-job onsite clock events
    per Pacific calendar month.
    """

    __tablename__ = "monthly_route_run_timing_month"
    __table_args__ = (
        db.UniqueConstraint(
            "monthly_route_id",
            "month_first",
            name="uq_monthly_route_run_timing_month_route_month",
        ),
        db.Index(
            "ix_monthly_route_run_timing_month_route_month_first",
            "monthly_route_id",
            "month_first",
        ),
    )

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    monthly_route_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_route.id", ondelete="CASCADE"),
        nullable=False,
    )
    month_first = db.Column(db.Date, nullable=False)
    service_trade_job_id = db.Column(db.BigInteger, nullable=True)
    clock_in_at = db.Column(db.DateTime(timezone=True), nullable=True)
    clock_out_at = db.Column(db.DateTime(timezone=True), nullable=True)
    duration_minutes = db.Column(db.Integer, nullable=True)
    #: ok | no_st_link | no_job | no_clocks
    sync_status = db.Column(db.String(32), nullable=False)
    last_updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        onupdate=db.func.now(),
        nullable=False,
    )

    monthly_route = db.relationship("MonthlyRoute", back_populates="run_timing_months")


class MonitoringCompany(db.Model):
    """Office-maintained monitoring vendor directory (phone numbers live here)."""

    __tablename__ = "monitoring_company"
    __table_args__ = (
        db.Index("ix_monitoring_company_name_normalized", "name_normalized"),
    )

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    name = db.Column(db.String(255), nullable=False)
    name_normalized = db.Column(db.String(255), nullable=False)
    primary_phone = db.Column(db.String(64), nullable=True)
    secondary_phone = db.Column(db.String(64), nullable=True)
    active = db.Column(db.Boolean, nullable=False, server_default=db.true())
    created_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        nullable=False,
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        onupdate=db.func.now(),
        nullable=False,
    )

    monthly_locations = db.relationship(
        "MonthlyLocation",
        back_populates="monitoring_company",
        foreign_keys="MonthlyLocation.monitoring_company_id",
    )
    proposals_resulting = db.relationship(
        "MonitoringCompanyProposal",
        back_populates="resulting_company",
        foreign_keys="MonitoringCompanyProposal.resulting_monitoring_company_id",
    )


class MonitoringCompanyProposal(db.Model):
    """
    Technician-proposed monitoring company before a ``MonitoringCompany`` row exists.
    Office promotes proposal → directory row and clears pending FK on locations.
    """

    __tablename__ = "monitoring_company_proposal"
    __table_args__ = (
        db.Index("ix_monitoring_company_proposal_status", "status"),
        db.Index("ix_monitoring_company_proposal_name_normalized", "proposed_name_normalized"),
    )

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    proposed_name = db.Column(db.String(255), nullable=False)
    proposed_name_normalized = db.Column(db.String(255), nullable=False)
    proposed_primary_phone = db.Column(db.String(64), nullable=True)
    #: pending | approved | rejected | merged
    status = db.Column(db.String(32), nullable=False, server_default="pending")
    submitted_by_name = db.Column(db.String(255), nullable=True)
    route_session_id = db.Column(db.BigInteger, nullable=True, index=True)
    resulting_monitoring_company_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monitoring_company.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        nullable=False,
    )
    resolved_at = db.Column(db.DateTime(timezone=True), nullable=True)
    resolved_by_username = db.Column(db.String(255), nullable=True)

    resulting_company = db.relationship(
        "MonitoringCompany",
        back_populates="proposals_resulting",
        foreign_keys=[resulting_monitoring_company_id],
    )
    pending_locations = db.relationship(
        "MonthlyLocation",
        back_populates="pending_monitoring_proposal",
        foreign_keys="MonthlyLocation.pending_monitoring_company_proposal_id",
    )



class MonthlyLocation(db.Model):
    """
    Flat monthly library site: one row per physical stop on a route.
    ``address`` is for navigation/maps; ``label`` is for display everywhere.
    """

    __tablename__ = "monthly_location"
    __table_args__ = (
        db.UniqueConstraint(
            "address_normalized",
            "property_management_company_normalized",
            "label_normalized",
            name="uq_monthly_location_address_pmc_label_normalized",
        ),
        db.Index("ix_monthly_location_status_normalized", "status_normalized"),
        db.CheckConstraint(
            "(monitoring_company_id IS NULL OR pending_monitoring_company_proposal_id IS NULL)",
            name="ck_ml_monitoring_company_xor_pending_proposal",
        ),
    )

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    address = db.Column(db.String(255), nullable=False)
    address_normalized = db.Column(db.String(255), nullable=False)
    label = db.Column(db.String(255), nullable=False)
    label_normalized = db.Column(db.String(255), nullable=False)
    building_name = db.Column(db.String(255), nullable=True)

    property_management_company = db.Column(db.String(255), nullable=True)
    property_management_company_normalized = db.Column(db.String(255), nullable=False, default="")
    notes = db.Column(db.Text, nullable=True)
    billing_comments = db.Column(db.Text, nullable=True)
    barcode = db.Column(db.String(64), nullable=True)
    price_per_month = db.Column(db.Numeric(10, 2), nullable=True)
    pricing_updated = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    area = db.Column(db.String(255), nullable=True)
    start_up_date = db.Column(db.Date, nullable=True)

    status_normalized = db.Column(db.String(32), nullable=False, default="active")
    status_raw = db.Column(db.String(255), nullable=True)

    keys = db.Column(db.Text, nullable=True)
    access_instructions = db.Column(db.Text, nullable=True)
    test_day = db.Column(db.String(255), nullable=True)
    annual_month = db.Column(db.String(32), nullable=True)
    display_address = db.Column(db.String(255), nullable=True)
    latitude = db.Column(db.Float, nullable=True)
    longitude = db.Column(db.Float, nullable=True)

    monthly_route_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_route.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    route_stop_order = db.Column(db.SmallInteger, nullable=True)

    service_trade_site_location_id = db.Column(db.BigInteger, nullable=True, index=True)

    key_id = db.Column(
        db.BigInteger,
        db.ForeignKey("keys.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    monitoring_company_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monitoring_company.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    pending_monitoring_company_proposal_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monitoring_company_proposal.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    annual_month_pending = db.Column(db.String(64), nullable=True)
    annual_month_pending_submitted_at = db.Column(db.DateTime(timezone=True), nullable=True)
    annual_month_pending_submitted_by_name = db.Column(db.String(255), nullable=True)

    ring_detail = db.Column(db.Text, nullable=True)
    facp_detail = db.Column(db.Text, nullable=True)
    panel = db.Column(db.Text, nullable=True)
    panel_location = db.Column(db.String(255), nullable=True)
    door_code = db.Column(db.String(255), nullable=True)
    testing_procedures = db.Column(db.Text, nullable=True)
    inspection_tech_notes = db.Column(db.Text, nullable=True)
    monitoring_account_number = db.Column(db.String(64), nullable=True)
    monitoring_password = db.Column(db.String(64), nullable=True)
    monitoring_notes = db.Column(db.Text, nullable=True)

    legacy_monthly_route_location_id = db.Column(db.BigInteger, nullable=True, index=True)
    legacy_monthly_testing_site_id = db.Column(db.BigInteger, nullable=True, index=True)

    monthly_route = db.relationship(
        "MonthlyRoute",
        back_populates="locations",
        foreign_keys=[monthly_route_id],
    )
    linked_key = db.relationship(
        "Key",
        back_populates="monthly_locations",
        foreign_keys=[key_id],
    )
    monitoring_company = db.relationship(
        "MonitoringCompany",
        back_populates="monthly_locations",
        foreign_keys=[monitoring_company_id],
    )
    pending_monitoring_proposal = db.relationship(
        "MonitoringCompanyProposal",
        back_populates="pending_locations",
        foreign_keys=[pending_monitoring_company_proposal_id],
    )

    created_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        nullable=False,
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        onupdate=db.func.now(),
        nullable=False,
    )

    month_rows = db.relationship(
        "MonthlyLocationMonth",
        back_populates="location",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )
    comments = db.relationship(
        "MonthlyLocationComment",
        back_populates="location",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )
    deficiencies = db.relationship(
        "MonthlyLocationDeficiency",
        back_populates="location",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )


class MonthlyLocationMonth(db.Model):
    """Per-calendar-month snapshot for a monthly location (worksheet + billing grain)."""

    __tablename__ = "monthly_location_month"
    __table_args__ = (
        db.UniqueConstraint(
            "monthly_location_id",
            "month_date",
            name="uq_mlm_location_month",
        ),
        db.Index("ix_mlm_month_date", "month_date"),
        db.Index("ix_mlm_run_id", "run_id"),
    )

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    monthly_location_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_location.id", ondelete="CASCADE"),
        nullable=False,
    )
    month_date = db.Column(db.Date, nullable=False)
    run_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_route_run.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    test_monthly_route_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_route.id", ondelete="SET NULL"),
        nullable=True,
    )
    session_route_stop_order = db.Column(db.SmallInteger, nullable=True)
    result_status = db.Column(db.String(32), nullable=True)
    skip_reason = db.Column(db.String(255), nullable=True)
    source_value_raw = db.Column(db.String(255), nullable=True)
    history_source = db.Column(db.String(32), nullable=True)
    facp = db.Column(db.Text, nullable=True)
    panel = db.Column(db.Text, nullable=True)
    panel_location = db.Column(db.String(255), nullable=True)
    door_code = db.Column(db.String(255), nullable=True)
    property_management_company = db.Column(db.String(255), nullable=True)
    ring = db.Column(db.String(255), nullable=True)
    key_number = db.Column(db.String(255), nullable=True)
    annual_month = db.Column(db.String(32), nullable=True)
    testing_procedures = db.Column(db.Text, nullable=True)
    inspection_tech_notes = db.Column(db.Text, nullable=True)
    run_comments = db.Column(db.Text, nullable=True)
    office_job_comment = db.Column(db.Text, nullable=True)
    office_attention = db.Column(db.Boolean, nullable=False, default=False)
    prior_month_out_of_order_dismissed = db.Column(db.Boolean, nullable=False, default=False)
    sheet_time_in_raw = db.Column(db.String(64), nullable=True)
    sheet_time_out_raw = db.Column(db.String(64), nullable=True)
    test_outcome = db.Column(db.String(32), nullable=True)
    skip_category = db.Column(db.String(64), nullable=True)
    skip_note = db.Column(db.Text, nullable=True)
    confirmed_no_deficiencies = db.Column(db.Boolean, nullable=False, default=False)
    monitoring_company_name = db.Column(db.String(255), nullable=True)
    monitoring_company_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monitoring_company.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    monitoring_account_number = db.Column(db.String(64), nullable=True)
    monitoring_password = db.Column(db.String(64), nullable=True)
    monitoring_notes = db.Column(db.Text, nullable=True)
    billing_status = db.Column(db.String(16), nullable=True)

    created_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        nullable=False,
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        onupdate=db.func.now(),
        nullable=False,
    )

    location = db.relationship("MonthlyLocation", back_populates="month_rows")
    monitoring_company = db.relationship(
        "MonitoringCompany",
        foreign_keys=[monitoring_company_id],
    )
    clock_events = db.relationship(
        "MonthlyStopClockEvent",
        back_populates="location_month",
        cascade="all, delete-orphan",
        lazy="dynamic",
        order_by="MonthlyStopClockEvent.sort_order",
    )
    run = db.relationship(
        "MonthlyRouteRun",
        back_populates="location_month_rows",
        foreign_keys=[run_id],
    )
    test_monthly_route = db.relationship(
        "MonthlyRoute",
        foreign_keys=[test_monthly_route_id],
    )


class MonthlyStopClockEvent(db.Model):
    """One clock-in / clock-out pair for a portal worksheet location visit."""

    __tablename__ = "monthly_stop_clock_event"
    __table_args__ = (
        db.Index("ix_monthly_stop_clock_event_mlm_id", "monthly_location_month_id"),
    )

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    monthly_location_month_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_location_month.id", ondelete="CASCADE"),
        nullable=False,
    )
    sort_order = db.Column(db.SmallInteger, nullable=False, default=0)
    time_in_raw = db.Column(db.String(64), nullable=False)
    time_out_raw = db.Column(db.String(64), nullable=True)
    created_by_tech_id = db.Column(db.String(64), nullable=True)
    created_by_tech_name = db.Column(db.String(255), nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        nullable=False,
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        onupdate=db.func.now(),
        nullable=False,
    )

    location_month = db.relationship("MonthlyLocationMonth", back_populates="clock_events")


class MonthlyLocationDeficiency(db.Model):
    """App-only deficiency tied to a monthly location; persists across runs."""

    __tablename__ = "monthly_location_deficiency"
    __table_args__ = (
        db.Index("ix_monthly_location_deficiency_location_id", "monthly_location_id"),
        db.Index("ix_monthly_location_deficiency_created_run_id", "created_run_id"),
    )

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    monthly_location_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_location.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_run_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_route_run.id", ondelete="SET NULL"),
        nullable=True,
    )
    title = db.Column(db.String(255), nullable=False)
    severity = db.Column(db.String(32), nullable=False)
    status = db.Column(db.String(32), nullable=False, default="new")
    description = db.Column(db.Text, nullable=True)
    service_line = db.Column(db.String(64), nullable=True)
    service_trade_deficiency_id = db.Column(db.BigInteger, nullable=True, index=True)
    verification_notes = db.Column(db.Text, nullable=True)
    reported_by_tech_id = db.Column(db.String(64), nullable=True)
    reported_by_tech_name = db.Column(db.String(255), nullable=True)
    last_edited_by_tech_id = db.Column(db.String(64), nullable=True)
    last_edited_by_tech_name = db.Column(db.String(255), nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        nullable=False,
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        onupdate=db.func.now(),
        nullable=False,
    )

    location = db.relationship("MonthlyLocation", back_populates="deficiencies")
    created_run = db.relationship("MonthlyRouteRun", foreign_keys=[created_run_id])


class MonthlyMigrationConflict(db.Model):
    """Rows that could not be migrated automatically; require manual intervention."""

    __tablename__ = "monthly_migration_conflict"

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    legacy_monthly_route_location_id = db.Column(db.BigInteger, nullable=True, index=True)
    legacy_monthly_testing_site_id = db.Column(db.BigInteger, nullable=True, index=True)
    intended_address = db.Column(db.String(255), nullable=True)
    intended_label = db.Column(db.String(255), nullable=True)
    intended_pmc = db.Column(db.String(255), nullable=True)
    reason = db.Column(db.String(255), nullable=False)
    detail = db.Column(db.Text, nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        nullable=False,
    )


class MonthlyLocationQuarterBilled(db.Model):
    """Billing team tracker: location invoiced for a calendar quarter."""

    __tablename__ = "monthly_location_quarter_billed"
    __table_args__ = (
        db.UniqueConstraint(
            "location_id",
            "year",
            "quarter",
            name="uq_monthly_location_quarter_billed_loc_year_q",
        ),
        db.Index("ix_monthly_location_quarter_billed_year_quarter", "year", "quarter"),
    )

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    location_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_location.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    year = db.Column(db.SmallInteger, nullable=False)
    quarter = db.Column(db.SmallInteger, nullable=False)
    billed_at = db.Column(db.DateTime(timezone=True), nullable=False)
    billed_by_username = db.Column(db.String(255), nullable=True)

    location = db.relationship("MonthlyLocation", backref="quarter_billed_flags")


class MonthlyRouteWorksheetAuditEvent(db.Model):
    """Append-only field-level audit trail for technician worksheet edits."""

    __tablename__ = "monthly_route_worksheet_audit_event"
    __table_args__ = (
        db.Index(
            "ix_mr_worksheet_audit_route_month",
            "monthly_route_id",
            "month_date",
            "changed_at",
        ),
        db.Index(
            "ix_mr_worksheet_audit_location_month",
            "location_id",
            "month_date",
            "changed_at",
        ),
        db.Index(
            "ix_mr_worksheet_audit_location_month_row",
            "location_month_row_id",
            "field_name",
            "changed_at",
        ),
        db.UniqueConstraint("client_mutation_id", name="uq_mr_worksheet_audit_client_mutation"),
    )

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    monthly_route_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_route.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    location_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_location.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    location_month_row_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_location_month.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    month_date = db.Column(db.Date, nullable=False, index=True)
    field_name = db.Column(db.String(64), nullable=False)
    old_value = db.Column(db.JSON, nullable=True)
    new_value = db.Column(db.JSON, nullable=True)
    source = db.Column(db.String(32), nullable=False, server_default="technician_app")
    changed_by_username = db.Column(db.String(255), nullable=True)
    changed_by_name = db.Column(db.String(255), nullable=True)
    client_mutation_id = db.Column(db.String(64), nullable=True)
    changed_at_client = db.Column(db.DateTime(timezone=True), nullable=True)
    changed_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        nullable=False,
    )

    location_month_row = db.relationship("MonthlyLocationMonth")
    location = db.relationship("MonthlyLocation")
    route = db.relationship("MonthlyRoute")


class MonthlyLocationComment(db.Model):
    """Staff-authored notes on a monthly library location."""

    __tablename__ = "monthly_location_comment"

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    location_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_location.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    body = db.Column(db.Text, nullable=False)
    author_username = db.Column(db.String(255), nullable=True)

    created_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        nullable=False,
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        onupdate=db.func.now(),
        nullable=False,
    )

    location = db.relationship("MonthlyLocation", back_populates="comments")


LOCATION_TICKET_STATUSES = ("open", "in_progress", "closed")
LOCATION_TICKET_CLOSE_REASONS = ("completed", "invalid")
LOCATION_TICKET_ACTIVE_STATUSES = ("open", "in_progress")


class MonthlyLocationTicket(db.Model):
    """Office follow-up task for a monthly location (keys, monitoring email, etc.)."""

    __tablename__ = "monthly_location_ticket"
    __table_args__ = (
        db.Index("ix_monthly_location_ticket_location_id", "monthly_location_id"),
        db.Index("ix_monthly_location_ticket_status", "status"),
    )

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    monthly_location_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_location.id", ondelete="CASCADE"),
        nullable=False,
    )
    run_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_route_run.id", ondelete="SET NULL"),
        nullable=True,
    )
    month_date = db.Column(db.Date, nullable=True)
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    tags_json = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(32), nullable=False, server_default="open")
    close_reason = db.Column(db.String(32), nullable=True)
    created_by = db.Column(db.String(128), nullable=True)
    closed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        nullable=False,
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        onupdate=db.func.now(),
        nullable=False,
    )

    location = db.relationship("MonthlyLocation", backref=db.backref("tickets", lazy="dynamic"))
    run = db.relationship("MonthlyRouteRun")
    events = db.relationship(
        "MonthlyLocationTicketEvent",
        back_populates="ticket",
        cascade="all, delete-orphan",
        order_by="MonthlyLocationTicketEvent.created_at",
    )
    comments = db.relationship(
        "MonthlyLocationTicketComment",
        back_populates="ticket",
        cascade="all, delete-orphan",
        order_by="MonthlyLocationTicketComment.created_at",
    )


class MonthlyLocationTicketEvent(db.Model):
    """Status transition log for a location ticket."""

    __tablename__ = "monthly_location_ticket_event"
    __table_args__ = (
        db.Index("ix_monthly_location_ticket_event_ticket_id", "ticket_id"),
    )

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    ticket_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_location_ticket.id", ondelete="CASCADE"),
        nullable=False,
    )
    from_status = db.Column(db.String(32), nullable=True)
    to_status = db.Column(db.String(32), nullable=False)
    note = db.Column(db.Text, nullable=True)
    created_by = db.Column(db.String(128), nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        nullable=False,
    )

    ticket = db.relationship("MonthlyLocationTicket", back_populates="events")


class MonthlyLocationTicketComment(db.Model):
    """Staff discussion thread on a location ticket."""

    __tablename__ = "monthly_location_ticket_comment"
    __table_args__ = (
        db.Index("ix_monthly_location_ticket_comment_ticket_id", "ticket_id"),
    )

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    ticket_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_location_ticket.id", ondelete="CASCADE"),
        nullable=False,
    )
    body = db.Column(db.Text, nullable=False)
    created_by = db.Column(db.String(128), nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        nullable=False,
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        onupdate=db.func.now(),
        nullable=False,
    )

    ticket = db.relationship("MonthlyLocationTicket", back_populates="comments")


class MonthlyRouteComment(db.Model):
    """Staff-authored notes on a monthly calendar route (library route entity)."""

    __tablename__ = "monthly_route_comment"

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    monthly_route_id = db.Column(
        db.BigInteger,
        db.ForeignKey("monthly_route.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    body = db.Column(db.Text, nullable=False)
    author_username = db.Column(db.String(255), nullable=True)

    created_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        nullable=False,
    )
    updated_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        onupdate=db.func.now(),
        nullable=False,
    )

    monthly_route = db.relationship("MonthlyRoute", back_populates="route_comments")


class MonthlyRouteSnapshot(db.Model):
    """
    Cached specialist stats keyed by ServiceTrade **route** pseudo-location id (clock-in
    location for that route, not a street address). Aligns with
    ``MonthlyRoute.service_trade_route_location_id``, not ``MonthlyRouteLocation``.
    """

    __tablename__ = "monthly_route_snapshot"

    id = db.Column(db.BigInteger, primary_key=True)

    # ServiceTrade location id for the route workspace (see module docstring).
    location_id = db.Column(db.BigInteger, nullable=False, unique=True, index=True)
    location_name = db.Column(db.String(255), nullable=False)

    completed_jobs_count = db.Column(db.Integer, nullable=False, default=0)

    # 🔥 Precomputed top 5 technicians
    # Example value:
    # [
    #   {"tech_name": "John Smith", "jobs": 42},
    #   {"tech_name": "Jane Doe", "jobs": 38}
    # ]
    top_technicians = db.Column(JSONB, nullable=False)

    last_updated_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )

    def __repr__(self):
        return f"<MonthlyRouteSnapshot {self.location_name}>"


class Key(db.Model):
    __tablename__ = "keys"

    id = db.Column(db.BigInteger, primary_key=True)

    # UNIQUE KEY for upsert
    keycode = db.Column(db.String(255), nullable=False, unique=True, index=True)

    # Keep nullable. Use BigInteger in case barcodes exceed 32-bit.
    barcode = db.Column(db.BigInteger, nullable=True, index=True)

    route = db.Column(db.String(255), nullable=True)
    home_location = db.Column(db.String(255), nullable=True)
    annual_month = db.Column(db.String(255), nullable=True)
    area = db.Column(db.String(255), nullable=True)

    site_status = db.Column(db.String(255), nullable=True)

    addresses = relationship(
        "KeyAddress",
        back_populates="key",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    statuses = relationship(
        "KeyStatus",
        back_populates="key",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="desc(KeyStatus.inserted_at)",  # newest first
    )

    monthly_locations = relationship(
        "MonthlyLocation",
        back_populates="linked_key",
        foreign_keys="MonthlyLocation.key_id",
    )

    @property
    def current_status(self):
        return self.statuses[0] if self.statuses else None

    __table_args__ = (
        Index("ix_keys_route", "route"),
    )


class KeyAddress(db.Model):
    __tablename__ = "key_addresses"

    id = db.Column(db.BigInteger, primary_key=True)

    address = db.Column(db.String(255), nullable=False)

    key_id = db.Column(
        db.BigInteger,
        ForeignKey("keys.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    key = relationship("Key", back_populates="addresses")

    __table_args__ = (
        # Prevent duplicates for the same key
        UniqueConstraint("key_id", "address", name="uq_key_addresses_key_id_address"),
    )


class KeyStatus(db.Model):
    __tablename__ = "key_status"

    id = db.Column(db.BigInteger, primary_key=True)

    key_id = db.Column(
        db.BigInteger,
        ForeignKey("keys.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    status = db.Column(db.String(255), nullable=False)
    key_location = db.Column(db.String(255), nullable=False)
    air_tag = db.Column(db.String(55), nullable=True)

    returned_by = db.Column(db.String(255), nullable=True)

    is_on_monthly = db.Column(db.Boolean, default=False, nullable=True)

    inserted_at = db.Column(
        db.DateTime(timezone=True),
        server_default=db.func.now(),
        nullable=False,
    )

    key = relationship("Key", back_populates="statuses")


class SchedulingCancelled(db.Model):
    __tablename__ = "scheduling_cancelled"

    id = db.Column(db.BigInteger, primary_key=True)

    # ServiceTrade location id (matches Location.location_id)
    location_id = db.Column(
        db.BigInteger,
        db.ForeignKey("location.location_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # First of month (date) for the selected month
    observed_month = db.Column(db.Date, nullable=False, index=True)

    # Optional audit fields (keep simple)
    cancelled_by = db.Column(db.String(255), nullable=True)
    cancelled_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    note = db.Column(db.Text, nullable=True)

    __table_args__ = (
        db.UniqueConstraint("location_id", "observed_month", name="uq_cancelled_loc_month"),
    )

    def __repr__(self):
        return f"<SchedulingCancelled loc={self.location_id} month={self.observed_month}>"  


class SchedulingAttackV2(db.Model):
    __tablename__ = "scheduling_attack_v2"

    id = db.Column(db.BigInteger, primary_key=True)

    location_id = db.Column(db.BigInteger, nullable=False, index=True)

    # Month anchor: first day of month at 00:00 UTC
    inspection_month = db.Column(db.DateTime(timezone=True), nullable=False)
    planned_maintenance_month = db.Column(db.DateTime(timezone=True), nullable=True)

    address = db.Column(db.String(255), nullable=False)

    scheduled = db.Column(db.Boolean, default=False)
    scheduled_date = db.Column(db.DateTime(timezone=True), nullable=True)
    job_id = db.Column(db.BigInteger, nullable=True, index=True)
    job_type = db.Column(db.String(255), nullable=True)
    confirmed = db.Column(db.Boolean, default=False)
    reached_out = db.Column(db.Boolean, default=False)
    completed = db.Column(db.Boolean, default=False)
    canceled = db.Column(db.Boolean, default=False)

    notes = db.Column(db.String(1020), nullable=True)

    __table_args__ = (
        db.UniqueConstraint("location_id", name="uq_scheduling_attack_v2_location"),
    )
    


class SchedulingReachedOut(db.Model):
    __tablename__ = "scheduling_reached_out"

    id = db.Column(db.BigInteger, primary_key=True)

    # If you have a job_id, use it. (nullable so you can still record by address)
    job_id = db.Column(
        db.BigInteger,
        db.ForeignKey("service_occurrence.job_id", ondelete="CASCADE"),
        nullable=True,
        index=True,
        unique=True,  # Postgres allows multiple NULLs; non-null job_ids are unique
    )

    # For fallback identification and filtering
    location_id = db.Column(
        db.BigInteger,
        db.ForeignKey("location.location_id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    address = db.Column(db.String(255), nullable=True, index=True)
    scheduled_for = db.Column(db.DateTime(timezone=True), nullable=True, index=True)

    reached_out_by = db.Column(db.String(255), nullable=True)
    reached_out_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )
    note = db.Column(db.Text, nullable=True)

    # Fallback uniqueness to prevent duplicates when job_id is NULL.
    __table_args__ = (
        db.UniqueConstraint(
            "location_id", "address", "scheduled_for",
            name="uq_reachedout_loc_addr_sched"
        ),
    )

    def __repr__(self):
        return f"<SchedulingReachedOut job={self.job_id} loc={self.location_id}>"



class JobsSchedulingState(db.Model):
    __tablename__ = "jobs_scheduling_state"

    job_id = db.Column(db.BigInteger, nullable=False, primary_key=True)

    scheduled_date = db.Column(db.DateTime(timezone=True), nullable=True)

    last_seen_at = db.Column(db.DateTime(timezone=True), nullable=False)

    job_type = db.Column(db.String(255), nullable=False)



class WeeklySchedulingStats(db.Model):
    __tablename__ = "weekly_scheduling_stats"

    id = db.Column(db.BigInteger, primary_key=True)

    period_start = db.Column(db.DateTime(timezone=True), nullable=False)
    period_end = db.Column(db.DateTime(timezone=True), nullable=False)
    
    job_type = db.Column(db.String(255), nullable=False)

    scheduled_count = db.Column(db.Integer)
    rescheduled_count = db.Column(db.Integer)

    generated_at = db.Column(db.DateTime(timezone=True), nullable=False)

    __table_args__ = (
        db.UniqueConstraint(
            "period_start",
            "period_end",
            "job_type",
            name="uq_weekly_scheduling_stats_period_type",
        ),
    )


class JobsSchedulingDayBaseline(db.Model):
    __tablename__ = "jobs_scheduling_day_baseline"

    id = db.Column(db.BigInteger, primary_key=True)
    baseline_date_local = db.Column(db.Date, nullable=False, index=True)
    job_id = db.Column(db.BigInteger, nullable=False)
    scheduled_date = db.Column(db.DateTime(timezone=True), nullable=True)
    job_type = db.Column(db.String(255), nullable=True)
    captured_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        db.UniqueConstraint("baseline_date_local", "job_id", name="uq_jobs_sched_day_baseline_date_job"),
    )


class JobsSchedulingDayMetricCache(db.Model):
    __tablename__ = "jobs_scheduling_day_metric_cache"

    id = db.Column(db.BigInteger, primary_key=True)
    baseline_date_local = db.Column(db.Date, nullable=False, unique=True, index=True)
    scheduled_today_count = db.Column(db.Integer, nullable=False, default=0)
    rescheduled_to_today_count = db.Column(db.Integer, nullable=False, default=0)
    generated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))


class ForwardScheduleWeek(db.Model):
    __tablename__ = "forward_schedule_week"

    id = db.Column(db.BigInteger, primary_key=True)

    # Monday 00:00 local time (America/Vancouver), tz-aware
    week_start_local = db.Column(db.DateTime(timezone=True), nullable=False, unique=True, index=True)
    week_end_local = db.Column(db.DateTime(timezone=True), nullable=False)

    booked_hours = db.Column(db.Float, nullable=False, default=0.0)
    unavailable_hours = db.Column(db.Float, nullable=False, default=0.0)   # optional but useful
    available_hours = db.Column(db.Float, nullable=False, default=0.0)

    released_appointments = db.Column(db.Integer, nullable=False, default=0)
    utilization_pct = db.Column(db.Float, nullable=False, default=0.0)

    generated_at = db.Column(db.DateTime(timezone=True), nullable=False, index=True)

    __table_args__ = (
        db.CheckConstraint("booked_hours >= 0", name="ck_fsw_booked_nonneg"),
        db.CheckConstraint("available_hours >= 0", name="ck_fsw_available_nonneg"),
        db.CheckConstraint("utilization_pct >= 0", name="ck_fsw_util_nonneg"),
    )


class SchedulingJobsLeftMonth(db.Model):
    """Manual office entry: jobs remaining to schedule for a calendar month (Vancouver)."""

    __tablename__ = "scheduling_jobs_left_month"

    # First day of the calendar month (date only).
    year_month = db.Column(db.Date, primary_key=True)
    jobs_left = db.Column(db.Integer, nullable=False)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False)
    updated_by = db.Column(db.String(255), nullable=False)

    __table_args__ = (
        db.CheckConstraint("jobs_left >= 0", name="ck_sjlm_jobs_left_nonneg"),
    )


class Vehicle(db.Model):
    __tablename__ = "vehicle"

    id = db.Column(db.BigInteger, primary_key=True)

    # Identity
    license_plate = db.Column(db.String(32), nullable=False, unique=True, index=True)
    year = db.Column(db.Integer, nullable=True)
    color = db.Column(db.String(32), nullable=True)
    make_model = db.Column(db.String(64), nullable=False)

    # Assignment
    current_driver_name = db.Column(db.String(64), nullable=True)

    # Vehicle specs (reference only)
    fuel_tank_size_l = db.Column(db.Float, nullable=True)
    fuel_economy_l_per_100km = db.Column(db.Float, nullable=True)

    is_active = db.Column(db.Boolean, nullable=False, default=True, index=True)

    # Cached "latest known" values (derived from submissions)
    latest_current_km = db.Column(db.Integer, nullable=True)
    latest_service_due_km = db.Column(db.Integer, nullable=True)

    latest_oil_level = db.Column(db.String(16), nullable=True)      # empty / 1/3 / 2/3 / full
    latest_coolant_level = db.Column(db.String(16), nullable=True)
    latest_transmission_level = db.Column(db.String(16), nullable=True)

    # Inspection / submission tracking
    last_submission_at = db.Column(db.DateTime(timezone=True), nullable=True, index=True)
    last_submission_by = db.Column(db.String(64), nullable=True)

    # Service workflow
    last_service_date = db.Column(db.Date, nullable=True)
    service_booked_at = db.Column(db.Date, nullable=True)

    status = db.Column(
        db.String(16),
        nullable=False,
        default="OK",
        index=True,
    )  # {"OK", "DUE", "BOOKED", "IN_SHOP", "DEFICIENCY"}

    notes = db.Column(db.Text, nullable=True)  # office notes, editable/deletable

    # Relationships
    submissions = db.relationship(
        "VehicleSubmission",
        back_populates="vehicle",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )

    service_events = db.relationship(
        "VehicleServiceEvent",
        back_populates="vehicle",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )

    deficiencies = db.relationship(
        "VehicleDeficiency",
        back_populates="vehicle",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )

    def __repr__(self):
        return f"<Vehicle {self.license_plate} ({self.make_model})>"


class VehicleSubmission(db.Model):
    __tablename__ = "vehicle_submission"

    id = db.Column(db.BigInteger, primary_key=True)

    vehicle_id = db.Column(
        db.BigInteger,
        db.ForeignKey("vehicle.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    submitted_at = db.Column(db.DateTime(timezone=True), nullable=False, index=True)
    submitted_by = db.Column(db.String(64), nullable=False)

    # Submitted values (NULL = not provided)
    current_km = db.Column(db.Integer, nullable=True)
    service_due_km = db.Column(db.Integer, nullable=True)

    oil_level = db.Column(db.String(16), nullable=True)      # empty / 1/3 / 2/3 / full
    coolant_level = db.Column(db.String(16), nullable=True)
    transmission_level = db.Column(db.String(16), nullable=True)

    warning_lights = db.Column(db.Boolean, nullable=True)
    safe_to_operate = db.Column(db.Boolean, nullable=True)

    notes = db.Column(db.Text, nullable=True)

    # Relationship
    vehicle = db.relationship("Vehicle", back_populates="submissions")

    __table_args__ = (
        db.CheckConstraint("current_km >= 0", name="ck_vs_current_km_nonneg"),
        db.CheckConstraint("service_due_km >= 0", name="ck_vs_service_due_km_nonneg"),
    )

    def __repr__(self):
        return f"<VehicleSubmission vehicle_id={self.vehicle_id} at {self.submitted_at}>"


class VehicleServiceEvent(db.Model):
    __tablename__ = "vehicle_service_event"

    id = db.Column(db.BigInteger, primary_key=True)

    vehicle_id = db.Column(
        db.BigInteger,
        db.ForeignKey("vehicle.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    service_type = db.Column(
        db.String(64),
        nullable=False,
        default="OK",
        index=True,
    ) 

    service_date = db.Column(db.DateTime(timezone=True), nullable=False)

    service_notes = db.Column(db.Text, nullable=True)

    created_by = db.Column(db.String(64), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=db.func.now())

    updated_by = db.Column(db.String(64), nullable=True)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=db.func.now(), onupdate=db.func.now())

    service_status = db.Column(db.String(64), nullable=False, default="BOOKED", index=True) # BOOKED / CANCELED / COMPLETE

    # Relationship
    vehicle = db.relationship("Vehicle", back_populates="service_events")

    __table_args__ = (
        db.CheckConstraint("service_status IN ('BOOKED','CANCELED','COMPLETE')", name="ck_vehicle_service_status"),
    )


    linked_deficiencies = db.relationship(
        "VehicleDeficiency",
        back_populates="linked_service",
        passive_deletes=True,  # pairs well with ON DELETE SET NULL
    )

    def __repr__(self):
        return f"<VehicleServiceEvent vehicle_id={self.vehicle_id} service_type={self.service_type} at {self.service_date}>"


class VehicleDeficiency(db.Model):
    __tablename__ = "vehicle_deficiency"

    id = db.Column(db.BigInteger, primary_key=True)

    vehicle_id = db.Column(
        db.BigInteger,
        db.ForeignKey("vehicle.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    linked_service_id = db.Column(
        db.BigInteger,
        db.ForeignKey("vehicle_service_event.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )


    # e.g. "INOPERABLE", "DEFICIENT", "ADVISORY"
    severity = db.Column(db.String(64), nullable=True, default="DEFICIENT", index=True)

    # e.g. "OPEN", "BOOKED", "FIXED", "INVALID"
    status = db.Column(db.String(64), nullable=False, default="OPEN", index=True)

    description = db.Column(db.Text, nullable=False)

    created_by = db.Column(db.String(64), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=db.func.now())

    updated_by = db.Column(db.String(64), nullable=True)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=db.func.now(), onupdate=db.func.now())

    # --- Relationships ---
    vehicle = db.relationship("Vehicle", back_populates="deficiencies")

    linked_service = db.relationship(
        "VehicleServiceEvent",
        back_populates="linked_deficiencies",
    )

    __table_args__ = (
        db.CheckConstraint("status IN ('OPEN','BOOKED','FIXED','INVALID')", name="ck_vehicle_deficiency_status"),
    )


    def __repr__(self):
        return (
            f"<VehicleDeficiency [{self.status}] vehicle_id={self.vehicle_id} "
            f"severity={self.severity} updated_at={self.updated_at}>"
        )


if __name__ == '__main__':
    from app import create_app
    app = create_app()

    with app.app_context():
        db.create_all()
        print("Database tables created.")

