from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.config import settings

revision: str = "0012"
down_revision: Union[str, Sequence[str], None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = (settings.db_schema or "").strip() or None
TABLE_NAME = "reallocation_policy"
ROUNDING_CHECK = "ck_reallocation_policy_rounding_mode"


def upgrade() -> None:
    op.create_table(
        TABLE_NAME,
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("take_from_other_main", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("rounding_mode", sa.Text(), nullable=False, server_default=sa.text("'floor'")),
        sa.Column("allow_overfill", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_by", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "rounding_mode IN ('floor','round','ceil')",
            name=ROUNDING_CHECK,
        ),
        schema=SCHEMA,
    )
    insert = sa.text(
        "INSERT INTO {table} (id) SELECT 1 WHERE NOT EXISTS ("
        "SELECT 1 FROM {table} WHERE id = 1)".format(
            table=f"{SCHEMA + '.' if SCHEMA else ''}{TABLE_NAME}"
        )
    )
    op.execute(insert)


def downgrade() -> None:
    op.drop_table(TABLE_NAME, schema=SCHEMA)
