"""Add key_id / keys / barcode to monthly_testing_site (v2 keys canonical).

Revision ID: z2b2c3d4e5f7
Revises: z1b2c3d4e5f6
Create Date: 2026-05-11

"""

from alembic import op
import sqlalchemy as sa


revision = "z2b2c3d4e5f7"
down_revision = "z1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "monthly_testing_site",
        sa.Column("key_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "monthly_testing_site",
        sa.Column("keys", sa.Text(), nullable=True),
    )
    op.add_column(
        "monthly_testing_site",
        sa.Column("barcode", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_monthly_testing_site_key_id",
        "monthly_testing_site",
        ["key_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_monthly_testing_site_key_id_keys",
        "monthly_testing_site",
        "keys",
        ["key_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.execute(
        sa.text(
            """
            UPDATE monthly_testing_site ts
            SET
              key_id = loc.key_id,
              keys = loc.keys,
              barcode = loc.barcode
            FROM monthly_site ms
            JOIN monthly_route_location loc ON loc.id = ms.legacy_monthly_route_location_id
            WHERE ts.monthly_site_id = ms.id
            """
        )
    )


def downgrade():
    op.drop_constraint(
        "fk_monthly_testing_site_key_id_keys",
        "monthly_testing_site",
        type_="foreignkey",
    )
    op.drop_index("ix_monthly_testing_site_key_id", table_name="monthly_testing_site")
    op.drop_column("monthly_testing_site", "barcode")
    op.drop_column("monthly_testing_site", "keys")
    op.drop_column("monthly_testing_site", "key_id")
