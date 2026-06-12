"""Add ServiceTrade linkage fields to monthly location deficiencies.

Revision ID: z16a1b2c3d4e6
Revises: z15a1b2c3d4e5
Create Date: 2026-06-12

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "z16a1b2c3d4e6"
down_revision = "z15a1b2c3d4e5"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    return any(c["name"] == column_name for c in insp.get_columns(table_name))


def upgrade() -> None:
    if not _has_column("monthly_location_deficiency", "service_line"):
        op.add_column(
            "monthly_location_deficiency",
            sa.Column("service_line", sa.String(length=64), nullable=True),
        )
    if not _has_column("monthly_location_deficiency", "service_trade_deficiency_id"):
        op.add_column(
            "monthly_location_deficiency",
            sa.Column("service_trade_deficiency_id", sa.BigInteger(), nullable=True),
        )
        op.create_index(
            "ix_monthly_location_deficiency_st_deficiency_id",
            "monthly_location_deficiency",
            ["service_trade_deficiency_id"],
            unique=False,
        )


def downgrade() -> None:
    if _has_column("monthly_location_deficiency", "service_trade_deficiency_id"):
        op.drop_index(
            "ix_monthly_location_deficiency_st_deficiency_id",
            table_name="monthly_location_deficiency",
        )
        op.drop_column("monthly_location_deficiency", "service_trade_deficiency_id")
    if _has_column("monthly_location_deficiency", "service_line"):
        op.drop_column("monthly_location_deficiency", "service_line")
