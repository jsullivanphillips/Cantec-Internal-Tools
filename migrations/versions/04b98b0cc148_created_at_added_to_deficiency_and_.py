"""CREATED_at added to deficiency and service event

Revision ID: 04b98b0cc148
Revises: e3714415220d
Create Date: 2026-02-03 13:28:46.014064
"""
from alembic import op
import sqlalchemy as sa

revision = "04b98b0cc148"
down_revision = "e3714415220d"
branch_labels = None
depends_on = None


FK_DEFICIENCY_LINKED_SERVICE = "fk_vehicle_deficiency_linked_service_id_vehicle_service_event"
IX_DEFICIENCY_LINKED_SERVICE = "ix_vehicle_deficiency_linked_service_id"
IX_SERVICE_EVENT_STATUS = "ix_vehicle_service_event_service_status"


def upgrade():
    # --- vehicle_deficiency ---
    with op.batch_alter_table("vehicle_deficiency", schema=None) as batch_op:
        # Add columns
        batch_op.add_column(sa.Column("linked_service_id", sa.BigInteger(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            )
        )

    # Backfill status BEFORE making it non-nullable
    op.execute(
        sa.text(
            """
            UPDATE vehicle_deficiency
            SET status = 'OPEN'
            WHERE status IS NULL
            """
        )
    )

    with op.batch_alter_table("vehicle_deficiency", schema=None) as batch_op:
        # Make status non-nullable + give DB-level default
        batch_op.alter_column(
            "status",
            existing_type=sa.VARCHAR(length=64),
            nullable=False,
            server_default=sa.text("'OPEN'"),
        )

        # Index + FK (named so downgrade is clean)
        batch_op.create_index(IX_DEFICIENCY_LINKED_SERVICE, ["linked_service_id"], unique=False)
        batch_op.create_foreign_key(
            FK_DEFICIENCY_LINKED_SERVICE,
            "vehicle_service_event",
            ["linked_service_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # --- vehicle_service_event ---
    with op.batch_alter_table("vehicle_service_event", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            )
        )
        batch_op.create_index(IX_SERVICE_EVENT_STATUS, ["service_status"], unique=False)


def downgrade():
    # --- vehicle_service_event ---
    with op.batch_alter_table("vehicle_service_event", schema=None) as batch_op:
        batch_op.drop_index(IX_SERVICE_EVENT_STATUS)
        batch_op.drop_column("created_at")

    # --- vehicle_deficiency ---
    with op.batch_alter_table("vehicle_deficiency", schema=None) as batch_op:
        batch_op.drop_constraint(FK_DEFICIENCY_LINKED_SERVICE, type_="foreignkey")
        batch_op.drop_index(IX_DEFICIENCY_LINKED_SERVICE)

        # Revert status nullability + remove server default
        batch_op.alter_column(
            "status",
            existing_type=sa.VARCHAR(length=64),
            nullable=True,
            server_default=None,
        )

        batch_op.drop_column("created_at")
        batch_op.drop_column("linked_service_id")
