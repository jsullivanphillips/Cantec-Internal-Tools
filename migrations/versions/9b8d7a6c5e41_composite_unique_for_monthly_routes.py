"""composite unique for monthly routes

Revision ID: 9b8d7a6c5e41
Revises: a3f9d2c1b7e4
Create Date: 2026-04-30 10:03:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "9b8d7a6c5e41"
down_revision = "a3f9d2c1b7e4"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "monthly_route_location",
        sa.Column("property_management_company_normalized", sa.String(length=255), nullable=True),
    )

    op.execute(
        """
        UPDATE monthly_route_location
        SET property_management_company_normalized = lower(
            trim(
                regexp_replace(
                    coalesce(property_management_company, ''),
                    '\\s+',
                    ' ',
                    'g'
                )
            )
        )
        """
    )

    op.alter_column(
        "monthly_route_location",
        "property_management_company_normalized",
        existing_type=sa.String(length=255),
        nullable=False,
        server_default="",
    )

    op.drop_constraint(
        "uq_monthly_route_location_address_normalized",
        "monthly_route_location",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_monthly_route_location_address_company_normalized",
        "monthly_route_location",
        ["address_normalized", "property_management_company_normalized"],
    )

    op.create_table(
        "monthly_route_history_reason_backup",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("address_normalized", sa.String(length=255), nullable=False),
        sa.Column("property_management_company_normalized", sa.String(length=255), nullable=False),
        sa.Column("month_date", sa.Date(), nullable=False),
        sa.Column("result_status", sa.String(length=32), nullable=False),
        sa.Column("skip_reason", sa.String(length=255), nullable=True),
        sa.Column("source_value_raw", sa.String(length=255), nullable=True),
        sa.Column("backed_up_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_monthly_route_history_reason_backup_identity",
        "monthly_route_history_reason_backup",
        ["address_normalized", "property_management_company_normalized", "month_date"],
        unique=False,
    )
    op.execute(
        """
        INSERT INTO monthly_route_history_reason_backup (
            address_normalized,
            property_management_company_normalized,
            month_date,
            result_status,
            skip_reason,
            source_value_raw
        )
        SELECT
            l.address_normalized,
            l.property_management_company_normalized,
            h.month_date,
            h.result_status,
            h.skip_reason,
            h.source_value_raw
        FROM monthly_route_test_history h
        JOIN monthly_route_location l ON l.id = h.location_id
        """
    )


def downgrade():
    op.drop_index(
        "ix_monthly_route_history_reason_backup_identity",
        table_name="monthly_route_history_reason_backup",
    )
    op.drop_table("monthly_route_history_reason_backup")

    op.drop_constraint(
        "uq_monthly_route_location_address_company_normalized",
        "monthly_route_location",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_monthly_route_location_address_normalized",
        "monthly_route_location",
        ["address_normalized"],
    )
    op.drop_column("monthly_route_location", "property_management_company_normalized")
