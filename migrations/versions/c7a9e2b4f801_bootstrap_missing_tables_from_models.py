"""bootstrap missing tables from ORM metadata

Use when the database is empty or partial but alembic_version is already at
head: creates any table defined in app.db_models that does not exist yet.
Does not truncate or drop data. Safe to run multiple times (checkfirst=True).

Revision ID: c7a9e2b4f801
Revises: b8e4f2a91c3d
Create Date: 2026-04-07

"""
from alembic import op


revision = "c7a9e2b4f801"
down_revision = "b8e4f2a91c3d"
branch_labels = None
depends_on = None


def upgrade():
    import app.db_models  # noqa: F401 — registers all models on metadata
    from app.db_models import db

    bind = op.get_bind()
    db.metadata.create_all(bind=bind, checkfirst=True)


def downgrade():
    """Intentionally empty: never drop all app tables from this revision."""
    pass
