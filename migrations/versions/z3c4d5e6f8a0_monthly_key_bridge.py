"""Add monthly_key_bridge (archive of key-to-site links before monthly wipes).

Revision ID: z3c4d5e6f8a0
Revises: z2b2c3d4e5f7
Create Date: 2026-05-11

"""

from alembic import op
import sqlalchemy as sa


revision = "z3c4d5e6f8a0"
down_revision = "z2b2c3d4e5f7"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "monthly_key_bridge",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column(
            "key_id",
            sa.BigInteger(),
            nullable=False,
        ),
        sa.Column("service_trade_site_location_id", sa.BigInteger(), nullable=True),
        sa.Column("address_normalized", sa.String(length=255), nullable=True),
        sa.Column(
            "property_management_company_normalized",
            sa.String(length=255),
            nullable=True,
        ),
        sa.Column("building_normalized", sa.String(length=255), nullable=True),
        sa.Column("display_address", sa.String(length=255), nullable=True),
        sa.Column("legacy_monthly_route_location_id", sa.BigInteger(), nullable=True),
        sa.Column("legacy_testing_site_id", sa.BigInteger(), nullable=True),
        sa.Column("keys_text", sa.Text(), nullable=True),
        sa.Column("barcode_text", sa.String(length=64), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column(
            "exported_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["key_id"],
            ["keys.id"],
            name="fk_monthly_key_bridge_key_id_keys",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_monthly_key_bridge_key_id",
        "monthly_key_bridge",
        ["key_id"],
        unique=False,
    )
    op.create_index(
        "ix_monthly_key_bridge_legacy_location_id",
        "monthly_key_bridge",
        ["legacy_monthly_route_location_id"],
        unique=False,
    )
    op.create_index(
        "ix_monthly_key_bridge_st_site_id",
        "monthly_key_bridge",
        ["service_trade_site_location_id"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_monthly_key_bridge_st_site_id", table_name="monthly_key_bridge")
    op.drop_index("ix_monthly_key_bridge_legacy_location_id", table_name="monthly_key_bridge")
    op.drop_index("ix_monthly_key_bridge_key_id", table_name="monthly_key_bridge")
    op.drop_table("monthly_key_bridge")
