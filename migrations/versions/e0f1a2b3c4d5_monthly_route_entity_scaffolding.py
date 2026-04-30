"""monthly route entity scaffolding (no data backfill)

Adds ``monthly_route`` (empty until backfill) and nullable linkage columns on
``monthly_route_location`` for future FK + ServiceTrade location correlation.

Revision ID: e0f1a2b3c4d5
Revises: c8d9e0f1a2b3
Create Date: 2026-04-30

"""
from alembic import op
import sqlalchemy as sa


revision = "e0f1a2b3c4d5"
down_revision = "c8d9e0f1a2b3"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "monthly_route",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("route_number", sa.Integer(), nullable=False),
        sa.Column("weekday_iso", sa.SmallInteger(), nullable=False),
        sa.Column("week_occurrence", sa.SmallInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("route_number", name="uq_monthly_route_route_number"),
    )
    op.create_index("ix_monthly_route_weekday_occurrence", "monthly_route", ["weekday_iso", "week_occurrence"])

    op.add_column(
        "monthly_route_location",
        sa.Column("monthly_route_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "monthly_route_location",
        sa.Column("service_trade_location_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_monthly_route_location_monthly_route_id",
        "monthly_route_location",
        "monthly_route",
        ["monthly_route_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_monthly_route_location_monthly_route_id",
        "monthly_route_location",
        ["monthly_route_id"],
        unique=False,
    )
    op.create_index(
        "ix_monthly_route_location_service_trade_location_id",
        "monthly_route_location",
        ["service_trade_location_id"],
        unique=True,
    )


def downgrade():
    op.drop_index("ix_monthly_route_location_service_trade_location_id", table_name="monthly_route_location")
    op.drop_index("ix_monthly_route_location_monthly_route_id", table_name="monthly_route_location")
    op.drop_constraint("fk_monthly_route_location_monthly_route_id", "monthly_route_location", type_="foreignkey")
    op.drop_column("monthly_route_location", "service_trade_location_id")
    op.drop_column("monthly_route_location", "monthly_route_id")

    op.drop_index("ix_monthly_route_weekday_occurrence", table_name="monthly_route")
    op.drop_table("monthly_route")
