"""Add monthly_route_location_comment table.

Revision ID: b4e5f6a7b8c9
Revises: a3c4d5e6f7a8

"""

from alembic import op
import sqlalchemy as sa


revision = "b4e5f6a7b8c9"
down_revision = "a3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "monthly_route_location_comment",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("location_id", sa.BigInteger(), nullable=False),
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
            ["location_id"],
            ["monthly_route_location.id"],
            name="fk_monthly_route_location_comment_location_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_monthly_route_location_comment_location_id",
        "monthly_route_location_comment",
        ["location_id"],
        unique=False,
    )


def downgrade():
    op.drop_index(
        "ix_monthly_route_location_comment_location_id",
        table_name="monthly_route_location_comment",
    )
    op.drop_table("monthly_route_location_comment")
