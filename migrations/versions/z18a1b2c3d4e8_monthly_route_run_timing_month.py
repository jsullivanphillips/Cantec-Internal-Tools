"""Add monthly_route_run_timing_month cache table.

Revision ID: z18a1b2c3d4e8
Revises: z17a1b2c3d4e7
Create Date: 2026-06-15

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "z18a1b2c3d4e8"
down_revision = "z17a1b2c3d4e7"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return inspect(op.get_bind()).has_table(table_name)


def upgrade():
    if _has_table("monthly_route_run_timing_month"):
        return
    op.create_table(
        "monthly_route_run_timing_month",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("monthly_route_id", sa.BigInteger(), nullable=False),
        sa.Column("month_first", sa.Date(), nullable=False),
        sa.Column("service_trade_job_id", sa.BigInteger(), nullable=True),
        sa.Column("clock_in_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("clock_out_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_minutes", sa.Integer(), nullable=True),
        sa.Column("sync_status", sa.String(length=32), nullable=False),
        sa.Column(
            "last_updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["monthly_route_id"],
            ["monthly_route.id"],
            name="fk_monthly_route_run_timing_month_monthly_route_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "monthly_route_id",
            "month_first",
            name="uq_monthly_route_run_timing_month_route_month",
        ),
    )
    op.create_index(
        "ix_monthly_route_run_timing_month_route_month_first",
        "monthly_route_run_timing_month",
        ["monthly_route_id", "month_first"],
        unique=False,
    )


def downgrade():
    if not _has_table("monthly_route_run_timing_month"):
        return
    op.drop_index(
        "ix_monthly_route_run_timing_month_route_month_first",
        table_name="monthly_route_run_timing_month",
    )
    op.drop_table("monthly_route_run_timing_month")
