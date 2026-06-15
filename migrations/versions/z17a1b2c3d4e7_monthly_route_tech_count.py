"""Add tech_count to monthly_route for expense breakdown.

Revision ID: z17a1b2c3d4e7
Revises: z16a1b2c3d4e6
Create Date: 2026-06-15

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "z17a1b2c3d4e7"
down_revision = "z16a1b2c3d4e6"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    return any(c["name"] == column_name for c in insp.get_columns(table_name))


def upgrade():
    if not _has_column("monthly_route", "tech_count"):
        op.add_column(
            "monthly_route",
            sa.Column("tech_count", sa.SmallInteger(), nullable=True),
        )


def downgrade():
    if _has_column("monthly_route", "tech_count"):
        op.drop_column("monthly_route", "tech_count")
