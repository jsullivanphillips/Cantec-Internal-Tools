"""Add quote_accepted_on to quote table.

Revision ID: a1b2c3d4e5f7
Revises: z21a1b2c3d4e1
Create Date: 2026-06-16

"""

from alembic import op
import sqlalchemy as sa


revision = "a1b2c3d4e5f7"
down_revision = "z21a1b2c3d4e1"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "quote",
        sa.Column("quote_accepted_on", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column("quote", "quote_accepted_on")
