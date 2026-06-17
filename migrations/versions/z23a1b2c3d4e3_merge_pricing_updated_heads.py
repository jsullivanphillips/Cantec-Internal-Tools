"""Merge pricing_updated branch with deficiency/job branch.

Revision ID: z23a1b2c3d4e3
Revises: z22a1b2c3d4e2, f6a7b8c9d0e1
Create Date: 2026-06-17

"""

from alembic import op


revision = "z23a1b2c3d4e3"
down_revision = ("z22a1b2c3d4e2", "f6a7b8c9d0e1")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    raise NotImplementedError("This merge revision is not reversible.")
