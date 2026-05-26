"""Add monthly route calculated path cache.

Revision ID: y8e9f0a1b2c3
Revises: z7d8e9f0a1b2
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "y8e9f0a1b2c3"
down_revision = "z7d8e9f0a1b2"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return inspect(op.get_bind()).has_table(table_name)


def upgrade():
    if _has_table("monthly_route_calculated_path"):
        return

    op.create_table(
        "monthly_route_calculated_path",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("monthly_route_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "profile",
            sa.String(length=32),
            nullable=False,
            server_default="driving",
        ),
        sa.Column(
            "provider",
            sa.String(length=32),
            nullable=False,
            server_default="mapbox",
        ),
        sa.Column("stop_signature", sa.String(length=64), nullable=False),
        sa.Column("geometry_geojson", sa.JSON(), nullable=False),
        sa.Column("distance_meters", sa.Float(), nullable=True),
        sa.Column("duration_seconds", sa.Float(), nullable=True),
        sa.Column("waypoint_count", sa.Integer(), nullable=False),
        sa.Column("provider_response_summary", sa.JSON(), nullable=True),
        sa.Column(
            "calculated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["monthly_route_id"],
            ["monthly_route.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "monthly_route_id",
            "profile",
            name="uq_monthly_route_calculated_path_route_profile",
        ),
    )
    op.create_index(
        "ix_monthly_route_calculated_path_route_profile",
        "monthly_route_calculated_path",
        ["monthly_route_id", "profile"],
        unique=False,
    )


def downgrade():
    if not _has_table("monthly_route_calculated_path"):
        return
    op.drop_index(
        "ix_monthly_route_calculated_path_route_profile",
        table_name="monthly_route_calculated_path",
    )
    op.drop_table("monthly_route_calculated_path")
