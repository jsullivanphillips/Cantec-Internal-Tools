"""MonthlyRouteTestHistory: month-preserved testing procedures and tech notes from sheet import.

Revision ID: l1a2b3c4d5e8
Revises: k0a1b2c3d4e7

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "l1a2b3c4d5e8"
down_revision = "k0a1b2c3d4e7"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    return any(c["name"] == column_name for c in insp.get_columns(table_name))


def upgrade():
    if not _has_column("monthly_route_test_history", "testing_procedures"):
        op.add_column(
            "monthly_route_test_history",
            sa.Column("testing_procedures", sa.Text(), nullable=True),
        )
    if not _has_column("monthly_route_test_history", "inspection_tech_notes"):
        op.add_column(
            "monthly_route_test_history",
            sa.Column("inspection_tech_notes", sa.Text(), nullable=True),
        )


def downgrade():
    if _has_column("monthly_route_test_history", "inspection_tech_notes"):
        op.drop_column("monthly_route_test_history", "inspection_tech_notes")
    if _has_column("monthly_route_test_history", "testing_procedures"):
        op.drop_column("monthly_route_test_history", "testing_procedures")
