"""merge alembic heads

Revision ID: fc1bc3bded62
Revises: 04b98b0cc148, c6e3f2a3b8d1
Create Date: 2026-03-18 14:49:23.718842

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'fc1bc3bded62'
down_revision = ('04b98b0cc148', 'c6e3f2a3b8d1')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
