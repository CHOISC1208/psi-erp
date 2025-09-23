"""create channel transfers table"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.config import settings

revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = settings.db_schema or None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("channel_transfers", schema=SCHEMA):
        return

    target = f"{SCHEMA}.sessions.id" if SCHEMA else "sessions.id"

    op.create_table(
        "channel_transfers",
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sku_code", sa.Text(), nullable=False),
        sa.Column("warehouse_name", sa.Text(), nullable=False),
        sa.Column("transfer_date", sa.Date(), nullable=False),
        sa.Column("from_channel", sa.Text(), nullable=False),
        sa.Column("to_channel", sa.Text(), nullable=False),
        sa.Column("qty", sa.Numeric(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["session_id"], [target], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint(
            "session_id",
            "sku_code",
            "warehouse_name",
            "transfer_date",
            "from_channel",
            "to_channel",
        ),
        sa.UniqueConstraint(
            "session_id",
            "sku_code",
            "warehouse_name",
            "transfer_date",
            "from_channel",
            "to_channel",
            name="uq_channel_transfers_key",
        ),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("channel_transfers", schema=SCHEMA)
