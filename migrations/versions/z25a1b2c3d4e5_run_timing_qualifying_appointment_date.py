"""Add qualifying ServiceTrade appointment date to run timing cache.

Revision ID: z25a1b2c3d4e5
Revises: z24a1b2c3d4e4
Create Date: 2026-06-17

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "z25a1b2c3d4e5"
down_revision = "z24a1b2c3d4e4"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    if not inspect(bind).has_table(table_name):
        return False
    return column_name in {col["name"] for col in inspect(bind).get_columns(table_name)}


def upgrade() -> None:
    if not _has_column(
        "monthly_route_run_timing_month",
        "service_trade_qualifying_appointment_on",
    ):
        op.add_column(
            "monthly_route_run_timing_month",
            sa.Column("service_trade_qualifying_appointment_on", sa.Date(), nullable=True),
        )


def downgrade() -> None:
    if _has_column(
        "monthly_route_run_timing_month",
        "service_trade_qualifying_appointment_on",
    ):
        op.drop_column(
            "monthly_route_run_timing_month",
            "service_trade_qualifying_appointment_on",
        )
