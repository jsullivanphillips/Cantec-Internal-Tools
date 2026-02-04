"""add to vehicle_service_event updated_at and updated_by and changed booked_by to created_by

Revision ID: e3714415220d
Revises: daf90bf228a7
Create Date: 2026-02-03 12:14:34.410452
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text

revision = "e3714415220d"
down_revision = "daf90bf228a7"
branch_labels = None
depends_on = None


def upgrade():
    # 1) Add new columns as NULLABLE first
    with op.batch_alter_table("vehicle_service_event", schema=None) as batch_op:
        batch_op.add_column(sa.Column("created_by", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("updated_by", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))

    # 2) Backfill data from existing columns
    #    - created_by <- booked_by
    #    - updated_by <- booked_by (initially same)
    #    - updated_at <- NOW()
    op.execute(
        text("""
        UPDATE vehicle_service_event
        SET
            created_by = booked_by,
            updated_by = booked_by,
            updated_at = NOW()
        WHERE created_by IS NULL
        """)
    )

    # 3) Safety fallback (should not hit, but prevents edge cases)
    op.execute(
        text("""
        UPDATE vehicle_service_event
        SET
            created_by = 'SYSTEM'
        WHERE created_by IS NULL OR created_by = ''
        """)
    )

    op.execute(
        text("""
        UPDATE vehicle_service_event
        SET
            updated_at = NOW()
        WHERE updated_at IS NULL
        """)
    )

    # 4) Enforce NOT NULL and drop old column
    with op.batch_alter_table("vehicle_service_event", schema=None) as batch_op:
        batch_op.alter_column(
            "created_by",
            existing_type=sa.String(length=64),
            nullable=False,
        )
        batch_op.alter_column(
            "updated_at",
            existing_type=sa.DateTime(timezone=True),
            nullable=False,
        )
        batch_op.drop_column("booked_by")


def downgrade():
    # 1) Re-add booked_by as NULLABLE
    with op.batch_alter_table("vehicle_service_event", schema=None) as batch_op:
        batch_op.add_column(sa.Column("booked_by", sa.String(length=64), nullable=True))

    # 2) Restore booked_by from created_by
    op.execute(
        text("""
        UPDATE vehicle_service_event
        SET booked_by = created_by
        WHERE booked_by IS NULL
        """)
    )

    # 3) Enforce NOT NULL
    with op.batch_alter_table("vehicle_service_event", schema=None) as batch_op:
        batch_op.alter_column(
            "booked_by",
            existing_type=sa.String(length=64),
            nullable=False,
        )
        batch_op.drop_column("updated_at")
        batch_op.drop_column("updated_by")
        batch_op.drop_column("created_by")
