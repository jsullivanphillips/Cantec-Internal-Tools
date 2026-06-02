"""Pre-run message on runs and office attention flag on stop-month rows.

Revision ID: z8a9b0c1d2e3
Revises: a9b0c1d2e3f4
Create Date: 2026-06-02

"""

from alembic import op
import sqlalchemy as sa


revision = "z8a9b0c1d2e3"
down_revision = "a9b0c1d2e3f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "monthly_route_run",
        sa.Column("pre_run_message", sa.Text(), nullable=True),
    )
    op.add_column(
        "monthly_testing_site_month",
        sa.Column(
            "office_attention",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.alter_column("monthly_testing_site_month", "office_attention", server_default=None)


def downgrade() -> None:
    op.drop_column("monthly_testing_site_month", "office_attention")
    op.drop_column("monthly_route_run", "pre_run_message")
