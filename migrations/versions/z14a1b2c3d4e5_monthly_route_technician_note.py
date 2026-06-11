"""Add route-level technician_note to monthly_route.

Revision ID: z14a1b2c3d4e5
Revises: z13a1b2c3d4e5
Create Date: 2026-06-11

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "z14a1b2c3d4e5"
down_revision = "z13a1b2c3d4e5"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    return any(c["name"] == column_name for c in insp.get_columns(table_name))


def upgrade():
    if not _has_column("monthly_route", "technician_note"):
        op.add_column(
            "monthly_route",
            sa.Column("technician_note", sa.Text(), nullable=True),
        )


def downgrade():
    if _has_column("monthly_route", "technician_note"):
        op.drop_column("monthly_route", "technician_note")
