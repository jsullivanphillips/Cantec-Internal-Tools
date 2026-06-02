"""Sync worksheet audit event id sequence after manual PK assignment.

Revision ID: z9a0b1c2d3e4
Revises: z8a9b0c1d2e3
Create Date: 2026-06-02

"""
from alembic import op
import sqlalchemy as sa


revision = "z9a0b1c2d3e4"
down_revision = "z8a9b0c1d2e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute(
        sa.text(
            """
            SELECT setval(
                pg_get_serial_sequence('monthly_route_worksheet_audit_event', 'id'),
                GREATEST(
                    COALESCE((SELECT MAX(id) FROM monthly_route_worksheet_audit_event), 1),
                    1
                ),
                (SELECT MAX(id) IS NOT NULL FROM monthly_route_worksheet_audit_event)
            )
            """
        )
    )


def downgrade() -> None:
    pass
