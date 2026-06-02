"""Per-site monitoring account number and run-month monitoring company FK.

Revision ID: z8e9f0a1b2c3
Revises: z5a6b7c8d9e0
Create Date: 2026-05-29

"""

from alembic import op
import sqlalchemy as sa


revision = "z8e9f0a1b2c3"
down_revision = "z5a6b7c8d9e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monthly_testing_site",
        sa.Column("monitoring_account_number", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "monthly_testing_site_month",
        sa.Column("monitoring_account_number", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "monthly_testing_site_month",
        sa.Column("monitoring_company_id", sa.BigInteger(), nullable=True),
    )
    op.create_index(
        "ix_mtsm_monitoring_company_id",
        "monthly_testing_site_month",
        ["monitoring_company_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_mtsm_monitoring_company_id",
        "monthly_testing_site_month",
        "monitoring_company",
        ["monitoring_company_id"],
        ["id"],
        ondelete="SET NULL",
    )

    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        bind.execute(
            sa.text(
                """
                UPDATE monthly_testing_site_month
                SET monitoring_company_id = (
                    SELECT ts.monitoring_company_id
                    FROM monthly_testing_site ts
                    WHERE ts.id = monthly_testing_site_month.monthly_testing_site_id
                )
                WHERE monitoring_company_id IS NULL
                """
            )
        )
    else:
        bind.execute(
            sa.text(
                """
                UPDATE monthly_testing_site_month m
                SET monitoring_company_id = ts.monitoring_company_id
                FROM monthly_testing_site ts
                WHERE ts.id = m.monthly_testing_site_id
                  AND m.monitoring_company_id IS NULL
                """
            )
        )


def downgrade() -> None:
    op.drop_constraint("fk_mtsm_monitoring_company_id", "monthly_testing_site_month", type_="foreignkey")
    op.drop_index("ix_mtsm_monitoring_company_id", table_name="monthly_testing_site_month")
    op.drop_column("monthly_testing_site_month", "monitoring_company_id")
    op.drop_column("monthly_testing_site_month", "monitoring_account_number")
    op.drop_column("monthly_testing_site", "monitoring_account_number")
