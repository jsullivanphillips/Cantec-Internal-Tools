"""add intraday scheduling baseline and cache tables

Revision ID: b5c3d1e8a902
Revises: 8f1c2d4a9b01
Create Date: 2026-04-28 10:35:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b5c3d1e8a902"
down_revision = "8f1c2d4a9b01"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "jobs_scheduling_day_baseline",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("baseline_date_local", sa.Date(), nullable=False),
        sa.Column("job_id", sa.BigInteger(), nullable=False),
        sa.Column("scheduled_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("job_type", sa.String(length=255), nullable=True),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("baseline_date_local", "job_id", name="uq_jobs_sched_day_baseline_date_job"),
    )
    op.create_index(
        op.f("ix_jobs_scheduling_day_baseline_baseline_date_local"),
        "jobs_scheduling_day_baseline",
        ["baseline_date_local"],
        unique=False,
    )

    op.create_table(
        "jobs_scheduling_day_metric_cache",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("baseline_date_local", sa.Date(), nullable=False),
        sa.Column("scheduled_today_count", sa.Integer(), nullable=False),
        sa.Column("rescheduled_to_today_count", sa.Integer(), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_jobs_scheduling_day_metric_cache_baseline_date_local"),
        "jobs_scheduling_day_metric_cache",
        ["baseline_date_local"],
        unique=True,
    )


def downgrade():
    op.drop_index(op.f("ix_jobs_scheduling_day_metric_cache_baseline_date_local"), table_name="jobs_scheduling_day_metric_cache")
    op.drop_table("jobs_scheduling_day_metric_cache")
    op.drop_index(op.f("ix_jobs_scheduling_day_baseline_baseline_date_local"), table_name="jobs_scheduling_day_baseline")
    op.drop_table("jobs_scheduling_day_baseline")
