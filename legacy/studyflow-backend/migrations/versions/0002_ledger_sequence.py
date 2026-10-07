"""Stable posting order, independent of request clock and UUID order."""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("ledger", sa.Column("sequence", sa.BigInteger(), sa.Identity(), nullable=False))
    op.create_unique_constraint("uq_ledger_sequence", "ledger", ["sequence"])


def downgrade():
    op.drop_constraint("uq_ledger_sequence", "ledger", type_="unique")
    op.drop_column("ledger", "sequence")
