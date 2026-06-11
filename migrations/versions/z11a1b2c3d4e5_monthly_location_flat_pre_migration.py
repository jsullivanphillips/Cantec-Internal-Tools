"""Prepare flat monthly_location migration state.

Revision ID: z11a1b2c3d4e5
Revises: z10a1b2c3d4e5
Create Date: 2026-06-09

This revision creates new flat-schema tables and columns required by
`app.scripts.migrate_monthly_flat_locations` without dropping legacy data.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "z11a1b2c3d4e5"
down_revision = "z10a1b2c3d4e5"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return inspect(bind).has_table(name)


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    return any(c["name"] == column for c in inspect(bind).get_columns(table))


def _has_fk_constraint(table: str, constraint_name: str) -> bool:
    bind = op.get_bind()
    return any(fk.get("name") == constraint_name for fk in inspect(bind).get_foreign_keys(table))


def upgrade() -> None:
    if _has_table("monthly_route_location_comment") and not _has_table("monthly_location_comment"):
        op.create_table(
            "monthly_location_comment",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("location_id", sa.BigInteger(), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("author_username", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["location_id"], ["monthly_location.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_monthly_location_comment_location_id", "monthly_location_comment", ["location_id"])

    if _has_table("monthly_testing_site_deficiency") and not _has_table("monthly_location_deficiency"):
        op.create_table(
            "monthly_location_deficiency",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("monthly_location_id", sa.BigInteger(), nullable=False),
            sa.Column("created_run_id", sa.BigInteger(), nullable=True),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("severity", sa.String(length=32), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("verification_notes", sa.Text(), nullable=True),
            sa.Column("reported_by_tech_id", sa.String(length=64), nullable=True),
            sa.Column("reported_by_tech_name", sa.String(length=255), nullable=True),
            sa.Column("last_edited_by_tech_id", sa.String(length=64), nullable=True),
            sa.Column("last_edited_by_tech_name", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["monthly_location_id"], ["monthly_location.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_monthly_location_deficiency_location_id", "monthly_location_deficiency", ["monthly_location_id"])

    if _has_table("monthly_stop_clock_event") and not _has_column("monthly_stop_clock_event", "monthly_location_month_id"):
        op.add_column(
            "monthly_stop_clock_event",
            sa.Column("monthly_location_month_id", sa.BigInteger(), nullable=True),
        )
        if not _has_fk_constraint("monthly_stop_clock_event", "fk_monthly_stop_clock_event_mlm_id"):
            op.create_foreign_key(
                "fk_monthly_stop_clock_event_mlm_id",
                "monthly_stop_clock_event",
                "monthly_location_month",
                ["monthly_location_month_id"],
                ["id"],
                ondelete="CASCADE",
            )


def downgrade() -> None:
    if _has_table("monthly_location_comment"):
        op.drop_index("ix_monthly_location_comment_location_id", table_name="monthly_location_comment")
        op.drop_table("monthly_location_comment")
    if _has_table("monthly_location_deficiency"):
        op.drop_index("ix_monthly_location_deficiency_location_id", table_name="monthly_location_deficiency")
        op.drop_table("monthly_location_deficiency")
    if _has_table("monthly_stop_clock_event") and _has_column("monthly_stop_clock_event", "monthly_location_month_id"):
        if _has_fk_constraint("monthly_stop_clock_event", "fk_monthly_stop_clock_event_mlm_id"):
            op.drop_constraint("fk_monthly_stop_clock_event_mlm_id", "monthly_stop_clock_event", type_="foreignkey")
        op.drop_column("monthly_stop_clock_event", "monthly_location_month_id")
