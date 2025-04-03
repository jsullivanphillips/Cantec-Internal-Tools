# models.py
import os
from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy

# Create an instance of SQLAlchemy
db = SQLAlchemy()

class JobSummary(db.Model):
    __tablename__ = 'job_summary'
    
    id = db.Column(db.Integer, primary_key=True)
    week_start = db.Column(db.Date, unique=True, nullable=False)
    total_jobs_processed = db.Column(db.Integer, default=0)
    total_tech_hours_processed = db.Column(db.Float, default=0.0)
    jobs_by_type = db.Column(db.JSON)  # Stores a JSON object of job counts per type
    hours_by_type = db.Column(db.JSON) # Stores a JSON object of tech hours per type
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    def __repr__(self):
        return f'<JobSummary {self.week_start}: {self.total_jobs_processed} jobs>'

# If you need to add more models, you can do so here.
