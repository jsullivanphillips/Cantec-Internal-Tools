"""split month into inspection and planned maintenance

Revision ID: 9f59f56fbbec
Revises: e3b01763bd77
Create Date: 2026-01-29 13:09:11.561053

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '9f59f56fbbec'
down_revision = 'e3b01763bd77'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Add new columns (nullable for now)
    op.add_column(
        "scheduling_attack_v2",
        sa.Column("inspection_month", sa.DateTime(timezone=True), nullable=True),
    )

    op.add_column(
        "scheduling_attack_v2",
        sa.Column("planned_maintenance_month", sa.DateTime(timezone=True), nullable=True),
    )

    # 2. Copy existing data
    op.execute("""
        UPDATE scheduling_attack_v2
        SET inspection_month = month
    """)

    # 3. Enforce NOT NULL on inspection_month
    op.alter_column(
        "scheduling_attack_v2",
        "inspection_month",
        nullable=False,
    )

    # 4. Drop old column
    op.drop_column("scheduling_attack_v2", "month")


def downgrade():
    # Recreate old column
    op.add_column(
        "scheduling_attack_v2",
        sa.Column("month", sa.DateTime(timezone=True), nullable=True),
    )

    # Copy data back
    op.execute("""
        UPDATE scheduling_attack_v2
        SET month = inspection_month
    """)

    # Make month NOT NULL again
    op.alter_column(
        "scheduling_attack_v2",
        "month",
        nullable=False,
    )

    # Drop new columns
    op.drop_column("scheduling_attack_v2", "inspection_month")
    op.drop_column("scheduling_attack_v2", "planned_maintenance_month")
