"""Nullable FK from monthly_route_location to keys (canonical key asset link).

Revision ID: a3c4d5e6f7a8
Revises: f1b2c3d4e5f6

"""

from alembic import op
import sqlalchemy as sa


revision = "a3c4d5e6f7a8"
down_revision = "f1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "monthly_route_location",
        sa.Column("key_id", sa.BigInteger(), nullable=True),
    )
    op.create_index(
        "ix_monthly_route_location_key_id",
        "monthly_route_location",
        ["key_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_monthly_route_location_key_id_keys",
        "monthly_route_location",
        "keys",
        ["key_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade():
    op.drop_constraint(
        "fk_monthly_route_location_key_id_keys",
        "monthly_route_location",
        type_="foreignkey",
    )
    op.drop_index("ix_monthly_route_location_key_id", table_name="monthly_route_location")
    op.drop_column("monthly_route_location", "key_id")
