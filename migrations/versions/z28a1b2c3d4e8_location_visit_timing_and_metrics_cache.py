"""Add location visit timing lookup and dashboard location metrics cache tables.

Revision ID: z28a1b2c3d4e8
Revises: z27a1b2c3d4e7
Create Date: 2026-06-18

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "z28a1b2c3d4e8"
down_revision = "z27a1b2c3d4e7"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return inspect(op.get_bind()).has_table(table_name)


def upgrade():
    if not _has_table("monthly_location_visit_timing_month"):
        op.create_table(
            "monthly_location_visit_timing_month",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("monthly_location_month_id", sa.BigInteger(), nullable=False),
            sa.Column("monthly_location_id", sa.BigInteger(), nullable=False),
            sa.Column("month_first", sa.Date(), nullable=False),
            sa.Column("visit_minutes", sa.Integer(), nullable=True),
            sa.Column("visit_time_source", sa.String(length=16), nullable=True),
            sa.Column("sync_status", sa.String(length=16), nullable=False),
            sa.Column(
                "last_updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(
                ["monthly_location_month_id"],
                ["monthly_location_month.id"],
                name="fk_monthly_location_visit_timing_month_mlm_id",
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["monthly_location_id"],
                ["monthly_location.id"],
                name="fk_monthly_location_visit_timing_month_location_id",
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "monthly_location_month_id",
                name="uq_monthly_location_visit_timing_month_mlm",
            ),
        )
        op.create_index(
            "ix_monthly_location_visit_timing_month_loc_month",
            "monthly_location_visit_timing_month",
            ["monthly_location_id", "month_first"],
            unique=False,
        )

    if not _has_table("monthly_dashboard_location_metrics_cache"):
        op.create_table(
            "monthly_dashboard_location_metrics_cache",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("cache_key", sa.String(length=128), nullable=False),
            sa.Column("payload_json", sa.Text(), nullable=False),
            sa.Column(
                "refreshed_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "cache_key",
                name="uq_monthly_dashboard_location_metrics_cache_key",
            ),
        )


def downgrade():
    if _has_table("monthly_dashboard_location_metrics_cache"):
        op.drop_table("monthly_dashboard_location_metrics_cache")
    if _has_table("monthly_location_visit_timing_month"):
        op.drop_index(
            "ix_monthly_location_visit_timing_month_loc_month",
            table_name="monthly_location_visit_timing_month",
        )
        op.drop_table("monthly_location_visit_timing_month")
