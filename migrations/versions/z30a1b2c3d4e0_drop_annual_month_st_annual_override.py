"""Drop annual_month from monthly locations; add annual test override on run months.

Revision ID: z30a1b2c3d4e0
Revises: z29a1b2c3d4e9
Create Date: 2026-06-24

"""

from alembic import op
import sqlalchemy as sa


revision = "z30a1b2c3d4e0"
down_revision = "z29a1b2c3d4e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monthly_location_month",
        sa.Column(
            "annual_test_override",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "monthly_location_month",
        sa.Column("annual_test_override_reason", sa.Text(), nullable=True),
    )
    op.drop_column("monthly_location_month", "annual_month")
    op.drop_column("monthly_location", "annual_month")
    op.drop_column("monthly_location", "annual_month_pending")
    op.drop_column("monthly_location", "annual_month_pending_submitted_at")
    op.drop_column("monthly_location", "annual_month_pending_submitted_by_name")


def downgrade() -> None:
    op.add_column(
        "monthly_location",
        sa.Column("annual_month", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "monthly_location",
        sa.Column("annual_month_pending", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "monthly_location",
        sa.Column(
            "annual_month_pending_submitted_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "monthly_location",
        sa.Column(
            "annual_month_pending_submitted_by_name",
            sa.String(length=255),
            nullable=True,
        ),
    )
    op.add_column(
        "monthly_location_month",
        sa.Column("annual_month", sa.String(length=32), nullable=True),
    )
    op.drop_column("monthly_location_month", "annual_test_override_reason")
    op.drop_column("monthly_location_month", "annual_test_override")
