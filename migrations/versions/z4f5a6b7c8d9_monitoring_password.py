"""Per-site monitoring password on library master and run-month snapshot.

Revision ID: z4f5a6b7c8d9
Revises: z3e4f5a6b7c8
Create Date: 2026-06-08

"""

from alembic import op
import sqlalchemy as sa


revision = "z4f5a6b7c8d9"
down_revision = "z3e4f5a6b7c8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monthly_testing_site",
        sa.Column("monitoring_password", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "monthly_testing_site_month",
        sa.Column("monitoring_password", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("monthly_testing_site_month", "monitoring_password")
    op.drop_column("monthly_testing_site", "monitoring_password")
