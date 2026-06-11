"""Add building_name to monthly_location.

Revision ID: z12a1b2c3d4e5
Revises: z6f7e8d9c0b1
Create Date: 2026-06-10

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "z12a1b2c3d4e5"
down_revision = "z6f7e8d9c0b1"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return inspect(bind).has_table(name)


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    return column in [col["name"] for col in inspect(bind).get_columns(table)]


def upgrade() -> None:
    if not _has_table("monthly_location"):
        return
    if not _has_column("monthly_location", "building_name"):
        op.add_column(
            "monthly_location",
            sa.Column("building_name", sa.String(length=255), nullable=True),
        )


def downgrade() -> None:
    if _has_table("monthly_location") and _has_column("monthly_location", "building_name"):
        op.drop_column("monthly_location", "building_name")
