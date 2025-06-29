"""remove clock in and out

Revision ID: 4e7bc47c12f2
Revises: e58893549af1
Create Date: 2025-06-18 13:01:22.940961

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '4e7bc47c12f2'
down_revision = 'e58893549af1'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('clock_event', schema=None) as batch_op:
        batch_op.drop_column('clock_out')
        batch_op.drop_column('clock_in')

    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('clock_event', schema=None) as batch_op:
        batch_op.add_column(sa.Column('clock_in', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True))
        batch_op.add_column(sa.Column('clock_out', postgresql.TIMESTAMP(timezone=True), autoincrement=False, nullable=True))

    # ### end Alembic commands ###
