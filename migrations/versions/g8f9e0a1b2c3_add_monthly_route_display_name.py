"""Add optional display_name to monthly_route.

Revision ID: g8f9e0a1b2c3
Revises: f8e9a0b1c2d3

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "g8f9e0a1b2c3"
down_revision = "f8e9a0b1c2d3"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    return any(c["name"] == column_name for c in insp.get_columns(table_name))


def upgrade():
    if not _has_column("monthly_route", "display_name"):
        op.add_column(
            "monthly_route",
            sa.Column("display_name", sa.String(length=255), nullable=True),
        )


def downgrade():
    if _has_column("monthly_route", "display_name"):
        op.drop_column("monthly_route", "display_name")
