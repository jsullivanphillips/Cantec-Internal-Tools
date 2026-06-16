"""Add access_instructions to monthly_location.

Revision ID: z20a1b2c3d4e0
Revises: z19a1b2c3d4e9
Create Date: 2026-06-16

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "z20a1b2c3d4e0"
down_revision = "z19a1b2c3d4e9"
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
    if not _has_column("monthly_location", "access_instructions"):
        op.add_column(
            "monthly_location",
            sa.Column("access_instructions", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    if _has_table("monthly_location") and _has_column("monthly_location", "access_instructions"):
        op.drop_column("monthly_location", "access_instructions")
