"""Cut over child tables to monthly_location and drop legacy monthly tables.

Revision ID: z11b2c3d4e5f6
Revises: z11a1b2c3d4e5
Create Date: 2026-06-09

This revision requires the flat-location data migration to be complete before the final clock-event cutover.
Run ``flask db upgrade z11a1b2c3d4e5`` and then
``python -m app.scripts.migrate_monthly_flat_locations --execute`` before upgrading to this revision.
If ``monthly_stop_clock_event.monthly_location_month_id`` still contains nulls, this revision will abort with an explicit error.

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "z11b2c3d4e5f6"
down_revision = "z11a1b2c3d4e5"
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


def _has_index(table: str, index_name: str) -> bool:
    bind = op.get_bind()
    return any(idx.get("name") == index_name for idx in inspect(bind).get_indexes(table))


def _count_nulls(table: str, column: str) -> int:
    bind = op.get_bind()
    result = bind.execute(sa.text(f"SELECT COUNT(*) FROM {table} WHERE {column} IS NULL"))
    return int(result.scalar() or 0)


def upgrade() -> None:
    # Clock events: retarget to monthly_location_month
    if _has_table("monthly_stop_clock_event") and (
        _has_column("monthly_stop_clock_event", "monthly_testing_site_month_id")
        or _has_column("monthly_stop_clock_event", "monthly_location_month_id")
    ):
        if not _has_column("monthly_stop_clock_event", "monthly_location_month_id"):
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
        if _has_fk_constraint("monthly_stop_clock_event", "monthly_stop_clock_event_monthly_testing_site_month_id_fkey"):
            op.drop_constraint(
                "monthly_stop_clock_event_monthly_testing_site_month_id_fkey",
                "monthly_stop_clock_event",
                type_="foreignkey",
            )
        if _has_column("monthly_stop_clock_event", "monthly_testing_site_month_id"):
            if _count_nulls("monthly_stop_clock_event", "monthly_location_month_id") > 0:
                raise RuntimeError(
                    "monthly_stop_clock_event.monthly_location_month_id contains null values. "
                    "Run python -m app.scripts.migrate_monthly_flat_locations --execute before this cutover revision."
                )
            op.drop_column("monthly_stop_clock_event", "monthly_testing_site_month_id")
        if _has_column("monthly_stop_clock_event", "monthly_location_month_id"):
            if _count_nulls("monthly_stop_clock_event", "monthly_location_month_id") == 0:
                op.alter_column(
                    "monthly_stop_clock_event",
                    "monthly_location_month_id",
                    existing_type=sa.BigInteger(),
                    nullable=False,
                )
            elif not _has_column("monthly_stop_clock_event", "monthly_testing_site_month_id"):
                raise RuntimeError(
                    "monthly_stop_clock_event.monthly_location_month_id contains null values and the legacy "
                    "monthly_testing_site_month_id column is already gone. This indicates an incomplete data migration."
                )

    # Deficiencies: rename table
    if _has_table("monthly_testing_site_deficiency"):
        if _has_table("monthly_location_deficiency"):
            if _has_index("monthly_testing_site_deficiency", "ix_monthly_testing_site_deficiency_created_run_id"):
                op.drop_index(
                    "ix_monthly_testing_site_deficiency_created_run_id",
                    table_name="monthly_testing_site_deficiency",
                )
            if _has_index("monthly_testing_site_deficiency", "ix_monthly_testing_site_deficiency_site_id"):
                op.drop_index(
                    "ix_monthly_testing_site_deficiency_site_id",
                    table_name="monthly_testing_site_deficiency",
                )
            op.drop_table("monthly_testing_site_deficiency")
        else:
            if _has_fk_constraint(
                "monthly_testing_site_deficiency",
                "monthly_testing_site_deficiency_monthly_testing_site_id_fkey",
            ):
                op.drop_constraint(
                    "monthly_testing_site_deficiency_monthly_testing_site_id_fkey",
                    "monthly_testing_site_deficiency",
                    type_="foreignkey",
                )
            op.rename_table("monthly_testing_site_deficiency", "monthly_location_deficiency")
            op.alter_column(
                "monthly_location_deficiency",
                "monthly_testing_site_id",
                new_column_name="monthly_location_id",
                existing_type=sa.BigInteger(),
            )
            if _has_index("monthly_location_deficiency", "ix_monthly_testing_site_deficiency_site_id"):
                op.drop_index(
                    "ix_monthly_testing_site_deficiency_site_id",
                    table_name="monthly_location_deficiency",
                )
            if not _has_index("monthly_location_deficiency", "ix_monthly_location_deficiency_location_id"):
                op.create_index(
                    "ix_monthly_location_deficiency_location_id",
                    "monthly_location_deficiency",
                    ["monthly_location_id"],
                )
            if not _has_fk_constraint("monthly_location_deficiency", "fk_monthly_location_deficiency_location_id"):
                op.create_foreign_key(
                    "fk_monthly_location_deficiency_location_id",
                    "monthly_location_deficiency",
                    "monthly_location",
                    ["monthly_location_id"],
                    ["id"],
                    ondelete="CASCADE",
                )

    # Quarter billed FK
    if _has_table("monthly_location_quarter_billed"):
        if _has_fk_constraint("monthly_location_quarter_billed", "monthly_location_quarter_billed_location_id_fkey"):
            op.drop_constraint(
                "monthly_location_quarter_billed_location_id_fkey",
                "monthly_location_quarter_billed",
                type_="foreignkey",
            )
        op.create_foreign_key(
            "fk_monthly_location_quarter_billed_location_id",
            "monthly_location_quarter_billed",
            "monthly_location",
            ["location_id"],
            ["id"],
            ondelete="CASCADE",
        )

    # Tickets
    if _has_table("monthly_location_ticket") and _has_column(
        "monthly_location_ticket", "monthly_route_location_id"
    ):
        op.alter_column(
            "monthly_location_ticket",
            "monthly_route_location_id",
            new_column_name="monthly_location_id",
            existing_type=sa.BigInteger(),
        )
        if _has_fk_constraint("monthly_location_ticket", "monthly_location_ticket_monthly_route_location_id_fkey"):
            op.drop_constraint(
                "monthly_location_ticket_monthly_route_location_id_fkey",
                "monthly_location_ticket",
                type_="foreignkey",
            )
        op.create_foreign_key(
            "fk_monthly_location_ticket_location_id",
            "monthly_location_ticket",
            "monthly_location",
            ["monthly_location_id"],
            ["id"],
            ondelete="CASCADE",
        )

    # Comments
    if _has_table("monthly_route_location_comment"):
        if _has_table("monthly_location_comment"):
            if _has_index("monthly_route_location_comment", "ix_monthly_route_location_comment_location_id"):
                op.drop_index(
                    "ix_monthly_route_location_comment_location_id",
                    table_name="monthly_route_location_comment",
                )
            op.drop_table("monthly_route_location_comment")
        else:
            op.rename_table("monthly_route_location_comment", "monthly_location_comment")
            if _has_fk_constraint("monthly_location_comment", "monthly_route_location_comment_location_id_fkey"):
                op.drop_constraint(
                    "monthly_route_location_comment_location_id_fkey",
                    "monthly_location_comment",
                    type_="foreignkey",
                )
            if _has_index("monthly_location_comment", "ix_monthly_route_location_comment_location_id"):
                op.drop_index(
                    "ix_monthly_route_location_comment_location_id",
                    table_name="monthly_location_comment",
                )
            if not _has_index("monthly_location_comment", "ix_monthly_location_comment_location_id"):
                op.create_index(
                    "ix_monthly_location_comment_location_id",
                    "monthly_location_comment",
                    ["location_id"],
                )
            if not _has_fk_constraint("monthly_location_comment", "fk_monthly_location_comment_location_id"):
                op.create_foreign_key(
                    "fk_monthly_location_comment_location_id",
                    "monthly_location_comment",
                    "monthly_location",
                    ["location_id"],
                    ["id"],
                    ondelete="CASCADE",
                )

    # Worksheet audit
    if _has_table("monthly_route_worksheet_audit_event") and _has_column(
        "monthly_route_worksheet_audit_event", "history_row_id"
    ):
        if not _has_column("monthly_route_worksheet_audit_event", "location_month_row_id"):
            op.add_column(
                "monthly_route_worksheet_audit_event",
                sa.Column("location_month_row_id", sa.BigInteger(), nullable=True),
            )
        if _has_fk_constraint("monthly_route_worksheet_audit_event", "monthly_route_worksheet_audit_event_location_id_fkey"):
            op.drop_constraint(
                "monthly_route_worksheet_audit_event_location_id_fkey",
                "monthly_route_worksheet_audit_event",
                type_="foreignkey",
            )
        if _has_fk_constraint("monthly_route_worksheet_audit_event", "monthly_route_worksheet_audit_event_history_row_id_fkey"):
            op.drop_constraint(
                "monthly_route_worksheet_audit_event_history_row_id_fkey",
                "monthly_route_worksheet_audit_event",
                type_="foreignkey",
            )
        if not _has_fk_constraint("monthly_route_worksheet_audit_event", "fk_mr_worksheet_audit_location_id"):
            op.create_foreign_key(
                "fk_mr_worksheet_audit_location_id",
                "monthly_route_worksheet_audit_event",
                "monthly_location",
                ["location_id"],
                ["id"],
                ondelete="CASCADE",
            )
        if not _has_fk_constraint("monthly_route_worksheet_audit_event", "fk_mr_worksheet_audit_location_month_row_id"):
            op.create_foreign_key(
                "fk_mr_worksheet_audit_location_month_row_id",
                "monthly_route_worksheet_audit_event",
                "monthly_location_month",
                ["location_month_row_id"],
                ["id"],
                ondelete="CASCADE",
            )
        op.drop_column("monthly_route_worksheet_audit_event", "history_row_id")
        op.alter_column(
            "monthly_route_worksheet_audit_event",
            "location_month_row_id",
            existing_type=sa.BigInteger(),
            nullable=False,
        )

    # Drop legacy tables
    for table in (
        "monthly_route_run_field_submission",
        "monthly_route_location_inspection_revision",
        "monthly_route_test_history",
        "monthly_testing_site_month",
        "monthly_testing_site",
        "monthly_site",
        "monthly_route_location",
    ):
        if _has_table(table):
            op.drop_table(table)


def downgrade() -> None:
    raise NotImplementedError("Flat monthly location cutover is not reversible.")
