"""create category rank parameters table"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.config import settings

revision: str = "0009"
down_revision: Union[str, Sequence[str], None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = settings.db_schema or None


def upgrade() -> None:
    op.create_table(
        "category_rank_parameters",
        sa.Column("rank_type", sa.Text(), nullable=False),
        sa.Column("category_1", sa.Text(), nullable=False),
        sa.Column("category_2", sa.Text(), nullable=False),
        sa.Column("threshold", sa.Numeric(), nullable=False),
        sa.CheckConstraint(
            "rank_type IN ('FW', 'SS')",
            name="ck_category_rank_parameters_rank_type",
        ),
        sa.PrimaryKeyConstraint("rank_type", "category_1", "category_2"),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("category_rank_parameters", schema=SCHEMA)
