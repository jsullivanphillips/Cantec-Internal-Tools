"""service trade route vs site location ids

- ``monthly_route.service_trade_route_location_id``: ServiceTrade *route*
  pseudo-location (clock-in / specialist aggregation), not a street address.
- Rename ``monthly_route_location.service_trade_location_id`` →
  ``service_trade_site_location_id`` for optional real-building ↔ ST mapping.

Revision ID: f1b2c3d4e5f6
Revises: e0f1a2b3c4d5

"""
from alembic import op
import sqlalchemy as sa


revision = "f1b2c3d4e5f6"
down_revision = "e0f1a2b3c4d5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "monthly_route",
        sa.Column("service_trade_route_location_id", sa.BigInteger(), nullable=True),
    )
    op.create_index(
        "ix_monthly_route_service_trade_route_location_id",
        "monthly_route",
        ["service_trade_route_location_id"],
        unique=True,
    )

    op.execute(
        sa.text(
            "ALTER INDEX ix_monthly_route_location_service_trade_location_id "
            "RENAME TO ix_monthly_route_location_service_trade_site_location_id"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE monthly_route_location "
            "RENAME COLUMN service_trade_location_id TO service_trade_site_location_id"
        )
    )


def downgrade():
    op.execute(
        sa.text(
            "ALTER TABLE monthly_route_location "
            "RENAME COLUMN service_trade_site_location_id TO service_trade_location_id"
        )
    )
    op.execute(
        sa.text(
            "ALTER INDEX ix_monthly_route_location_service_trade_site_location_id "
            "RENAME TO ix_monthly_route_location_service_trade_location_id"
        )
    )

    op.drop_index("ix_monthly_route_service_trade_route_location_id", table_name="monthly_route")
    op.drop_column("monthly_route", "service_trade_route_location_id")
