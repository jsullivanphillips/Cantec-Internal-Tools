"""Cache unreleased annual inspection flag on monthly_location_month.

Revision ID: z32a1b2c3d4e2
Revises: z31a1b2c3d4e1
Create Date: 2026-06-26

"""

from alembic import op
import sqlalchemy as sa


revision = "z32a1b2c3d4e2"
down_revision = "z31a1b2c3d4e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monthly_location_month",
        sa.Column("st_has_unreleased_annual_in_month", sa.Boolean(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("monthly_location_month", "st_has_unreleased_annual_in_month")
