"""Per-testing-site display fields (ring, key, annual, PMC, panel, door code, monitoring, building).

Revision ID: z4a5b6c7d8e9
Revises: z3c4d5e6f8a0
Create Date: 2026-05-22

"""

from alembic import op
import sqlalchemy as sa


revision = "z4a5b6c7d8e9"
down_revision = "z3c4d5e6f8a0"
branch_labels = None
depends_on = None


def _add_testing_site_columns() -> None:
    op.add_column(
        "monthly_testing_site",
        sa.Column("annual_month", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "monthly_testing_site",
        sa.Column("property_management_company", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "monthly_testing_site",
        sa.Column("building_name", sa.String(length=255), nullable=True),
    )
    op.add_column("monthly_testing_site", sa.Column("panel", sa.Text(), nullable=True))
    op.add_column(
        "monthly_testing_site",
        sa.Column("panel_location", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "monthly_testing_site",
        sa.Column("door_code", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "monthly_testing_site",
        sa.Column("monitoring_company_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_monthly_testing_site_monitoring_company_id",
        "monthly_testing_site",
        "monitoring_company",
        ["monitoring_company_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_monthly_testing_site_monitoring_company_id",
        "monthly_testing_site",
        ["monitoring_company_id"],
        unique=False,
    )


def _add_testing_site_month_columns() -> None:
    op.add_column(
        "monthly_testing_site_month",
        sa.Column("property_management_company", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "monthly_testing_site_month",
        sa.Column("building_name", sa.String(length=255), nullable=True),
    )
    op.add_column("monthly_testing_site_month", sa.Column("panel", sa.Text(), nullable=True))
    op.add_column(
        "monthly_testing_site_month",
        sa.Column("panel_location", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "monthly_testing_site_month",
        sa.Column("door_code", sa.String(length=255), nullable=True),
    )


def _backfill_from_legacy() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        bind.execute(
            sa.text(
                """
                UPDATE monthly_testing_site
                SET
                    panel = COALESCE(panel, facp_detail),
                    annual_month = (
                        SELECT l.annual_month
                        FROM monthly_site ms
                        JOIN monthly_route_location l ON l.id = ms.legacy_monthly_route_location_id
                        WHERE ms.id = monthly_testing_site.monthly_site_id
                    ),
                    property_management_company = (
                        SELECT l.property_management_company
                        FROM monthly_site ms
                        JOIN monthly_route_location l ON l.id = ms.legacy_monthly_route_location_id
                        WHERE ms.id = monthly_testing_site.monthly_site_id
                    ),
                    building_name = (
                        SELECT l.building
                        FROM monthly_site ms
                        JOIN monthly_route_location l ON l.id = ms.legacy_monthly_route_location_id
                        WHERE ms.id = monthly_testing_site.monthly_site_id
                    ),
                    monitoring_company_id = (
                        SELECT l.monitoring_company_id
                        FROM monthly_site ms
                        JOIN monthly_route_location l ON l.id = ms.legacy_monthly_route_location_id
                        WHERE ms.id = monthly_testing_site.monthly_site_id
                    )
                """
            )
        )
        bind.execute(
            sa.text(
                """
                UPDATE monthly_testing_site_month
                SET panel = COALESCE(panel, facp)
                """
            )
        )
    else:
        bind.execute(
            sa.text(
                """
                UPDATE monthly_testing_site ts
                SET panel = COALESCE(ts.panel, ts.facp_detail),
                    annual_month = l.annual_month,
                    property_management_company = l.property_management_company,
                    building_name = l.building,
                    monitoring_company_id = l.monitoring_company_id
                FROM monthly_site ms
                JOIN monthly_route_location l ON l.id = ms.legacy_monthly_route_location_id
                WHERE ms.id = ts.monthly_site_id
                """
            )
        )
        bind.execute(
            sa.text(
                """
                UPDATE monthly_testing_site_month
                SET panel = COALESCE(panel, facp)
                """
            )
        )


def upgrade():
    _add_testing_site_columns()
    _add_testing_site_month_columns()
    _backfill_from_legacy()


def downgrade():
    op.drop_index("ix_monthly_testing_site_monitoring_company_id", table_name="monthly_testing_site")
    op.drop_constraint(
        "fk_monthly_testing_site_monitoring_company_id",
        "monthly_testing_site",
        type_="foreignkey",
    )
    for col in (
        "monitoring_company_id",
        "door_code",
        "panel_location",
        "panel",
        "building_name",
        "property_management_company",
        "annual_month",
    ):
        op.drop_column("monthly_testing_site", col)
    for col in ("door_code", "panel_location", "panel", "building_name", "property_management_company"):
        op.drop_column("monthly_testing_site_month", col)
