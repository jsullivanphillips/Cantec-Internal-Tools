"""Replaced-part review flag on monthly_location_month.

Revision ID: z33a1b2c3d4e3
Revises: z32a1b2c3d4e2
Create Date: 2026-06-26

"""

from alembic import op
import sqlalchemy as sa


revision = "z33a1b2c3d4e3"
down_revision = "z32a1b2c3d4e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monthly_location_month",
        sa.Column(
            "replaced_part_flag",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.alter_column("monthly_location_month", "replaced_part_flag", server_default=None)


def downgrade() -> None:
    op.drop_column("monthly_location_month", "replaced_part_flag")
