"""Add monthly_route_comment table.

Revision ID: c5d6e7f8a9b0
Revises: b4e5f6a7b8c9

"""

from alembic import op
import sqlalchemy as sa


revision = "c5d6e7f8a9b0"
down_revision = "b4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "monthly_route_comment",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("monthly_route_id", sa.BigInteger(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("author_username", sa.String(length=255), nullable=True),
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
            ["monthly_route_id"],
            ["monthly_route.id"],
            name="fk_monthly_route_comment_monthly_route_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_monthly_route_comment_monthly_route_id",
        "monthly_route_comment",
        ["monthly_route_id"],
        unique=False,
    )


def downgrade():
    op.drop_index(
        "ix_monthly_route_comment_monthly_route_id",
        table_name="monthly_route_comment",
    )
    op.drop_table("monthly_route_comment")
