"""Add deficit_basis column to the reallocation policy."""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.config import settings

revision: str = "0014"
down_revision: Union[str, Sequence[str], None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = (settings.db_schema or "").strip() or None
TABLE_NAME = "reallocation_policy"
COLUMN_NAME = "deficit_basis"
CONSTRAINT_NAME = "ck_reallocation_policy_deficit_basis"


def upgrade() -> None:
    with op.batch_alter_table(TABLE_NAME, schema=SCHEMA) as batch_op:
        batch_op.add_column(
            sa.Column(
                COLUMN_NAME,
                sa.Text(),
                nullable=False,
                server_default=sa.text("'closing'"),
            )
        )
        batch_op.create_check_constraint(
            CONSTRAINT_NAME,
            "deficit_basis IN ('start','closing')",
        )


def downgrade() -> None:
    op.drop_constraint(CONSTRAINT_NAME, TABLE_NAME, type_="check", schema=SCHEMA)
    with op.batch_alter_table(TABLE_NAME, schema=SCHEMA) as batch_op:
        batch_op.drop_column(COLUMN_NAME)
