"""Monthly technician worksheet: time fields + field-level audit events.

Revision ID: m2b3c4d5e6f7
Revises: l1a2b3c4d5e8
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "m2b3c4d5e6f7"
down_revision = "l1a2b3c4d5e8"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    return any(c["name"] == column_name for c in insp.get_columns(table_name))


def _has_table(table_name: str) -> bool:
    return inspect(op.get_bind()).has_table(table_name)


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

    if not _has_table("monthly_route_worksheet_audit_event"):
        op.create_table(
            "monthly_route_worksheet_audit_event",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("monthly_route_id", sa.BigInteger(), nullable=False),
            sa.Column("location_id", sa.BigInteger(), nullable=False),
            sa.Column("history_row_id", sa.BigInteger(), nullable=False),
            sa.Column("month_date", sa.Date(), nullable=False),
            sa.Column("field_name", sa.String(length=64), nullable=False),
            sa.Column("old_value", sa.JSON(), nullable=True),
            sa.Column("new_value", sa.JSON(), nullable=True),
            sa.Column("source", sa.String(length=32), nullable=False, server_default="technician_app"),
            sa.Column("changed_by_username", sa.String(length=255), nullable=True),
            sa.Column("changed_by_name", sa.String(length=255), nullable=True),
            sa.Column("client_mutation_id", sa.String(length=64), nullable=True),
            sa.Column("changed_at_client", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "changed_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.ForeignKeyConstraint(["history_row_id"], ["monthly_route_test_history.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["location_id"], ["monthly_route_location.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["monthly_route_id"], ["monthly_route.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("client_mutation_id", name="uq_mr_worksheet_audit_client_mutation"),
        )
        op.create_index(
            "ix_mr_worksheet_audit_route_month",
            "monthly_route_worksheet_audit_event",
            ["monthly_route_id", "month_date", "changed_at"],
            unique=False,
        )
        op.create_index(
            "ix_mr_worksheet_audit_location_month",
            "monthly_route_worksheet_audit_event",
            ["location_id", "month_date", "changed_at"],
            unique=False,
        )
        op.create_index(
            "ix_mr_worksheet_audit_history_field",
            "monthly_route_worksheet_audit_event",
            ["history_row_id", "field_name", "changed_at"],
            unique=False,
        )


def downgrade():
    if _has_table("monthly_route_worksheet_audit_event"):
        op.drop_index("ix_mr_worksheet_audit_history_field", table_name="monthly_route_worksheet_audit_event")
        op.drop_index("ix_mr_worksheet_audit_location_month", table_name="monthly_route_worksheet_audit_event")
        op.drop_index("ix_mr_worksheet_audit_route_month", table_name="monthly_route_worksheet_audit_event")
        op.drop_table("monthly_route_worksheet_audit_event")
    if _has_column("monthly_route_test_history", "sheet_time_out_raw"):
        op.drop_column("monthly_route_test_history", "sheet_time_out_raw")
    if _has_column("monthly_route_test_history", "sheet_time_in_raw"):
        op.drop_column("monthly_route_test_history", "sheet_time_in_raw")
