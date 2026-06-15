"""Add history_source to monthly_location_month.

Revision ID: z19a1b2c3d4e9
Revises: z18a1b2c3d4e8
Create Date: 2026-06-15

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "z19a1b2c3d4e9"
down_revision = "z18a1b2c3d4e8"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    if not inspect(bind).has_table(table_name):
        return False
    return column_name in {col["name"] for col in inspect(bind).get_columns(table_name)}


def upgrade():
    if _has_column("monthly_location_month", "history_source"):
        return
    op.add_column(
        "monthly_location_month",
        sa.Column("history_source", sa.String(length=32), nullable=True),
    )


def downgrade():
    if not _has_column("monthly_location_month", "history_source"):
        return
    op.drop_column("monthly_location_month", "history_source")
