"""Store additional processing KPIs in ProcessingStatus

Revision ID: c6e3f2a3b8d1
Revises: 72afa9ecf07a
Create Date: 2026-03-18
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c6e3f2a3b8d1"
down_revision = "72afa9ecf07a"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "processing_status",
        sa.Column(
            "jobs_to_be_invoiced",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
    )
    op.add_column(
        "processing_status",
        sa.Column(
            "jobs_to_be_converted",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
    )
    op.add_column(
        "processing_status",
        sa.Column("earliest_job_to_be_converted_date", sa.Date(), nullable=True),
    )
    op.add_column(
        "processing_status",
        sa.Column(
            "earliest_job_to_be_converted_address", sa.String(length=255), nullable=True
        ),
    )
    op.add_column(
        "processing_status",
        sa.Column(
            "earliest_job_to_be_converted_job_id",
            sa.BIGINT(),
            nullable=True,
        ),
    )


def downgrade():
    op.drop_column("processing_status", "earliest_job_to_be_converted_job_id")
    op.drop_column("processing_status", "earliest_job_to_be_converted_address")
    op.drop_column("processing_status", "earliest_job_to_be_converted_date")
    op.drop_column("processing_status", "jobs_to_be_converted")
    op.drop_column("processing_status", "jobs_to_be_invoiced")

