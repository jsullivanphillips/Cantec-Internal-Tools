"""Persistent monitoring notes on ``monthly_testing_site``.

Revision ID: z7d8e9f0a1b2
Revises: z6c7d8e9f0a1
Create Date: 2026-05-25

"""

from alembic import op
import sqlalchemy as sa


revision = "z7d8e9f0a1b2"
down_revision = "z6c7d8e9f0a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monthly_testing_site",
        sa.Column("monitoring_notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("monthly_testing_site", "monitoring_notes")
