"""Drop monthly_run_job_item (replace-item logging removed).

Revision ID: z1c2d3e4f5a6
Revises: z0b1c2d3e4f5
Create Date: 2026-06-03

"""

from alembic import op


revision = "z1c2d3e4f5a6"
down_revision = "z0b1c2d3e4f5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_monthly_run_job_item_location_id", table_name="monthly_run_job_item")
    op.drop_index("ix_monthly_run_job_item_run_id", table_name="monthly_run_job_item")
    op.drop_table("monthly_run_job_item")


def downgrade() -> None:
    import sqlalchemy as sa

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
