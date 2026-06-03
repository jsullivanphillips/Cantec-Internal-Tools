"""Add monthly_location_quarter_billed for billing team quarter tracker.

Revision ID: z2d3e4f5a6b7
Revises: z1c2d3e4f5a6
Create Date: 2026-06-03

"""

from alembic import op
import sqlalchemy as sa


revision = "z2d3e4f5a6b7"
down_revision = "z1c2d3e4f5a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "monthly_location_quarter_billed",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("location_id", sa.BigInteger(), nullable=False),
        sa.Column("year", sa.SmallInteger(), nullable=False),
        sa.Column("quarter", sa.SmallInteger(), nullable=False),
        sa.Column("billed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("billed_by_username", sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(
            ["location_id"],
            ["monthly_route_location.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "location_id",
            "year",
            "quarter",
            name="uq_monthly_location_quarter_billed_loc_year_q",
        ),
    )
    op.create_index(
        "ix_monthly_location_quarter_billed_location_id",
        "monthly_location_quarter_billed",
        ["location_id"],
        unique=False,
    )
    op.create_index(
        "ix_monthly_location_quarter_billed_year_quarter",
        "monthly_location_quarter_billed",
        ["year", "quarter"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_monthly_location_quarter_billed_year_quarter",
        table_name="monthly_location_quarter_billed",
    )
    op.drop_index(
        "ix_monthly_location_quarter_billed_location_id",
        table_name="monthly_location_quarter_billed",
    )
    op.drop_table("monthly_location_quarter_billed")
