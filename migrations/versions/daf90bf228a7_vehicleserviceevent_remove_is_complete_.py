"""VehicleServiceEvent remove is_complete add service_status

Revision ID: daf90bf228a7
Revises: 72afa9ecf07a
Create Date: 2026-02-03 11:59:51.261854
"""
from alembic import op
import sqlalchemy as sa

revision = "daf90bf228a7"
down_revision = "72afa9ecf07a"
branch_labels = None
depends_on = None


def upgrade():
    # 1) Add service_status as NULLABLE first
    with op.batch_alter_table("vehicle_service_event", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("service_status", sa.String(length=64), nullable=True)
        )

    # 2) Backfill service_status from is_complete
    #    TRUE  -> COMPLETE
    #    FALSE -> BOOKED
    op.execute(
        """
        UPDATE vehicle_service_event
        SET service_status = CASE
            WHEN is_complete = TRUE THEN 'COMPLETE'
            ELSE 'BOOKED'
        END
        WHERE service_status IS NULL
        """
    )

    # 3) Safety fallback (should never hit, but avoids edge cases)
    op.execute(
        """
        UPDATE vehicle_service_event
        SET service_status = 'BOOKED'
        WHERE service_status IS NULL OR service_status = ''
        """
    )

    # 4) Enforce NOT NULL and drop old column
    with op.batch_alter_table("vehicle_service_event", schema=None) as batch_op:
        batch_op.alter_column(
            "service_status",
            existing_type=sa.String(length=64),
            nullable=False,
        )
        batch_op.drop_column("is_complete")


def downgrade():
    # 1) Re-add is_complete as NULLABLE
    with op.batch_alter_table("vehicle_service_event", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("is_complete", sa.Boolean(), nullable=True)
        )

    # 2) Backfill is_complete from service_status
    #    COMPLETE -> TRUE
    #    everything else -> FALSE
    op.execute(
        """
        UPDATE vehicle_service_event
        SET is_complete = CASE
            WHEN service_status = 'COMPLETE' THEN TRUE
            ELSE FALSE
        END
        WHERE is_complete IS NULL
        """
    )

    # 3) Drop service_status
    with op.batch_alter_table("vehicle_service_event", schema=None) as batch_op:
        batch_op.drop_column("service_status")
