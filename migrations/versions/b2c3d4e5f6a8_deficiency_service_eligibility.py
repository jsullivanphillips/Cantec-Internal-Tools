"""Add deficiency service eligibility and non-quoteable phrase tables.

Revision ID: b2c3d4e5f6a8
Revises: a1b2c3d4e5f7
Create Date: 2026-06-16

"""

from alembic import op
import sqlalchemy as sa
from datetime import datetime, timezone


revision = "b2c3d4e5f6a8"
down_revision = "a1b2c3d4e5f7"
branch_labels = None
depends_on = None

SEED_PHRASES = [
    ("fire safety plan", "Fire safety plan"),
    ("fsp", "FSP"),
    ("missing fsp", "Missing FSP"),
    ("no fire safety plan", "No fire safety plan"),
    ("monitoring company", "Monitoring company"),
    ("ul monitoring", "UL monitoring"),
    ("ulc monitoring", "ULC monitoring"),
    ("monitoring account", "Monitoring account"),
    ("wrong monitoring", "Wrong monitoring"),
    ("monitoring vendor", "Monitoring vendor"),
    ("no monitoring", "No monitoring"),
    ("documentation only", "Documentation only"),
    ("for record", "For record"),
    ("record keeping", "Record keeping"),
]


def upgrade():
    op.create_table(
        "deficiency_non_quoteable_phrase",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("phrase", sa.String(length=255), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("phrase", name="uq_deficiency_non_quoteable_phrase"),
    )

    op.create_table(
        "deficiency_service_eligibility",
        sa.Column("deficiency_id", sa.BigInteger(), nullable=False),
        sa.Column("eligible", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("reason", sa.String(length=32), nullable=False, server_default="eligible"),
        sa.Column("detail", sa.String(length=512), nullable=True),
        sa.Column("description_hash", sa.String(length=64), nullable=True),
        sa.Column("classified_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["deficiency_id"],
            ["deficiency.deficiency_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("deficiency_id"),
    )

    phrase_table = sa.table(
        "deficiency_non_quoteable_phrase",
        sa.column("phrase", sa.String),
        sa.column("label", sa.String),
        sa.column("active", sa.Boolean),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    now = datetime.now(timezone.utc)
    op.bulk_insert(
        phrase_table,
        [
            {
                "phrase": phrase,
                "label": label,
                "active": True,
                "created_at": now,
                "updated_at": now,
            }
            for phrase, label in SEED_PHRASES
        ],
    )


def downgrade():
    op.drop_table("deficiency_service_eligibility")
    op.drop_table("deficiency_non_quoteable_phrase")
