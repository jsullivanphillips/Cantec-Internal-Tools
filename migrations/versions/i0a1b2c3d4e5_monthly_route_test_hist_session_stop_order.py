"""MonthlyRouteTestHistory: sheet stop order at capture for session ledger.

Revision ID: i0a1b2c3d4e5
Revises: h9a0b1c2d3e4

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "i0a1b2c3d4e5"
down_revision = "h9a0b1c2d3e4"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    return any(c["name"] == column_name for c in insp.get_columns(table_name))


def upgrade():
    if not _has_column("monthly_route_test_history", "session_route_stop_order"):
        op.add_column(
            "monthly_route_test_history",
            sa.Column("session_route_stop_order", sa.SmallInteger(), nullable=True),
        )


def downgrade():
    if _has_column("monthly_route_test_history", "session_route_stop_order"):
        op.drop_column("monthly_route_test_history", "session_route_stop_order")
