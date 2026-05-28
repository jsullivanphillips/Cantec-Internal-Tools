"""Portal workflow: clock events, test outcomes, billing, deficiencies.

Revision ID: z5a6b7c8d9e0
Revises: y8e9f0a1b2c3
Create Date: 2026-05-28

"""

from alembic import op
import sqlalchemy as sa


revision = "z5a6b7c8d9e0"
down_revision = "y8e9f0a1b2c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monthly_testing_site_month",
        sa.Column("test_outcome", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "monthly_testing_site_month",
        sa.Column("skip_category", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "monthly_testing_site_month",
        sa.Column("skip_note", sa.Text(), nullable=True),
    )
    op.add_column(
        "monthly_testing_site_month",
        sa.Column(
            "confirmed_no_deficiencies",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    op.add_column(
        "monthly_route_test_history",
        sa.Column("billing_status", sa.String(length=16), nullable=True),
    )

    op.create_table(
        "monthly_stop_clock_event",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("monthly_testing_site_month_id", sa.BigInteger(), nullable=False),
        sa.Column("sort_order", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("time_in_raw", sa.String(length=64), nullable=False),
        sa.Column("time_out_raw", sa.String(length=64), nullable=True),
        sa.Column("created_by_tech_id", sa.String(length=64), nullable=True),
        sa.Column("created_by_tech_name", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["monthly_testing_site_month_id"],
            ["monthly_testing_site_month.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_monthly_stop_clock_event_mtsm_id",
        "monthly_stop_clock_event",
        ["monthly_testing_site_month_id"],
    )

    op.create_table(
        "monthly_testing_site_deficiency",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("monthly_testing_site_id", sa.BigInteger(), nullable=False),
        sa.Column("created_run_id", sa.BigInteger(), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("severity", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="new"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("verification_notes", sa.Text(), nullable=True),
        sa.Column("reported_by_tech_id", sa.String(length=64), nullable=True),
        sa.Column("reported_by_tech_name", sa.String(length=255), nullable=True),
        sa.Column("last_edited_by_tech_id", sa.String(length=64), nullable=True),
        sa.Column("last_edited_by_tech_name", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["monthly_testing_site_id"],
            ["monthly_testing_site.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_run_id"],
            ["monthly_route_run.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_monthly_testing_site_deficiency_site_id",
        "monthly_testing_site_deficiency",
        ["monthly_testing_site_id"],
    )
    op.create_index(
        "ix_monthly_testing_site_deficiency_created_run_id",
        "monthly_testing_site_deficiency",
        ["created_run_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_monthly_testing_site_deficiency_created_run_id",
        table_name="monthly_testing_site_deficiency",
    )
    op.drop_index(
        "ix_monthly_testing_site_deficiency_site_id",
        table_name="monthly_testing_site_deficiency",
    )
    op.drop_table("monthly_testing_site_deficiency")
    op.drop_index("ix_monthly_stop_clock_event_mtsm_id", table_name="monthly_stop_clock_event")
    op.drop_table("monthly_stop_clock_event")
    op.drop_column("monthly_route_test_history", "billing_status")
    op.drop_column("monthly_testing_site_month", "confirmed_no_deficiencies")
    op.drop_column("monthly_testing_site_month", "skip_note")
    op.drop_column("monthly_testing_site_month", "skip_category")
    op.drop_column("monthly_testing_site_month", "test_outcome")
