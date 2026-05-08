"""Make monthly_route_test_history.result_status nullable for not-yet-tested rows.

Revision ID: n3c4d5e6f7a8
Revises: m2b3c4d5e6f7
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "n3c4d5e6f7a8"
down_revision = "m2b3c4d5e6f7"
branch_labels = None
depends_on = None


def _column_is_nullable(table_name: str, column_name: str) -> bool | None:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return None
    for col in insp.get_columns(table_name):
        if col["name"] == column_name:
            return bool(col.get("nullable"))
    return None


def upgrade():
    nullable = _column_is_nullable("monthly_route_test_history", "result_status")
    if nullable is False:
        op.alter_column(
            "monthly_route_test_history",
            "result_status",
            existing_type=sa.String(length=32),
            nullable=True,
        )


def downgrade():
    nullable = _column_is_nullable("monthly_route_test_history", "result_status")
    if nullable is True:
        # Backfill any NULL rows so the NOT NULL constraint can be re-applied without error.
        op.execute(
            "UPDATE monthly_route_test_history SET result_status = 'tested' "
            "WHERE result_status IS NULL"
        )
        op.alter_column(
            "monthly_route_test_history",
            "result_status",
            existing_type=sa.String(length=32),
            nullable=False,
        )
