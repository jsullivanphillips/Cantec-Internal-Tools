"""Add monthly_site, monthly_testing_site, monthly_testing_site_month (v2 dual schema).

Revision ID: z1b2c3d4e5f6
Revises: r9a8b7c6d5e4
Create Date: 2026-05-11

"""

from alembic import op
import sqlalchemy as sa


revision = "z1b2c3d4e5f6"
down_revision = "r9a8b7c6d5e4"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "monthly_site",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("legacy_monthly_route_location_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["legacy_monthly_route_location_id"],
            ["monthly_route_location.id"],
            name="fk_monthly_site_legacy_monthly_route_location_id",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "legacy_monthly_route_location_id",
            name="uq_monthly_site_legacy_monthly_route_location_id",
        ),
    )
    op.create_index(
        "ix_monthly_site_legacy_monthly_route_location_id",
        "monthly_site",
        ["legacy_monthly_route_location_id"],
        unique=False,
    )

    op.create_table(
        "monthly_testing_site",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("monthly_site_id", sa.BigInteger(), nullable=False),
        sa.Column("sort_order", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("label", sa.String(length=255), nullable=True),
        sa.Column("price_per_month", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("ring_detail", sa.Text(), nullable=True),
        sa.Column("facp_detail", sa.Text(), nullable=True),
        sa.Column("testing_procedures", sa.Text(), nullable=True),
        sa.Column("inspection_tech_notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["monthly_site_id"],
            ["monthly_site.id"],
            name="fk_monthly_testing_site_monthly_site_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "monthly_site_id",
            "sort_order",
            name="uq_monthly_testing_site_site_sort_order",
        ),
    )
    op.create_index(
        "ix_monthly_testing_site_monthly_site_id",
        "monthly_testing_site",
        ["monthly_site_id"],
        unique=False,
    )

    op.create_table(
        "monthly_testing_site_month",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("monthly_testing_site_id", sa.BigInteger(), nullable=False),
        sa.Column("month_date", sa.Date(), nullable=False),
        sa.Column("run_id", sa.BigInteger(), nullable=True),
        sa.Column("test_monthly_route_id", sa.BigInteger(), nullable=True),
        sa.Column("session_route_stop_order", sa.SmallInteger(), nullable=True),
        sa.Column("result_status", sa.String(length=32), nullable=True),
        sa.Column("skip_reason", sa.String(length=255), nullable=True),
        sa.Column("source_value_raw", sa.String(length=255), nullable=True),
        sa.Column("facp", sa.Text(), nullable=True),
        sa.Column("ring", sa.String(length=255), nullable=True),
        sa.Column("key_number", sa.String(length=255), nullable=True),
        sa.Column("annual_month", sa.String(length=32), nullable=True),
        sa.Column("testing_procedures", sa.Text(), nullable=True),
        sa.Column("inspection_tech_notes", sa.Text(), nullable=True),
        sa.Column("sheet_time_in_raw", sa.String(length=64), nullable=True),
        sa.Column("sheet_time_out_raw", sa.String(length=64), nullable=True),
        sa.Column("monitoring_notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["monthly_testing_site_id"],
            ["monthly_testing_site.id"],
            name="fk_mtsm_monthly_testing_site_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["monthly_route_run.id"],
            name="fk_mtsm_run_id",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["test_monthly_route_id"],
            ["monthly_route.id"],
            name="fk_mtsm_test_monthly_route_id",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "monthly_testing_site_id",
            "month_date",
            name="uq_mtsm_testing_site_month",
        ),
    )
    op.create_index(
        "ix_mtsm_month_date",
        "monthly_testing_site_month",
        ["month_date"],
        unique=False,
    )
    op.create_index(
        "ix_mtsm_run_id",
        "monthly_testing_site_month",
        ["run_id"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_mtsm_run_id", table_name="monthly_testing_site_month")
    op.drop_index("ix_mtsm_month_date", table_name="monthly_testing_site_month")
    op.drop_table("monthly_testing_site_month")
    op.drop_index("ix_monthly_testing_site_monthly_site_id", table_name="monthly_testing_site")
    op.drop_table("monthly_testing_site")
    op.drop_index("ix_monthly_site_legacy_monthly_route_location_id", table_name="monthly_site")
    op.drop_table("monthly_site")
