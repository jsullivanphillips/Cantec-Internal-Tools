"""Allow multiple monthly locations to share one ServiceTrade site id.

Revision ID: z13a1b2c3d4e5
Revises: z12a1b2c3d4e5
Create Date: 2026-06-10

"""

from alembic import op
from sqlalchemy import inspect


revision = "z13a1b2c3d4e5"
down_revision = "z12a1b2c3d4e5"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return inspect(bind).has_table(name)


def _unique_indexes_for_column(table: str, column: str) -> list[str]:
    bind = op.get_bind()
    inspector = inspect(bind)
    names: list[str] = []
    for index in inspector.get_indexes(table):
        if index.get("unique") and column in (index.get("column_names") or []):
            name = index.get("name")
            if name:
                names.append(name)
    return names


def upgrade() -> None:
    if not _has_table("monthly_location"):
        return
    for index_name in _unique_indexes_for_column(
        "monthly_location",
        "service_trade_site_location_id",
    ):
        op.drop_index(index_name, table_name="monthly_location")
    op.create_index(
        "ix_monthly_location_service_trade_site_location_id",
        "monthly_location",
        ["service_trade_site_location_id"],
        unique=False,
    )


def downgrade() -> None:
    if not _has_table("monthly_location"):
        return
    for index_name in _unique_indexes_for_column(
        "monthly_location",
        "service_trade_site_location_id",
    ):
        op.drop_index(index_name, table_name="monthly_location")
    op.create_index(
        "ix_monthly_location_service_trade_site_location_id",
        "monthly_location",
        ["service_trade_site_location_id"],
        unique=True,
    )
