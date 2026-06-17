"""Add manual include override flag on deficiency service eligibility.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-17

"""

from alembic import op
import sqlalchemy as sa


revision = "f6a7b8c9d0e1"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("deficiency_service_eligibility", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "included_override",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            )
        )


def downgrade():
    with op.batch_alter_table("deficiency_service_eligibility", schema=None) as batch_op:
        batch_op.drop_column("included_override")
