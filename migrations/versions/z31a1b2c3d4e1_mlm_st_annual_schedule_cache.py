"""Cache ServiceTrade annual schedule on monthly_location_month.

Revision ID: z31a1b2c3d4e1
Revises: z30a1b2c3d4e0
Create Date: 2026-06-24

"""

from alembic import op
import sqlalchemy as sa


revision = "z31a1b2c3d4e1"
down_revision = "z30a1b2c3d4e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monthly_location_month",
        sa.Column("st_annual_skip_recommended", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "monthly_location_month",
        sa.Column("st_annual_test_recommended", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "monthly_location_month",
        sa.Column("st_annual_spans_months", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "monthly_location_month",
        sa.Column("st_has_scheduled_annual_in_month", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "monthly_location_month",
        sa.Column("st_annual_prep_warning", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "monthly_location_month",
        sa.Column("st_spanning_job_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "monthly_location_month",
        sa.Column("st_annual_synced_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_mlm_route_month_st_annual_skip",
        "monthly_location_month",
        ["test_monthly_route_id", "month_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_mlm_route_month_st_annual_skip", table_name="monthly_location_month")
    op.drop_column("monthly_location_month", "st_annual_synced_at")
    op.drop_column("monthly_location_month", "st_spanning_job_id")
    op.drop_column("monthly_location_month", "st_annual_prep_warning")
    op.drop_column("monthly_location_month", "st_has_scheduled_annual_in_month")
    op.drop_column("monthly_location_month", "st_annual_spans_months")
    op.drop_column("monthly_location_month", "st_annual_test_recommended")
    op.drop_column("monthly_location_month", "st_annual_skip_recommended")
