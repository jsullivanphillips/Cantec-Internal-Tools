"""Add free-form tags to monthly library locations.

Revision ID: z27a1b2c3d4e7
Revises: z26a1b2c3d4e6
Create Date: 2026-06-18

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "z27a1b2c3d4e7"
down_revision = "z26a1b2c3d4e6"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    if not inspect(bind).has_table(table_name):
        return False
    return column_name in {col["name"] for col in inspect(bind).get_columns(table_name)}


def upgrade() -> None:
    if not _has_column("monthly_location", "tags_json"):
        op.add_column(
            "monthly_location",
            sa.Column("tags_json", sa.JSON(), nullable=True),
        )


def downgrade() -> None:
    if _has_column("monthly_location", "tags_json"):
        op.drop_column("monthly_location", "tags_json")
