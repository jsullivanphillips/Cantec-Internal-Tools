"""Add fa_labour & spr_labour to quote/invoice item_type enums

Revision ID: 69f36fd99563
Revises: 662fea1abe3f
Create Date: 2025-06-17 10:41:55.670824

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '69f36fd99563'
down_revision = '662fea1abe3f'
branch_labels = None
depends_on = None


def upgrade():
    # quote_item_type
    op.execute("ALTER TYPE quote_item_type ADD VALUE IF NOT EXISTS 'fa_labour'")
    op.execute("ALTER TYPE quote_item_type ADD VALUE IF NOT EXISTS 'spr_labour'")
    # invoice_item_type
    op.execute("ALTER TYPE invoice_item_type ADD VALUE IF NOT EXISTS 'fa_labour'")
    op.execute("ALTER TYPE invoice_item_type ADD VALUE IF NOT EXISTS 'spr_labour'")


def downgrade():
    pass
