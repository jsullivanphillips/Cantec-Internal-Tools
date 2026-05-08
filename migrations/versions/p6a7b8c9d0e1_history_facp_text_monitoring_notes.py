"""monthly_route_test_history: TEXT facp + monitoring_notes snapshot.

``facp`` snapshots are often multi-line technician sheet text (mirrors
``MonthlyRouteLocation.facp_detail``). ``monitoring_notes`` stores the full
Monitoring column from CSV imports so the worksheet can show signals / acct #
when there is no ``MonitoringCompany`` FK match.

Revision ID: p6a7b8c9d0e1
Revises: o4d5e6f7a8b9
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "p6a7b8c9d0e1"
down_revision = "o4d5e6f7a8b9"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    return any(c["name"] == column_name for c in insp.get_columns(table_name))


def upgrade():
    bind = op.get_bind()
    if (
        _has_column("monthly_route_test_history", "facp")
        and getattr(bind.dialect, "name", "") == "postgresql"
    ):
        op.alter_column(
            "monthly_route_test_history",
            "facp",
            existing_type=sa.String(length=255),
            type_=sa.Text(),
            existing_nullable=True,
        )
    if not _has_column("monthly_route_test_history", "monitoring_notes"):
        op.add_column(
            "monthly_route_test_history",
            sa.Column("monitoring_notes", sa.Text(), nullable=True),
        )


def downgrade():
    bind = op.get_bind()
    if _has_column("monthly_route_test_history", "monitoring_notes"):
        op.drop_column("monthly_route_test_history", "monitoring_notes")
    if (
        _has_column("monthly_route_test_history", "facp")
        and getattr(bind.dialect, "name", "") == "postgresql"
    ):
        op.alter_column(
            "monthly_route_test_history",
            "facp",
            existing_type=sa.Text(),
            type_=sa.String(length=255),
            existing_nullable=True,
        )
