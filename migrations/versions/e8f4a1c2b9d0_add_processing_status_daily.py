"""Add processing_status_daily for weekday KPI snapshots

Revision ID: e8f4a1c2b9d0
Revises: c7a9e2b4f801
Create Date: 2026-04-07

"""
from alembic import op
import sqlalchemy as sa


revision = "e8f4a1c2b9d0"
down_revision = "c7a9e2b4f801"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "processing_status_daily",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("jobs_to_be_marked_complete", sa.Integer(), server_default="0", nullable=False),
        sa.Column("jobs_to_be_invoiced", sa.Integer(), server_default="0", nullable=False),
        sa.Column("jobs_to_be_converted", sa.Integer(), server_default="0", nullable=False),
        sa.Column("earliest_job_to_be_converted_date", sa.Date(), nullable=True),
        sa.Column("earliest_job_to_be_converted_address", sa.String(length=255), nullable=True),
        sa.Column("earliest_job_to_be_converted_job_id", sa.BIGINT(), nullable=True),
        sa.Column("oldest_job_date", sa.Date(), nullable=True),
        sa.Column("oldest_job_address", sa.String(length=255), nullable=True),
        sa.Column("oldest_job_type", sa.String(length=255), nullable=True),
        sa.Column("job_type_count", sa.JSON(), nullable=True),
        sa.Column("number_of_pink_folder_jobs", sa.Integer(), server_default="0", nullable=False),
        sa.Column("oldest_inspection_date", sa.Date(), nullable=True),
        sa.Column("oldest_inspection_address", sa.String(length=255), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("snapshot_date", name="uq_processing_status_daily_snapshot_date"),
    )


def downgrade():
    op.drop_table("processing_status_daily")
