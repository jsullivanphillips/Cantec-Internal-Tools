"""updated db field names and removed uneccesary columns

Revision ID: 7ed654a04a48
Revises: 4d7c125ade4d
Create Date: 2026-02-03 10:53:13.275151
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "7ed654a04a48"
down_revision = "4d7c125ade4d"
branch_labels = None
depends_on = None


def upgrade():
    # --- VEHICLE ---
    with op.batch_alter_table("vehicle", schema=None) as batch_op:
        batch_op.add_column(sa.Column("latest_transmission_level", sa.String(length=16), nullable=True))

        # Add status as nullable first so we can backfill safely, then make NOT NULL.
        batch_op.add_column(sa.Column("status", sa.String(length=16), nullable=True))

        batch_op.add_column(sa.Column("notes", sa.Text(), nullable=True))

        # TIMESTAMPTZ -> DATE
        batch_op.alter_column(
            "service_booked_at",
            existing_type=postgresql.TIMESTAMP(timezone=True),
            type_=sa.Date(),
            existing_nullable=True,
        )

        batch_op.drop_index("ix_vehicle_service_flagged_at")
        batch_op.drop_index("ix_vehicle_service_status")
        batch_op.create_index(batch_op.f("ix_vehicle_status"), ["status"], unique=False)

    # Backfill vehicle.status from vehicle.service_status (default OK)
    op.execute(
        """
        UPDATE vehicle
        SET status = COALESCE(service_status, 'OK')
        WHERE status IS NULL
        """
    )

    # Backfill vehicle.notes from vehicle.service_notes (append if notes already exists)
    op.execute(
        """
        UPDATE vehicle
        SET notes = CASE
            WHEN notes IS NULL OR notes = '' THEN service_notes
            WHEN service_notes IS NULL OR service_notes = '' THEN notes
            ELSE notes || E'\\n' || service_notes
        END
        WHERE service_notes IS NOT NULL
        """
    )

    # Now enforce NOT NULL on vehicle.status
    with op.batch_alter_table("vehicle", schema=None) as batch_op:
        batch_op.alter_column(
            "status",
            existing_type=sa.String(length=16),
            nullable=False,
        )
        batch_op.drop_column("service_flagged_at")
        batch_op.drop_column("service_status")
        batch_op.drop_column("service_notes")

    # --- VEHICLE_DEFICIENCY ---
    with op.batch_alter_table("vehicle_deficiency", schema=None) as batch_op:
        # Add as nullable first, backfill, then set NOT NULL
        batch_op.add_column(sa.Column("created_by", sa.String(length=64), nullable=True))

    # Copy updated_by -> created_by
    op.execute(
        """
        UPDATE vehicle_deficiency
        SET created_by = updated_by
        WHERE created_by IS NULL
        """
    )

    # Ensure no NULLs remain (safety fallback)
    op.execute(
        """
        UPDATE vehicle_deficiency
        SET created_by = 'SYSTEM'
        WHERE created_by IS NULL OR created_by = ''
        """
    )

    with op.batch_alter_table("vehicle_deficiency", schema=None) as batch_op:
        batch_op.alter_column(
            "created_by",
            existing_type=sa.String(length=64),
            nullable=False,
        )
        batch_op.drop_column("updated_by")

    # --- VEHICLE_SUBMISSION ---
    with op.batch_alter_table("vehicle_submission", schema=None) as batch_op:
        batch_op.add_column(sa.Column("notes", sa.Text(), nullable=True))

    # Copy deficiency_notes -> notes (append if notes already exists)
    op.execute(
        """
        UPDATE vehicle_submission
        SET notes = CASE
            WHEN notes IS NULL OR notes = '' THEN deficiency_notes
            WHEN deficiency_notes IS NULL OR deficiency_notes = '' THEN notes
            ELSE notes || E'\\n' || deficiency_notes
        END
        WHERE deficiency_notes IS NOT NULL
        """
    )

    with op.batch_alter_table("vehicle_submission", schema=None) as batch_op:
        batch_op.drop_column("deficiency_notes")


def downgrade():
    # --- VEHICLE_SUBMISSION ---
    with op.batch_alter_table("vehicle_submission", schema=None) as batch_op:
        batch_op.add_column(sa.Column("deficiency_notes", sa.TEXT(), autoincrement=False, nullable=True))

    # Copy notes -> deficiency_notes
    op.execute(
        """
        UPDATE vehicle_submission
        SET deficiency_notes = notes
        WHERE deficiency_notes IS NULL
        """
    )

    with op.batch_alter_table("vehicle_submission", schema=None) as batch_op:
        batch_op.drop_column("notes")

    # --- VEHICLE_DEFICIENCY ---
    with op.batch_alter_table("vehicle_deficiency", schema=None) as batch_op:
        batch_op.add_column(sa.Column("updated_by", sa.VARCHAR(length=64), autoincrement=False, nullable=True))

    # Copy created_by -> updated_by
    op.execute(
        """
        UPDATE vehicle_deficiency
        SET updated_by = created_by
        WHERE updated_by IS NULL
        """
    )

    # Ensure NOT NULL again before dropping created_by
    op.execute(
        """
        UPDATE vehicle_deficiency
        SET updated_by = 'SYSTEM'
        WHERE updated_by IS NULL OR updated_by = ''
        """
    )

    with op.batch_alter_table("vehicle_deficiency", schema=None) as batch_op:
        batch_op.alter_column(
            "updated_by",
            existing_type=sa.VARCHAR(length=64),
            nullable=False,
        )
        batch_op.drop_column("created_by")

    # --- VEHICLE ---
    with op.batch_alter_table("vehicle", schema=None) as batch_op:
        batch_op.add_column(sa.Column("service_notes", sa.TEXT(), autoincrement=False, nullable=True))
        batch_op.add_column(
            sa.Column(
                "service_status",
                sa.VARCHAR(length=16),
                server_default=sa.text("'OK'::character varying"),
                autoincrement=False,
                nullable=False,
            )
        )
        batch_op.add_column(sa.Column("service_flagged_at", postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True))

        batch_op.drop_index(batch_op.f("ix_vehicle_status"))
        batch_op.create_index("ix_vehicle_service_status", ["service_status"], unique=False)
        batch_op.create_index("ix_vehicle_service_flagged_at", ["service_flagged_at"], unique=False)

        batch_op.alter_column(
            "service_booked_at",
            existing_type=sa.Date(),
            type_=postgresql.TIMESTAMP(timezone=True),
            existing_nullable=True,
        )

        # Re-add columns first as nullable so we can backfill
        # (service_status is already NOT NULL with default OK)
        # service_notes is nullable
        # service_flagged_at is nullable

    # Copy vehicle.status -> vehicle.service_status
    op.execute(
        """
        UPDATE vehicle
        SET service_status = COALESCE(status, 'OK')
        """
    )

    # Copy vehicle.notes -> vehicle.service_notes
    op.execute(
        """
        UPDATE vehicle
        SET service_notes = notes
        WHERE service_notes IS NULL
        """
    )

    with op.batch_alter_table("vehicle", schema=None) as batch_op:
        batch_op.drop_column("notes")
        batch_op.drop_column("status")
        batch_op.drop_column("latest_transmission_level")
