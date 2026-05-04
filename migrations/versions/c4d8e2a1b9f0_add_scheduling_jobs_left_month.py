"""add scheduling_jobs_left_month for manual jobs-left KPIs

Revision ID: c4d8e2a1b9f0
Revises: e8f9a0b1c2d4
Create Date: 2026-05-04

"""
from alembic import op
import sqlalchemy as sa


revision = "c4d8e2a1b9f0"
down_revision = "e8f9a0b1c2d4"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "scheduling_jobs_left_month",
        sa.Column("year_month", sa.Date(), nullable=False),
        sa.Column("jobs_left", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_by", sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint("year_month"),
        sa.CheckConstraint("jobs_left >= 0", name="ck_sjlm_jobs_left_nonneg"),
    )


def downgrade():
    op.drop_table("scheduling_jobs_left_month")
