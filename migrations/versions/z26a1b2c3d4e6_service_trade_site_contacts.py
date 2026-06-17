"""ServiceTrade site contacts cache for linked monthly library locations.

Revision ID: z26a1b2c3d4e6
Revises: z25a1b2c3d4e5
Create Date: 2026-06-17

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "z26a1b2c3d4e6"
down_revision = "z25a1b2c3d4e5"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return inspect(op.get_bind()).has_table(table_name)


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    return column_name in {col["name"] for col in inspect(op.get_bind()).get_columns(table_name)}


def upgrade() -> None:
    if not _has_table("service_trade_site_contact"):
        op.create_table(
            "service_trade_site_contact",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("service_trade_site_location_id", sa.BigInteger(), nullable=False),
            sa.Column("service_trade_contact_id", sa.BigInteger(), nullable=False),
            sa.Column("first_name", sa.String(length=255), nullable=True),
            sa.Column("last_name", sa.String(length=255), nullable=True),
            sa.Column("email", sa.String(length=255), nullable=True),
            sa.Column("phone", sa.String(length=64), nullable=True),
            sa.Column("mobile", sa.String(length=64), nullable=True),
            sa.Column("alternate_phone", sa.String(length=255), nullable=True),
            sa.Column("contact_type", sa.String(length=64), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=True),
            sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column(
                "synced_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "service_trade_site_location_id",
                "service_trade_contact_id",
                name="uq_st_site_contact_location_contact",
            ),
        )
        op.create_index(
            "ix_st_site_contact_location_id",
            "service_trade_site_contact",
            ["service_trade_site_location_id"],
            unique=False,
        )

    if not _has_column("monthly_location", "service_trade_contacts_synced_at"):
        op.add_column(
            "monthly_location",
            sa.Column("service_trade_contacts_synced_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_column("monthly_location", "service_trade_has_contact_email"):
        op.add_column(
            "monthly_location",
            sa.Column("service_trade_has_contact_email", sa.Boolean(), nullable=True),
        )
    if not _has_column("monthly_location", "service_trade_has_contact_phone"):
        op.add_column(
            "monthly_location",
            sa.Column("service_trade_has_contact_phone", sa.Boolean(), nullable=True),
        )


def downgrade() -> None:
    if _has_column("monthly_location", "service_trade_has_contact_phone"):
        op.drop_column("monthly_location", "service_trade_has_contact_phone")
    if _has_column("monthly_location", "service_trade_has_contact_email"):
        op.drop_column("monthly_location", "service_trade_has_contact_email")
    if _has_column("monthly_location", "service_trade_contacts_synced_at"):
        op.drop_column("monthly_location", "service_trade_contacts_synced_at")
    if _has_table("service_trade_site_contact"):
        op.drop_index("ix_st_site_contact_location_id", table_name="service_trade_site_contact")
        op.drop_table("service_trade_site_contact")
