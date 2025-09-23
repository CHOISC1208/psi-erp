"""create reference and planning tables"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.config import settings

revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = settings.db_schema or None


def upgrade() -> None:
    op.create_table(
        "sku_master",
        sa.Column("sku_code", sa.Text(), primary_key=True, nullable=False),
        sa.Column("sku_name", sa.Text(), nullable=False),
        sa.Column("category_1", sa.Text(), nullable=True),
        sa.Column("category_2", sa.Text(), nullable=True),
        sa.Column("category_3", sa.Text(), nullable=True),
        sa.Column("style_color", sa.Text(), nullable=True),
        sa.Column("suggested_retail_price", sa.Numeric(), nullable=True),
        sa.Column("cost_price", sa.Numeric(), nullable=True),
        schema=SCHEMA,
    )

    op.create_table(
        "warehouse_master",
        sa.Column("warehouse_name", sa.Text(), primary_key=True, nullable=False),
        sa.Column("region", sa.Text(), nullable=True),
        schema=SCHEMA,
    )

    op.create_table(
        "channel_master",
        sa.Column("channel", sa.Text(), primary_key=True, nullable=False),
        sa.Column("display_name", sa.Text(), nullable=True),
        schema=SCHEMA,
    )

    op.create_table(
        "demand_plan_daily",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sku_code", sa.Text(), nullable=False),
        sa.Column("warehouse_name", sa.Text(), nullable=False),
        sa.Column("channel", sa.Text(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("forecast_qty", sa.Numeric(), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"], [f"{SCHEMA}.sessions.id" if SCHEMA else "sessions.id"], ondelete="CASCADE"
        ),
        schema=SCHEMA,
    )

    op.create_table(
        "psi_daily_cache",
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sku_code", sa.Text(), nullable=False),
        sa.Column("warehouse_name", sa.Text(), nullable=False),
        sa.Column("channel", sa.Text(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("stock_at_anchor", sa.Numeric(), nullable=True),
        sa.Column("inbound_qty", sa.Numeric(), nullable=True),
        sa.Column("outbound_qty", sa.Numeric(), nullable=True),
        sa.Column("net_flow", sa.Numeric(), nullable=True),
        sa.Column("stock_closing", sa.Numeric(), nullable=True),
        sa.Column("safety_stock", sa.Numeric(), nullable=True),
        sa.Column("movable_stock", sa.Numeric(), nullable=True),
        sa.Column("last_refreshed", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(
            ["session_id"], [f"{SCHEMA}.sessions.id" if SCHEMA else "sessions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint(
            "session_id",
            "sku_code",
            "warehouse_name",
            "channel",
            "date",
        ),
        schema=SCHEMA,
    )

    op.create_table(
        "session_params",
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"], [f"{SCHEMA}.sessions.id" if SCHEMA else "sessions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("session_id", "key"),
        schema=SCHEMA,
    )

    op.create_table(
        "stock_transfers",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sku_code", sa.Text(), nullable=False),
        sa.Column("from_warehouse", sa.Text(), nullable=True),
        sa.Column("to_warehouse", sa.Text(), nullable=True),
        sa.Column("channel", sa.Text(), nullable=True),
        sa.Column("qty", sa.Numeric(), nullable=False),
        sa.Column("transfer_date", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["session_id"], [f"{SCHEMA}.sessions.id" if SCHEMA else "sessions.id"], ondelete="CASCADE"
        ),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("stock_transfers", schema=SCHEMA)
    op.drop_table("session_params", schema=SCHEMA)
    op.drop_table("psi_daily_cache", schema=SCHEMA)
    op.drop_table("demand_plan_daily", schema=SCHEMA)
    op.drop_table("channel_master", schema=SCHEMA)
    op.drop_table("warehouse_master", schema=SCHEMA)
    op.drop_table("sku_master", schema=SCHEMA)
