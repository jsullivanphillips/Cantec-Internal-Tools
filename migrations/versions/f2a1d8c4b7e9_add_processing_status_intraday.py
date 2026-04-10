"""Add processing_status_intraday for intraday backlog tracking

Revision ID: f2a1d8c4b7e9
Revises: e8f4a1c2b9d0
Create Date: 2026-04-10

"""
from alembic import op
import sqlalchemy as sa


revision = "f2a1d8c4b7e9"
down_revision = "e8f4a1c2b9d0"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "processing_status_intraday",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("jobs_to_be_marked_complete", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_processing_status_intraday_snapshot_date",
        "processing_status_intraday",
        ["snapshot_date"],
        unique=False,
    )
    op.create_index(
        "ix_processing_status_intraday_captured_at",
        "processing_status_intraday",
        ["captured_at"],
        unique=False,
    )
    op.create_index(
        "ix_processing_status_intraday_snapshot_date_captured_at",
        "processing_status_intraday",
        ["snapshot_date", "captured_at"],
        unique=False,
    )


def downgrade():
    op.drop_index(
        "ix_processing_status_intraday_snapshot_date_captured_at",
        table_name="processing_status_intraday",
    )
    op.drop_index(
        "ix_processing_status_intraday_captured_at",
        table_name="processing_status_intraday",
    )
    op.drop_index(
        "ix_processing_status_intraday_snapshot_date",
        table_name="processing_status_intraday",
    )
    op.drop_table("processing_status_intraday")
