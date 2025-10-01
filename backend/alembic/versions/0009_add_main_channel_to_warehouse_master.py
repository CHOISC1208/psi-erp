"""add main_channel to warehouse master"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.config import settings

revision: str = "0009"
down_revision: Union[str, Sequence[str], None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = (settings.db_schema or "").strip() or None
TABLE_NAME = "warehouse_master"
COLUMN_NAME = "main_channel"
FK_NAME = "fk_warehouse_master_main_channel"
CHECK_NAME = "ck_warehouse_master_main_channel_not_blank"


def _create_constraints(batch_op) -> None:
    batch_op.create_check_constraint(
        CHECK_NAME,
        sa.text("main_channel IS NULL OR length(trim(main_channel)) > 0"),
    )
    batch_op.create_foreign_key(
        FK_NAME,
        "channel_master",
        local_cols=[COLUMN_NAME],
        remote_cols=["channel"],
        referent_schema=SCHEMA,
    )


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else ""

    if dialect == "sqlite":
        with op.batch_alter_table(TABLE_NAME, schema=SCHEMA) as batch:
            batch.add_column(sa.Column(COLUMN_NAME, sa.Text(), nullable=True))
            _create_constraints(batch)
        return

    op.add_column(
        TABLE_NAME,
        sa.Column(COLUMN_NAME, sa.Text(), nullable=True),
        schema=SCHEMA,
    )

    op.create_check_constraint(
        CHECK_NAME,
        TABLE_NAME,
        sa.text("main_channel IS NULL OR length(trim(main_channel)) > 0"),
        schema=SCHEMA,
    )

    op.create_foreign_key(
        FK_NAME,
        TABLE_NAME,
        "channel_master",
        local_cols=[COLUMN_NAME],
        remote_cols=["channel"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete=None,
    )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name if bind else ""

    if dialect == "sqlite":
        with op.batch_alter_table(TABLE_NAME, schema=SCHEMA) as batch:
            batch.drop_constraint(FK_NAME, type_="foreignkey")
            batch.drop_constraint(CHECK_NAME, type_="check")
            batch.drop_column(COLUMN_NAME)
        return

    op.drop_constraint(FK_NAME, TABLE_NAME, type_="foreignkey", schema=SCHEMA)
    op.drop_constraint(CHECK_NAME, TABLE_NAME, type_="check", schema=SCHEMA)
    op.drop_column(TABLE_NAME, COLUMN_NAME, schema=SCHEMA)
