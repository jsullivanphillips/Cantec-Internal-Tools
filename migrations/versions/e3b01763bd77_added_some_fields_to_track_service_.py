"""added some fields to track service dates for vehicles

Revision ID: e3b01763bd77
Revises: 22078ceed7df
Create Date: 2026-01-29 10:05:20.112271

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e3b01763bd77'
down_revision = '22078ceed7df'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("vehicle", sa.Column("last_service_date", sa.Date(), nullable=True))
    op.add_column("vehicle", sa.Column("service_status", sa.String(length=16), nullable=False, server_default="OK"))
    op.add_column("vehicle", sa.Column("service_notes", sa.Text(), nullable=True))
    op.add_column("vehicle", sa.Column("service_flagged_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("vehicle", sa.Column("service_booked_at", sa.DateTime(timezone=True), nullable=True))

    op.create_index("ix_vehicle_service_status", "vehicle", ["service_status"])
    op.create_index("ix_vehicle_service_flagged_at", "vehicle", ["service_flagged_at"])


def downgrade():
    op.drop_index("ix_vehicle_service_flagged_at", table_name="vehicle")
    op.drop_index("ix_vehicle_service_status", table_name="vehicle")

    op.drop_column("vehicle", "service_booked_at")
    op.drop_column("vehicle", "service_flagged_at")
    op.drop_column("vehicle", "service_notes")
    op.drop_column("vehicle", "service_status")
    op.drop_column("vehicle", "last_service_date")

    # ### end Alembic commands ###
