"""update rank type constraint"""
from __future__ import annotations

from typing import Sequence, Union
from alembic import op

from app.config import settings

revision: str = "0011"
down_revision: Union[str, Sequence[str], None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = (settings.db_schema or "").strip() or None
TABLE_NAME = "category_rank_parameters"
OLD_CONSTRAINT = "ck_category_rank_parameters_rank_type"
NEW_CONSTRAINT = "ck_category_rank_parameters_rank_type_length"


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else ""

    if dialect == "postgresql":
        op.drop_constraint(OLD_CONSTRAINT, TABLE_NAME, type_="check", schema=SCHEMA)
        op.create_check_constraint(
            NEW_CONSTRAINT,
            TABLE_NAME,
            "length(rank_type) BETWEEN 1 AND 2",
            schema=SCHEMA,
        )
        return

    with op.batch_alter_table(TABLE_NAME, schema=SCHEMA) as batch_op:
        batch_op.drop_constraint(OLD_CONSTRAINT, type_="check")
        batch_op.create_check_constraint(
            NEW_CONSTRAINT,
            "length(rank_type) BETWEEN 1 AND 2",
        )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else ""

    if dialect == "postgresql":
        op.drop_constraint(NEW_CONSTRAINT, TABLE_NAME, type_="check", schema=SCHEMA)
        op.create_check_constraint(
            OLD_CONSTRAINT,
            TABLE_NAME,
            "rank_type IN ('FW', 'SS')",
            schema=SCHEMA,
        )
        return

    with op.batch_alter_table(TABLE_NAME, schema=SCHEMA) as batch_op:
        batch_op.drop_constraint(NEW_CONSTRAINT, type_="check")
        batch_op.create_check_constraint(
            OLD_CONSTRAINT,
            "rank_type IN ('FW', 'SS')",
        )
