"""Add jobs_processed_today to processing_status_daily

Revision ID: 2a6d4c8e91b7
Revises: f2a1d8c4b7e9
Create Date: 2026-04-21

"""
from alembic import op
import sqlalchemy as sa


revision = "2a6d4c8e91b7"
down_revision = "f2a1d8c4b7e9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "processing_status_daily",
        sa.Column("jobs_processed_today", sa.Integer(), nullable=True),
    )


def downgrade():
    op.drop_column("processing_status_daily", "jobs_processed_today")
