"""MonthlyRouteRun workflow timestamps (prepare, field end, office review).

Revision ID: a9b0c1d2e3f4
Revises: z8e9f0a1b2c3

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision = "a9b0c1d2e3f4"
down_revision = "z8e9f0a1b2c3"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    return any(c["name"] == column_name for c in insp.get_columns(table_name))


def upgrade() -> None:
    if not _has_column("monthly_route_run", "prepared_at"):
        op.add_column(
            "monthly_route_run",
            sa.Column("prepared_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_column("monthly_route_run", "prepared_by"):
        op.add_column(
            "monthly_route_run",
            sa.Column("prepared_by", sa.String(length=128), nullable=True),
        )
    if not _has_column("monthly_route_run", "field_ended_at"):
        op.add_column(
            "monthly_route_run",
            sa.Column("field_ended_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_column("monthly_route_run", "office_review_completed_at"):
        op.add_column(
            "monthly_route_run",
            sa.Column("office_review_completed_at", sa.DateTime(timezone=True), nullable=True),
        )
    if not _has_column("monthly_route_run", "office_review_completed_by"):
        op.add_column(
            "monthly_route_run",
            sa.Column("office_review_completed_by", sa.String(length=128), nullable=True),
        )

    op.execute(
        text(
            """
            UPDATE monthly_route_run
            SET prepared_at = COALESCE(opened_at, created_at)
            WHERE prepared_at IS NULL
              AND (started_at IS NOT NULL OR opened_at IS NOT NULL)
            """
        )
    )
    op.execute(
        text(
            """
            UPDATE monthly_route_run
            SET field_ended_at = COALESCE(completed_at, started_at),
                office_review_completed_at = COALESCE(completed_at, started_at)
            WHERE completed_at IS NOT NULL
              AND field_ended_at IS NULL
            """
        )
    )


def downgrade() -> None:
    for col in (
        "office_review_completed_by",
        "office_review_completed_at",
        "field_ended_at",
        "prepared_by",
        "prepared_at",
    ):
        if _has_column("monthly_route_run", col):
            op.drop_column("monthly_route_run", col)
