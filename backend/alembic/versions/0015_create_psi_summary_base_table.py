"""create psi summary base table"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.config import settings

revision: str = "0015"
down_revision: Union[str, Sequence[str], None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = settings.db_schema or None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("psi_summary_base", schema=SCHEMA):
        return

    session_target = f"{SCHEMA}.sessions.id" if SCHEMA else "sessions.id"

    op.create_table(
        "psi_summary_base",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sku_code", sa.Text(), nullable=False),
        sa.Column("sku_name", sa.Text(), nullable=True),
        sa.Column("warehouse_name", sa.Text(), nullable=False),
        sa.Column("channel", sa.Text(), nullable=False),
        sa.Column("inbound_qty", sa.Numeric(), nullable=True),
        sa.Column("outbound_qty", sa.Numeric(), nullable=True),
        sa.Column("std_stock", sa.Numeric(), nullable=True),
        sa.Column("stock", sa.Numeric(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["session_id"], [session_target], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "session_id",
            "sku_code",
            "warehouse_name",
            "channel",
            name="uq_psi_summary_base_key",
        ),
        schema=SCHEMA,
    )

    op.create_index(
        "idx_psi_summary_base_lookup",
        "psi_summary_base",
        ["session_id", "sku_code", "warehouse_name", "channel"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_index("idx_psi_summary_base_lookup", table_name="psi_summary_base", schema=SCHEMA)
    op.drop_table("psi_summary_base", schema=SCHEMA)
