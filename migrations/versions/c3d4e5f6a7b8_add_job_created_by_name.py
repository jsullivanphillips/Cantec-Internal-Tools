"""Add job.created_by_name for SLA modal attribution.

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a8
Create Date: 2026-06-16

"""

from alembic import op
import sqlalchemy as sa


revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a8"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("job", schema=None) as batch_op:
        batch_op.add_column(sa.Column("created_by_name", sa.String(length=255), nullable=True))


def downgrade():
    with op.batch_alter_table("job", schema=None) as batch_op:
        batch_op.drop_column("created_by_name")
