"""add building to monthly location identity

Revision ID: d4e5f6a7b8c9
Revises: 9b8d7a6c5e41
Create Date: 2026-04-30 10:28:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "d4e5f6a7b8c9"
down_revision = "9b8d7a6c5e41"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("monthly_route_location", sa.Column("building", sa.String(length=255), nullable=True))
    op.add_column(
        "monthly_route_location",
        sa.Column("building_normalized", sa.String(length=255), nullable=True),
    )

    op.execute(
        """
        UPDATE monthly_route_location
        SET
            building = notes,
            building_normalized = lower(
                trim(
                    regexp_replace(
                        coalesce(notes, ''),
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
        "building_normalized",
        existing_type=sa.String(length=255),
        nullable=False,
        server_default="",
    )

    op.drop_constraint(
        "uq_monthly_route_location_address_company_normalized",
        "monthly_route_location",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_monthly_route_location_address_company_building_normalized",
        "monthly_route_location",
        ["address_normalized", "property_management_company_normalized", "building_normalized"],
    )


def downgrade():
    op.drop_constraint(
        "uq_monthly_route_location_address_company_building_normalized",
        "monthly_route_location",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_monthly_route_location_address_company_normalized",
        "monthly_route_location",
        ["address_normalized", "property_management_company_normalized"],
    )

    op.drop_column("monthly_route_location", "building_normalized")
    op.drop_column("monthly_route_location", "building")
