"""MonthlyRouteTestHistory: sheet time-in/out raw + parsed visit duration.

Revision ID: j0a1b2c3d4e6
Revises: i0a1b2c3d4e5

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "j0a1b2c3d4e6"
down_revision = "i0a1b2c3d4e5"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    return any(c["name"] == column_name for c in insp.get_columns(table_name))


def upgrade():
    if not _has_column("monthly_route_test_history", "sheet_time_in_raw"):
        op.add_column(
            "monthly_route_test_history",
            sa.Column("sheet_time_in_raw", sa.String(length=64), nullable=True),
        )
    if not _has_column("monthly_route_test_history", "sheet_time_out_raw"):
        op.add_column(
            "monthly_route_test_history",
            sa.Column("sheet_time_out_raw", sa.String(length=64), nullable=True),
        )
    if not _has_column("monthly_route_test_history", "sheet_visit_duration_minutes"):
        op.add_column(
            "monthly_route_test_history",
            sa.Column("sheet_visit_duration_minutes", sa.Integer(), nullable=True),
        )


def downgrade():
    if _has_column("monthly_route_test_history", "sheet_visit_duration_minutes"):
        op.drop_column("monthly_route_test_history", "sheet_visit_duration_minutes")
    if _has_column("monthly_route_test_history", "sheet_time_out_raw"):
        op.drop_column("monthly_route_test_history", "sheet_time_out_raw")
    if _has_column("monthly_route_test_history", "sheet_time_in_raw"):
        op.drop_column("monthly_route_test_history", "sheet_time_in_raw")
