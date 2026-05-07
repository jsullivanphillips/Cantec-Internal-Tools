"""Add route_stop_order to monthly_route_location for stop sequencing.

Revision ID: d1e2f3a4b5c6
Revises: c4d8e2a1b9f0

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision = "d1e2f3a4b5c6"
down_revision = "c4d8e2a1b9f0"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "monthly_route_location",
        sa.Column("route_stop_order", sa.SmallInteger(), nullable=True),
    )

    conn = op.get_bind()
    rows = conn.execute(
        text(
            """
            SELECT id, monthly_route_id
            FROM monthly_route_location
            WHERE monthly_route_id IS NOT NULL
            ORDER BY monthly_route_id, address ASC, id ASC
            """
        )
    ).fetchall()

    current_route = None
    idx = 0
    for row in rows:
        rid = row[1]
        if rid != current_route:
            current_route = rid
            idx = 0
        conn.execute(
            text("UPDATE monthly_route_location SET route_stop_order = :ord WHERE id = :id"),
            {"ord": idx, "id": row[0]},
        )
        idx += 1


def downgrade():
    op.drop_column("monthly_route_location", "route_stop_order")
