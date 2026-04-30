"""add display_address to monthly route location

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-04-30 13:20:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c8d9e0f1a2b3"
down_revision = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("monthly_route_location", sa.Column("display_address", sa.String(length=255), nullable=True))


def downgrade():
    op.drop_column("monthly_route_location", "display_address")
