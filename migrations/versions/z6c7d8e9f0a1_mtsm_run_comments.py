"""Run-only comments on ``monthly_testing_site_month`` (not library master).

Revision ID: z6c7d8e9f0a1
Revises: z5b6c7d8e9f0
Create Date: 2026-05-22

"""

from alembic import op
import sqlalchemy as sa


revision = "z6c7d8e9f0a1"
down_revision = "z5b6c7d8e9f0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monthly_testing_site_month",
        sa.Column("run_comments", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("monthly_testing_site_month", "run_comments")
