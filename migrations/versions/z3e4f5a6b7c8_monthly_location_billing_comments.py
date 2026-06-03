"""Add billing_comments to monthly_route_location.

Revision ID: z3e4f5a6b7c8
Revises: z2d3e4f5a6b7
Create Date: 2026-06-03

"""

from alembic import op
import sqlalchemy as sa


revision = "z3e4f5a6b7c8"
down_revision = "z2d3e4f5a6b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monthly_route_location",
        sa.Column("billing_comments", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("monthly_route_location", "billing_comments")
