"""Add route_tested_on to monthly_route_specialist_month.

Revision ID: e8f9a0b1c2d4
Revises: d7e8f9a0b1c2

"""

from alembic import op
import sqlalchemy as sa


revision = "e8f9a0b1c2d4"
down_revision = "d7e8f9a0b1c2"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "monthly_route_specialist_month",
        sa.Column("route_tested_on", sa.Date(), nullable=True),
    )


def downgrade():
    op.drop_column("monthly_route_specialist_month", "route_tested_on")
