"""Merge monthly location cutover branch with monitoring password branch.

Revision ID: z6f7e8d9c0b1
Revises: z4f5a6b7c8d9, z11b2c3d4e5f6
Create Date: 2026-06-09 15:10:00.000000
"""
from alembic import op


revision = "z6f7e8d9c0b1"
down_revision = ("z4f5a6b7c8d9", "z11b2c3d4e5f6")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    raise NotImplementedError("This merge revision is not reversible.")
