"""Field submission snapshot, office job comment, location tickets, run job items.

Revision ID: z0a1b2c3d4e5
Revises: z9a0b1c2d3e4
Create Date: 2026-06-02

"""

from alembic import op
import sqlalchemy as sa


revision = "z0a1b2c3d4e5"
down_revision = "z9a0b1c2d3e4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "monthly_route_run_field_submission",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("run_id", sa.BigInteger(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
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
        sa.ForeignKeyConstraint(["run_id"], ["monthly_route_run.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", name="uq_monthly_route_run_field_submission_run_id"),
    )
    op.create_index(
        "ix_monthly_route_run_field_submission_run_id",
        "monthly_route_run_field_submission",
        ["run_id"],
        unique=False,
    )

    op.add_column(
        "monthly_testing_site_month",
        sa.Column("office_job_comment", sa.Text(), nullable=True),
    )

    op.create_table(
        "monthly_location_ticket",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("monthly_route_location_id", sa.BigInteger(), nullable=False),
        sa.Column("run_id", sa.BigInteger(), nullable=True),
        sa.Column("month_date", sa.Date(), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="open"),
        sa.Column("created_by", sa.String(length=128), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
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
            ["monthly_route_location_id"],
            ["monthly_route_location.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["run_id"], ["monthly_route_run.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_monthly_location_ticket_location_id",
        "monthly_location_ticket",
        ["monthly_route_location_id"],
        unique=False,
    )
    op.create_index(
        "ix_monthly_location_ticket_status",
        "monthly_location_ticket",
        ["status"],
        unique=False,
    )

    op.create_table(
        "monthly_location_ticket_event",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("ticket_id", sa.BigInteger(), nullable=False),
        sa.Column("from_status", sa.String(length=32), nullable=True),
        sa.Column("to_status", sa.String(length=32), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["ticket_id"], ["monthly_location_ticket.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_monthly_location_ticket_event_ticket_id",
        "monthly_location_ticket_event",
        ["ticket_id"],
        unique=False,
    )

    op.create_table(
        "monthly_run_job_item",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("run_id", sa.BigInteger(), nullable=False),
        sa.Column("monthly_route_location_id", sa.BigInteger(), nullable=False),
        sa.Column("monthly_testing_site_id", sa.BigInteger(), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 2), nullable=False, server_default="1"),
        sa.Column("recorded_by", sa.String(length=255), nullable=True),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["run_id"], ["monthly_route_run.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["monthly_route_location_id"],
            ["monthly_route_location.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["monthly_testing_site_id"],
            ["monthly_testing_site.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_monthly_run_job_item_run_id", "monthly_run_job_item", ["run_id"], unique=False)
    op.create_index(
        "ix_monthly_run_job_item_location_id",
        "monthly_run_job_item",
        ["monthly_route_location_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_monthly_run_job_item_location_id", table_name="monthly_run_job_item")
    op.drop_index("ix_monthly_run_job_item_run_id", table_name="monthly_run_job_item")
    op.drop_table("monthly_run_job_item")
    op.drop_index("ix_monthly_location_ticket_event_ticket_id", table_name="monthly_location_ticket_event")
    op.drop_table("monthly_location_ticket_event")
    op.drop_index("ix_monthly_location_ticket_status", table_name="monthly_location_ticket")
    op.drop_index("ix_monthly_location_ticket_location_id", table_name="monthly_location_ticket")
    op.drop_table("monthly_location_ticket")
    op.drop_column("monthly_testing_site_month", "office_job_comment")
    op.drop_index(
        "ix_monthly_route_run_field_submission_run_id",
        table_name="monthly_route_run_field_submission",
    )
    op.drop_table("monthly_route_run_field_submission")
