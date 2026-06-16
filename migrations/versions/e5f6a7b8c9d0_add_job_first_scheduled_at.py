"""Add job.first_scheduled_at for SLA scheduling-action timestamp.

Revision ID: e5f6a7b8c9d0
Revises: c3d4e5f6a7b8
Create Date: 2026-06-16

"""

from alembic import op
import sqlalchemy as sa


revision = "e5f6a7b8c9d0"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("job", schema=None) as batch_op:
        batch_op.add_column(sa.Column("first_scheduled_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    with op.batch_alter_table("job", schema=None) as batch_op:
        batch_op.drop_column("first_scheduled_at")
