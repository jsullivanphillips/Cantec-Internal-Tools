"""MonthlyRouteTestHistory: route at time of test (CSV / capture truth).

Revision ID: h9a0b1c2d3e4
Revises: g8f9e0a1b2c3

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "h9a0b1c2d3e4"
down_revision = "g8f9e0a1b2c3"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    return any(c["name"] == column_name for c in insp.get_columns(table_name))


def _has_index(index_name: str) -> bool:
    bind = op.get_bind()
    insp = inspect(bind)
    for table_name in insp.get_table_names():
        for ix in insp.get_indexes(table_name):
            if ix["name"] == index_name:
                return True
    return False


def upgrade():
    if not _has_column("monthly_route_test_history", "test_monthly_route_id"):
        op.add_column(
            "monthly_route_test_history",
            sa.Column("test_monthly_route_id", sa.BigInteger(), nullable=True),
        )
        op.create_foreign_key(
            "fk_monthly_route_test_hist_test_mr_id",
            "monthly_route_test_history",
            "monthly_route",
            ["test_monthly_route_id"],
            ["id"],
            ondelete="SET NULL",
        )
    if not _has_index("ix_mr_test_hist_test_monthly_route_id"):
        op.create_index(
            "ix_mr_test_hist_test_monthly_route_id",
            "monthly_route_test_history",
            ["test_monthly_route_id"],
            unique=False,
        )


def downgrade():
    if _has_index("ix_mr_test_hist_test_monthly_route_id"):
        op.drop_index("ix_mr_test_hist_test_monthly_route_id", table_name="monthly_route_test_history")
    bind = op.get_bind()
    insp = inspect(bind)
    if insp.has_table("monthly_route_test_history") and _has_column(
        "monthly_route_test_history", "test_monthly_route_id"
    ):
        fk_names = [fk["name"] for fk in insp.get_foreign_keys("monthly_route_test_history")]
        if "fk_monthly_route_test_hist_test_mr_id" in fk_names:
            op.drop_constraint(
                "fk_monthly_route_test_hist_test_mr_id",
                "monthly_route_test_history",
                type_="foreignkey",
            )
        op.drop_column("monthly_route_test_history", "test_monthly_route_id")
