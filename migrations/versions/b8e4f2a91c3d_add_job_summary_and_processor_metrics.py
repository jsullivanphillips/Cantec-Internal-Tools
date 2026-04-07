"""add job_summary and processor_metrics tables

These models existed in db_models.py but were never included in Alembic,
so fresh or fully-upgraded databases lacked the tables used by Processing Attack.

Revision ID: b8e4f2a91c3d
Revises: fc1bc3bded62
Create Date: 2026-04-07

"""
from alembic import op
import sqlalchemy as sa


revision = "b8e4f2a91c3d"
down_revision = "fc1bc3bded62"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "job_summary",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("total_jobs_processed", sa.Integer(), nullable=True),
        sa.Column("total_tech_hours_processed", sa.Float(), nullable=True),
        sa.Column("jobs_by_type", sa.JSON(), nullable=True),
        sa.Column("hours_by_type", sa.JSON(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("week_start"),
    )
    op.create_table(
        "processor_metrics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("processor_name", sa.String(length=255), nullable=False),
        sa.Column("jobs_processed", sa.Integer(), nullable=True),
        sa.Column("hours_processed", sa.Float(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "week_start", "processor_name", name="unique_week_processor"
        ),
    )


def downgrade():
    op.drop_table("processor_metrics")
    op.drop_table("job_summary")
