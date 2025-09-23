"""add session operator columns"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.config import settings

# revision identifiers, used by Alembic.
revision: str = "0007"
down_revision: Union[str, Sequence[str], None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = settings.db_schema or None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "sessions",
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )

    op.create_index(
        "idx_sessions_created_by",
        "sessions",
        ["created_by"],
        unique=False,
        schema=SCHEMA,
    )
    op.create_index(
        "idx_sessions_updated_by",
        "sessions",
        ["updated_by"],
        unique=False,
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("idx_sessions_updated_by", table_name="sessions", schema=SCHEMA)
    op.drop_index("idx_sessions_created_by", table_name="sessions", schema=SCHEMA)

    op.drop_column("sessions", "updated_by", schema=SCHEMA)
    op.drop_column("sessions", "created_by", schema=SCHEMA)
