"""Run-month monitoring company name on ``monthly_testing_site_month``.

Revision ID: z5b6c7d8e9f0
Revises: z4a5b6c7d8e9
Create Date: 2026-05-22

"""

from alembic import op
import sqlalchemy as sa


revision = "z5b6c7d8e9f0"
down_revision = "z4a5b6c7d8e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monthly_testing_site_month",
        sa.Column("monitoring_company_name", sa.String(length=255), nullable=True),
    )
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        bind.execute(
            sa.text(
                """
                UPDATE monthly_testing_site_month
                SET monitoring_company_name = (
                    SELECT mc.name
                    FROM monthly_testing_site ts
                    LEFT JOIN monitoring_company mc ON mc.id = ts.monitoring_company_id
                    WHERE ts.id = monthly_testing_site_month.monthly_testing_site_id
                )
                WHERE monitoring_company_name IS NULL
                """
            )
        )
    else:
        bind.execute(
            sa.text(
                """
                UPDATE monthly_testing_site_month m
                SET monitoring_company_name = mc.name
                FROM monthly_testing_site ts
                LEFT JOIN monitoring_company mc ON mc.id = ts.monitoring_company_id
                WHERE ts.id = m.monthly_testing_site_id
                  AND m.monitoring_company_name IS NULL
                """
            )
        )


def downgrade() -> None:
    op.drop_column("monthly_testing_site_month", "monitoring_company_name")
