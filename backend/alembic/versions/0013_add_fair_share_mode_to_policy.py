"""Add fair_share_mode column to the reallocation policy."""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.config import settings

revision: str = "0013"
down_revision: Union[str, Sequence[str], None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = (settings.db_schema or "").strip() or None
TABLE_NAME = "reallocation_policy"
COLUMN_NAME = "fair_share_mode"
CONSTRAINT_NAME = "ck_fair_share_mode"


def upgrade() -> None:
    with op.batch_alter_table(TABLE_NAME, schema=SCHEMA) as batch_op:
        batch_op.add_column(
            sa.Column(
                COLUMN_NAME,
                sa.Text(),
                nullable=False,
                server_default=sa.text("'off'"),
            )
        )
        batch_op.create_check_constraint(
            CONSTRAINT_NAME,
            "fair_share_mode IN ('off','equalize_ratio_closing','equalize_ratio_start')",
        )


def downgrade() -> None:
    op.drop_constraint(CONSTRAINT_NAME, TABLE_NAME, type_="check", schema=SCHEMA)
    with op.batch_alter_table(TABLE_NAME, schema=SCHEMA) as batch_op:
        batch_op.drop_column(COLUMN_NAME)
