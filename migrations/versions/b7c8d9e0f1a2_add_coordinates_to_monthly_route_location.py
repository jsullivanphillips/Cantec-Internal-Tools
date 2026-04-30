"""add coordinates to monthly route location

Revision ID: b7c8d9e0f1a2
Revises: d4e5f6a7b8c9
Create Date: 2026-04-30 12:55:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b7c8d9e0f1a2"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("monthly_route_location", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("monthly_route_location", sa.Column("longitude", sa.Float(), nullable=True))


def downgrade():
    op.drop_column("monthly_route_location", "longitude")
    op.drop_column("monthly_route_location", "latitude")
