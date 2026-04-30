"""add monthly routes master tables

Revision ID: a3f9d2c1b7e4
Revises: b5c3d1e8a902
Create Date: 2026-04-30 09:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "a3f9d2c1b7e4"
down_revision = "b5c3d1e8a902"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "monthly_route_location",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("address", sa.String(length=255), nullable=False),
        sa.Column("address_normalized", sa.String(length=255), nullable=False),
        sa.Column("property_management_company", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("barcode", sa.String(length=64), nullable=True),
        sa.Column("price_per_month", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("area", sa.String(length=255), nullable=True),
        sa.Column("start_up_date", sa.Date(), nullable=True),
        sa.Column("status_normalized", sa.String(length=32), nullable=False),
        sa.Column("status_raw", sa.String(length=255), nullable=True),
        sa.Column("keys", sa.Text(), nullable=True),
        sa.Column("test_day", sa.String(length=255), nullable=True),
        sa.Column("annual_month", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("address_normalized", name="uq_monthly_route_location_address_normalized"),
    )
    op.create_index(
        "ix_monthly_route_location_status_normalized",
        "monthly_route_location",
        ["status_normalized"],
        unique=False,
    )

    op.create_table(
        "monthly_route_test_history",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("location_id", sa.BigInteger(), nullable=False),
        sa.Column("month_date", sa.Date(), nullable=False),
        sa.Column("result_status", sa.String(length=32), nullable=False),
        sa.Column("skip_reason", sa.String(length=255), nullable=True),
        sa.Column("source_value_raw", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["location_id"], ["monthly_route_location.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("location_id", "month_date", name="uq_monthly_route_test_history_location_month"),
    )
    op.create_index(
        "ix_monthly_route_test_history_location_id",
        "monthly_route_test_history",
        ["location_id"],
        unique=False,
    )
    op.create_index(
        "ix_monthly_route_test_history_month_date",
        "monthly_route_test_history",
        ["month_date"],
        unique=False,
    )
    op.create_index(
        "ix_monthly_route_test_history_result_status",
        "monthly_route_test_history",
        ["result_status"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_monthly_route_test_history_result_status", table_name="monthly_route_test_history")
    op.drop_index("ix_monthly_route_test_history_month_date", table_name="monthly_route_test_history")
    op.drop_index("ix_monthly_route_test_history_location_id", table_name="monthly_route_test_history")
    op.drop_table("monthly_route_test_history")

    op.drop_index("ix_monthly_route_location_status_normalized", table_name="monthly_route_location")
    op.drop_table("monthly_route_location")
