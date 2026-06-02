"""Office-dismissed prior-month out-of-order prep hint on stop-month rows.

Revision ID: z0b1c2d3e4f5
Revises: z0a1b2c3d4e5
Create Date: 2026-06-02

"""

from alembic import op
import sqlalchemy as sa


revision = "z0b1c2d3e4f5"
down_revision = "z0a1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monthly_testing_site_month",
        sa.Column(
            "prior_month_out_of_order_dismissed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.alter_column(
        "monthly_testing_site_month",
        "prior_month_out_of_order_dismissed",
        server_default=None,
    )


def downgrade() -> None:
    op.drop_column("monthly_testing_site_month", "prior_month_out_of_order_dismissed")
