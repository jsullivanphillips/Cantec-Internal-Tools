"""Technician end-of-run debrief on monthly route runs.

Revision ID: z29a1b2c3d4e9
Revises: z28a1b2c3d4e8
Create Date: 2026-06-22

"""

from alembic import op
import sqlalchemy as sa


revision = "z29a1b2c3d4e9"
down_revision = "z28a1b2c3d4e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monthly_route_run",
        sa.Column("field_end_summary", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("monthly_route_run", "field_end_summary")
