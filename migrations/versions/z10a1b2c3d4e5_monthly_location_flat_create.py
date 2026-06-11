"""Create flat monthly_location tables (alongside legacy until data migration).

Revision ID: z10a1b2c3d4e5
Revises: z9a0b1c2d3e4
Create Date: 2026-06-09

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "z10a1b2c3d4e5"
down_revision = "z9a0b1c2d3e4"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    bind = op.get_bind()
    return inspect(bind).has_table(name)


def _has_index(table: str, name: str) -> bool:
    bind = op.get_bind()
    return name in [idx["name"] for idx in inspect(bind).get_indexes(table)]


def upgrade() -> None:
    if not _has_table("monthly_location"):
        op.create_table(
            "monthly_location",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("address", sa.String(length=255), nullable=False),
            sa.Column("address_normalized", sa.String(length=255), nullable=False),
            sa.Column("label", sa.String(length=255), nullable=False),
            sa.Column("label_normalized", sa.String(length=255), nullable=False),
            sa.Column("property_management_company", sa.String(length=255), nullable=True),
            sa.Column("property_management_company_normalized", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("billing_comments", sa.Text(), nullable=True),
            sa.Column("barcode", sa.String(length=64), nullable=True),
            sa.Column("price_per_month", sa.Numeric(10, 2), nullable=True),
            sa.Column("area", sa.String(length=255), nullable=True),
            sa.Column("start_up_date", sa.Date(), nullable=True),
            sa.Column("status_normalized", sa.String(length=32), nullable=False, server_default="active"),
            sa.Column("status_raw", sa.String(length=255), nullable=True),
            sa.Column("keys", sa.Text(), nullable=True),
            sa.Column("test_day", sa.String(length=255), nullable=True),
            sa.Column("annual_month", sa.String(length=32), nullable=True),
            sa.Column("display_address", sa.String(length=255), nullable=True),
            sa.Column("latitude", sa.Float(), nullable=True),
            sa.Column("longitude", sa.Float(), nullable=True),
            sa.Column("monthly_route_id", sa.BigInteger(), nullable=True),
            sa.Column("route_stop_order", sa.SmallInteger(), nullable=True),
            sa.Column("service_trade_site_location_id", sa.BigInteger(), nullable=True),
            sa.Column("key_id", sa.BigInteger(), nullable=True),
            sa.Column("monitoring_company_id", sa.BigInteger(), nullable=True),
            sa.Column("pending_monitoring_company_proposal_id", sa.BigInteger(), nullable=True),
            sa.Column("annual_month_pending", sa.String(length=64), nullable=True),
            sa.Column("annual_month_pending_submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("annual_month_pending_submitted_by_name", sa.String(length=255), nullable=True),
            sa.Column("ring_detail", sa.Text(), nullable=True),
            sa.Column("facp_detail", sa.Text(), nullable=True),
            sa.Column("panel", sa.Text(), nullable=True),
            sa.Column("panel_location", sa.String(length=255), nullable=True),
            sa.Column("door_code", sa.String(length=255), nullable=True),
            sa.Column("testing_procedures", sa.Text(), nullable=True),
            sa.Column("inspection_tech_notes", sa.Text(), nullable=True),
            sa.Column("monitoring_account_number", sa.String(length=64), nullable=True),
            sa.Column("monitoring_password", sa.String(length=64), nullable=True),
            sa.Column("monitoring_notes", sa.Text(), nullable=True),
            sa.Column("legacy_monthly_route_location_id", sa.BigInteger(), nullable=True),
            sa.Column("legacy_monthly_testing_site_id", sa.BigInteger(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["key_id"], ["keys.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["monitoring_company_id"], ["monitoring_company.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["monthly_route_id"], ["monthly_route.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(
                ["pending_monitoring_company_proposal_id"],
                ["monitoring_company_proposal.id"],
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "address_normalized",
                "property_management_company_normalized",
                "label_normalized",
                name="uq_monthly_location_address_pmc_label_normalized",
            ),
            sa.CheckConstraint(
                "(monitoring_company_id IS NULL OR pending_monitoring_company_proposal_id IS NULL)",
                name="ck_ml_monitoring_company_xor_pending_proposal",
            ),
        )
    if not _has_index("monthly_location", "ix_monthly_location_status_normalized"):
        op.create_index("ix_monthly_location_status_normalized", "monthly_location", ["status_normalized"])
    if not _has_index("monthly_location", "ix_monthly_location_monthly_route_id"):
        op.create_index("ix_monthly_location_monthly_route_id", "monthly_location", ["monthly_route_id"])
    if not _has_index("monthly_location", "ix_monthly_location_key_id"):
        op.create_index("ix_monthly_location_key_id", "monthly_location", ["key_id"])
    if not _has_index("monthly_location", "ix_monthly_location_legacy_route_loc_id"):
        op.create_index(
            "ix_monthly_location_legacy_route_loc_id",
            "monthly_location",
            ["legacy_monthly_route_location_id"],
        )
    if not _has_index("monthly_location", "ix_monthly_location_legacy_testing_site_id"):
        op.create_index(
            "ix_monthly_location_legacy_testing_site_id",
            "monthly_location",
            ["legacy_monthly_testing_site_id"],
        )

    if not _has_table("monthly_location_month"):
        op.create_table(
            "monthly_location_month",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("monthly_location_id", sa.BigInteger(), nullable=False),
            sa.Column("month_date", sa.Date(), nullable=False),
            sa.Column("run_id", sa.BigInteger(), nullable=True),
            sa.Column("test_monthly_route_id", sa.BigInteger(), nullable=True),
            sa.Column("session_route_stop_order", sa.SmallInteger(), nullable=True),
            sa.Column("result_status", sa.String(length=32), nullable=True),
            sa.Column("skip_reason", sa.String(length=255), nullable=True),
            sa.Column("source_value_raw", sa.String(length=255), nullable=True),
            sa.Column("facp", sa.Text(), nullable=True),
            sa.Column("panel", sa.Text(), nullable=True),
            sa.Column("panel_location", sa.String(length=255), nullable=True),
            sa.Column("door_code", sa.String(length=255), nullable=True),
            sa.Column("property_management_company", sa.String(length=255), nullable=True),
            sa.Column("ring", sa.String(length=255), nullable=True),
            sa.Column("key_number", sa.String(length=255), nullable=True),
            sa.Column("annual_month", sa.String(length=32), nullable=True),
            sa.Column("testing_procedures", sa.Text(), nullable=True),
            sa.Column("inspection_tech_notes", sa.Text(), nullable=True),
            sa.Column("run_comments", sa.Text(), nullable=True),
            sa.Column("office_job_comment", sa.Text(), nullable=True),
            sa.Column("office_attention", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("prior_month_out_of_order_dismissed", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("sheet_time_in_raw", sa.String(length=64), nullable=True),
            sa.Column("sheet_time_out_raw", sa.String(length=64), nullable=True),
            sa.Column("test_outcome", sa.String(length=32), nullable=True),
            sa.Column("skip_category", sa.String(length=64), nullable=True),
            sa.Column("skip_note", sa.Text(), nullable=True),
            sa.Column("confirmed_no_deficiencies", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("monitoring_company_name", sa.String(length=255), nullable=True),
            sa.Column("monitoring_company_id", sa.BigInteger(), nullable=True),
            sa.Column("monitoring_account_number", sa.String(length=64), nullable=True),
            sa.Column("monitoring_password", sa.String(length=64), nullable=True),
            sa.Column("monitoring_notes", sa.Text(), nullable=True),
            sa.Column("billing_status", sa.String(length=16), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["monthly_location_id"], ["monthly_location.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["monitoring_company_id"], ["monitoring_company.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["run_id"], ["monthly_route_run.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["test_monthly_route_id"], ["monthly_route.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("monthly_location_id", "month_date", name="uq_mlm_location_month"),
        )
    if not _has_index("monthly_location_month", "ix_mlm_month_date"):
        op.create_index("ix_mlm_month_date", "monthly_location_month", ["month_date"])
    if not _has_index("monthly_location_month", "ix_mlm_run_id"):
        op.create_index("ix_mlm_run_id", "monthly_location_month", ["run_id"])

    if not _has_table("monthly_migration_conflict"):
        op.create_table(
            "monthly_migration_conflict",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("legacy_monthly_route_location_id", sa.BigInteger(), nullable=True),
            sa.Column("legacy_monthly_testing_site_id", sa.BigInteger(), nullable=True),
            sa.Column("intended_address", sa.String(length=255), nullable=True),
            sa.Column("intended_label", sa.String(length=255), nullable=True),
            sa.Column("intended_pmc", sa.String(length=255), nullable=True),
            sa.Column("reason", sa.String(length=255), nullable=False),
            sa.Column("detail", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )


def downgrade() -> None:
    op.drop_table("monthly_migration_conflict")
    op.drop_table("monthly_location_month")
    op.drop_table("monthly_location")
