"""convert rank columns to varchar"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.config import settings

revision: str = "0010"
down_revision: Union[str, Sequence[str], None] = ("0009", "0009a")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = (settings.db_schema or "").strip() or None
TABLE_NAME = "psi_base"
COLUMNS = ("fw_rank", "ss_rank")


def _existing_columns(bind: sa.engine.Connection | sa.engine.Engine) -> set[str]:
    inspector = sa.inspect(bind)
    columns = inspector.get_columns(TABLE_NAME, schema=SCHEMA)
    return {column["name"] for column in columns}


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else ""
    existing = _existing_columns(bind)

    to_add = [column for column in COLUMNS if column not in existing]
    for column in to_add:
        op.add_column(
            TABLE_NAME,
            sa.Column(column, sa.String(length=2), nullable=True),
            schema=SCHEMA,
        )

    to_alter = [column for column in COLUMNS if column in existing]
    if not to_alter:
        return

    if dialect == "postgresql":
        for column in to_alter:
            op.alter_column(
                TABLE_NAME,
                column,
                existing_type=sa.Integer(),
                type_=sa.String(length=2),
                existing_nullable=True,
                schema=SCHEMA,
                postgresql_using=f"NULLIF({column}::text, '')",
            )
        return

    with op.batch_alter_table(TABLE_NAME, schema=SCHEMA) as batch_op:
        for column in to_alter:
            batch_op.alter_column(
                column,
                existing_type=sa.Integer(),
                type_=sa.String(length=2),
                existing_nullable=True,
            )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else ""

    if dialect == "postgresql":
        for column in COLUMNS:
            op.alter_column(
                TABLE_NAME,
                column,
                existing_type=sa.String(length=2),
                type_=sa.Integer(),
                existing_nullable=True,
                schema=SCHEMA,
                postgresql_using=(
                    f"CASE WHEN {column} ~ '^[0-9]+$' THEN {column}::integer ELSE NULL END"
                ),
            )
        return

    with op.batch_alter_table(TABLE_NAME, schema=SCHEMA) as batch_op:
        for column in COLUMNS:
            batch_op.alter_column(
                column,
                existing_type=sa.String(length=2),
                type_=sa.Integer(),
                existing_nullable=True,
            )
