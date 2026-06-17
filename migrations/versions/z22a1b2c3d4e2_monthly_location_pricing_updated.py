"""Add pricing_updated to monthly_location.

Revision ID: z22a1b2c3d4e2
Revises: z21a1b2c3d4e1
Create Date: 2026-06-17

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "z22a1b2c3d4e2"
down_revision = "z21a1b2c3d4e1"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return inspect(bind).has_table(name)


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    return column in {col["name"] for col in inspect(bind).get_columns(table)}


def upgrade() -> None:
    if not _has_table("monthly_location"):
        return
    if not _has_column("monthly_location", "pricing_updated"):
        op.add_column(
            "monthly_location",
            sa.Column("pricing_updated", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    if _has_table("monthly_location") and _has_column("monthly_location", "pricing_updated"):
        op.drop_column("monthly_location", "pricing_updated")
