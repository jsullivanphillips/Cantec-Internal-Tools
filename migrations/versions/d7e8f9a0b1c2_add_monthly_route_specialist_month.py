"""Add monthly_route_specialist_month table.

Revision ID: d7e8f9a0b1c2
Revises: c5d6e7f8a9b0

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "d7e8f9a0b1c2"
down_revision = "c5d6e7f8a9b0"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "monthly_route_specialist_month",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("monthly_route_id", sa.BigInteger(), nullable=False),
        sa.Column("month_first", sa.Date(), nullable=False),
        sa.Column("top_technicians", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("completed_jobs_attributed", sa.Integer(), nullable=False),
        sa.Column(
            "last_updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["monthly_route_id"],
            ["monthly_route.id"],
            name="fk_monthly_route_specialist_month_monthly_route_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "monthly_route_id",
            "month_first",
            name="uq_monthly_route_specialist_month_route_month",
        ),
    )
    op.create_index(
        "ix_monthly_route_specialist_month_route_month_first",
        "monthly_route_specialist_month",
        ["monthly_route_id", "month_first"],
        unique=False,
    )


def downgrade():
    op.drop_index(
        "ix_monthly_route_specialist_month_route_month_first",
        table_name="monthly_route_specialist_month",
    )
    op.drop_table("monthly_route_specialist_month")
