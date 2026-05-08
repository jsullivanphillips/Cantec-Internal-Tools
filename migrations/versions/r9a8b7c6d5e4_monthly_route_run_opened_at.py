"""MonthlyRouteRun: opened_at for worksheet materialization vs started_at field run start.

Revision ID: r9a8b7c6d5e4
Revises: p6a7b8c9d0e1

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision = "r9a8b7c6d5e4"
down_revision = "p6a7b8c9d0e1"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    return any(c["name"] == column_name for c in insp.get_columns(table_name))


def upgrade():
    if not _has_column("monthly_route_run", "opened_at"):
        op.add_column(
            "monthly_route_run",
            sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        )
    op.execute(
        text(
            "UPDATE monthly_route_run SET opened_at = COALESCE(started_at, created_at) "
            "WHERE opened_at IS NULL"
        )
    )


def downgrade():
    if _has_column("monthly_route_run", "opened_at"):
        op.drop_column("monthly_route_run", "opened_at")
