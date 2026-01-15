"""adding support for scheduling reachout and cancelled

Revision ID: 7a4a344434a8
Revises: e9bfeac9e62c
Create Date: 2026-01-15 15:18:06.696331

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7a4a344434a8'
down_revision = 'e9bfeac9e62c'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "scheduling_cancelled",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("location_id", sa.BigInteger(), sa.ForeignKey("location.location_id", ondelete="CASCADE"), nullable=False),
        sa.Column("observed_month", sa.Date(), nullable=False),
        sa.Column("cancelled_by", sa.String(length=255), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.UniqueConstraint("location_id", "observed_month", name="uq_cancelled_loc_month"),
    )
    op.create_index("ix_scheduling_cancelled_location_id", "scheduling_cancelled", ["location_id"])
    op.create_index("ix_scheduling_cancelled_observed_month", "scheduling_cancelled", ["observed_month"])

    op.create_table(
        "scheduling_reached_out",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("job_id", sa.BigInteger(), sa.ForeignKey("service_occurrence.job_id", ondelete="CASCADE"), nullable=True, unique=True),
        sa.Column("location_id", sa.BigInteger(), sa.ForeignKey("location.location_id", ondelete="SET NULL"), nullable=True),
        sa.Column("address", sa.String(length=255), nullable=True),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reached_out_by", sa.String(length=255), nullable=True),
        sa.Column("reached_out_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.UniqueConstraint("location_id", "address", "scheduled_for", name="uq_reachedout_loc_addr_sched"),
    )
    op.create_index("ix_scheduling_reached_out_job_id", "scheduling_reached_out", ["job_id"])
    op.create_index("ix_scheduling_reached_out_location_id", "scheduling_reached_out", ["location_id"])
    op.create_index("ix_scheduling_reached_out_address", "scheduling_reached_out", ["address"])
    op.create_index("ix_scheduling_reached_out_scheduled_for", "scheduling_reached_out", ["scheduled_for"])
    op.create_index("ix_scheduling_reached_out_reached_out_at", "scheduling_reached_out", ["reached_out_at"])


def downgrade():
    op.drop_index("ix_scheduling_reached_out_reached_out_at", table_name="scheduling_reached_out")
    op.drop_index("ix_scheduling_reached_out_scheduled_for", table_name="scheduling_reached_out")
    op.drop_index("ix_scheduling_reached_out_address", table_name="scheduling_reached_out")
    op.drop_index("ix_scheduling_reached_out_location_id", table_name="scheduling_reached_out")
    op.drop_index("ix_scheduling_reached_out_job_id", table_name="scheduling_reached_out")
    op.drop_table("scheduling_reached_out")

    op.drop_index("ix_scheduling_cancelled_observed_month", table_name="scheduling_cancelled")
    op.drop_index("ix_scheduling_cancelled_location_id", table_name="scheduling_cancelled")
    op.drop_table("scheduling_cancelled")
