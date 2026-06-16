"""Drop monthly_key_bridge archive table (no longer used).

Revision ID: z21a1b2c3d4e1
Revises: z20a1b2c3d4e0
Create Date: 2026-06-16

"""

from alembic import op
from sqlalchemy import inspect


revision = "z21a1b2c3d4e1"
down_revision = "z20a1b2c3d4e0"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return inspect(op.get_bind()).has_table(name)


def upgrade():
    if _has_table("monthly_key_bridge"):
        op.drop_index("ix_monthly_key_bridge_st_site_id", table_name="monthly_key_bridge")
        op.drop_index("ix_monthly_key_bridge_legacy_location_id", table_name="monthly_key_bridge")
        op.drop_index("ix_monthly_key_bridge_key_id", table_name="monthly_key_bridge")
        op.drop_table("monthly_key_bridge")


def downgrade():
    raise NotImplementedError("monthly_key_bridge was removed intentionally")
