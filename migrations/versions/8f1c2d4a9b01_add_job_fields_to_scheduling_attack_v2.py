"""add job fields to scheduling_attack_v2

Revision ID: 8f1c2d4a9b01
Revises: 2a6d4c8e91b7
Create Date: 2026-04-28 10:18:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "8f1c2d4a9b01"
down_revision = "2a6d4c8e91b7"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("scheduling_attack_v2", sa.Column("job_id", sa.BigInteger(), nullable=True))
    op.add_column("scheduling_attack_v2", sa.Column("job_type", sa.String(length=255), nullable=True))
    op.create_index(
        op.f("ix_scheduling_attack_v2_job_id"),
        "scheduling_attack_v2",
        ["job_id"],
        unique=False,
    )


def downgrade():
    op.drop_index(op.f("ix_scheduling_attack_v2_job_id"), table_name="scheduling_attack_v2")
    op.drop_column("scheduling_attack_v2", "job_type")
    op.drop_column("scheduling_attack_v2", "job_id")
