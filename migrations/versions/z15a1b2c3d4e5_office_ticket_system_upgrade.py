"""Upgrade monthly location tickets: tags, comments, new status lifecycle.

Revision ID: z15a1b2c3d4e5
Revises: z14a1b2c3d4e5
Create Date: 2026-06-12

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "z15a1b2c3d4e5"
down_revision = "z14a1b2c3d4e5"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table_name):
        return False
    return any(c["name"] == column_name for c in insp.get_columns(table_name))


def _has_table(table_name: str) -> bool:
    return inspect(op.get_bind()).has_table(table_name)


def upgrade() -> None:
    if not _has_table("monthly_location_ticket"):
        return

    if _has_column("monthly_location_ticket", "body") and not _has_column(
        "monthly_location_ticket", "description"
    ):
        op.alter_column(
            "monthly_location_ticket",
            "body",
            new_column_name="description",
            existing_type=sa.Text(),
            existing_nullable=True,
        )

    if _has_column("monthly_location_ticket", "resolved_at") and not _has_column(
        "monthly_location_ticket", "closed_at"
    ):
        op.alter_column(
            "monthly_location_ticket",
            "resolved_at",
            new_column_name="closed_at",
            existing_type=sa.DateTime(timezone=True),
            existing_nullable=True,
        )

    if not _has_column("monthly_location_ticket", "close_reason"):
        op.add_column(
            "monthly_location_ticket",
            sa.Column("close_reason", sa.String(length=32), nullable=True),
        )

    if not _has_column("monthly_location_ticket", "tags_json"):
        op.add_column(
            "monthly_location_ticket",
            sa.Column("tags_json", sa.Text(), nullable=True),
        )

    op.execute(
        sa.text(
            "UPDATE monthly_location_ticket SET status = 'in_progress' WHERE status = 'email_sent'"
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE monthly_location_ticket
            SET status = 'closed',
                close_reason = COALESCE(close_reason, 'completed')
            WHERE status = 'resolved'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE monthly_location_ticket_event
            SET from_status = 'in_progress'
            WHERE from_status = 'email_sent'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE monthly_location_ticket_event
            SET to_status = 'in_progress'
            WHERE to_status = 'email_sent'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE monthly_location_ticket_event
            SET from_status = 'closed'
            WHERE from_status = 'resolved'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE monthly_location_ticket_event
            SET to_status = 'closed'
            WHERE to_status = 'resolved'
            """
        )
    )

    if not _has_table("monthly_location_ticket_comment"):
        op.create_table(
            "monthly_location_ticket_comment",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("ticket_id", sa.BigInteger(), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("created_by", sa.String(length=128), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.ForeignKeyConstraint(
                ["ticket_id"],
                ["monthly_location_ticket.id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_monthly_location_ticket_comment_ticket_id",
            "monthly_location_ticket_comment",
            ["ticket_id"],
            unique=False,
        )


def downgrade() -> None:
    if _has_table("monthly_location_ticket_comment"):
        op.drop_index(
            "ix_monthly_location_ticket_comment_ticket_id",
            table_name="monthly_location_ticket_comment",
        )
        op.drop_table("monthly_location_ticket_comment")

    if not _has_table("monthly_location_ticket"):
        return

    if _has_column("monthly_location_ticket", "tags_json"):
        op.drop_column("monthly_location_ticket", "tags_json")

    if _has_column("monthly_location_ticket", "close_reason"):
        op.drop_column("monthly_location_ticket", "close_reason")

    op.execute(
        sa.text(
            """
            UPDATE monthly_location_ticket
            SET status = 'resolved'
            WHERE status = 'closed'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE monthly_location_ticket
            SET status = 'email_sent'
            WHERE status = 'in_progress'
            """
        )
    )

    if _has_column("monthly_location_ticket", "closed_at") and not _has_column(
        "monthly_location_ticket", "resolved_at"
    ):
        op.alter_column(
            "monthly_location_ticket",
            "closed_at",
            new_column_name="resolved_at",
            existing_type=sa.DateTime(timezone=True),
            existing_nullable=True,
        )

    if _has_column("monthly_location_ticket", "description") and not _has_column(
        "monthly_location_ticket", "body"
    ):
        op.alter_column(
            "monthly_location_ticket",
            "description",
            new_column_name="body",
            existing_type=sa.Text(),
            existing_nullable=True,
        )
