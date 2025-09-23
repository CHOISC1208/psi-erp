"""create sessions and psi tables"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.config import settings

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = settings.db_schema or None


def upgrade() -> None:
    op.create_table(
        "sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_leader", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        schema=SCHEMA,
    )

    op.create_index(
        "uq_sessions_leader_true",
        "sessions",
        ["is_leader"],
        unique=True,
        postgresql_where=sa.text("is_leader = TRUE"),
        schema=SCHEMA,
    )

    op.create_table(
        "psi_base",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sku_code", sa.Text(), nullable=False),
        sa.Column("sku_name", sa.Text(), nullable=True),
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
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], [f"{SCHEMA}.sessions.id" if SCHEMA else "sessions.id"], ondelete="CASCADE"
        ),
        schema=SCHEMA,
    )

    op.create_table(
        "psi_edits",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sku_code", sa.Text(), nullable=False),
        sa.Column("warehouse_name", sa.Text(), nullable=False),
        sa.Column("channel", sa.Text(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("inbound_qty", sa.Numeric(), nullable=True),
        sa.Column("outbound_qty", sa.Numeric(), nullable=True),
        sa.Column("safety_stock", sa.Numeric(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["session_id"], [f"{SCHEMA}.sessions.id" if SCHEMA else "sessions.id"], ondelete="CASCADE"
        ),
        schema=SCHEMA,
    )

    op.create_table(
        "psi_edit_log",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sku_code", sa.Text(), nullable=False),
        sa.Column("warehouse_name", sa.Text(), nullable=False),
        sa.Column("channel", sa.Text(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("field", sa.Text(), nullable=False),
        sa.Column("old_value", sa.Numeric(), nullable=True),
        sa.Column("new_value", sa.Numeric(), nullable=True),
        sa.Column(
            "edited_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("edited_by", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["session_id"], [f"{SCHEMA}.sessions.id" if SCHEMA else "sessions.id"], ondelete="CASCADE"
        ),
        schema=SCHEMA,
    )

    op.create_table(
        "psi_metrics_master",
        sa.Column("name", sa.Text(), primary_key=True, nullable=False),
        sa.Column("is_editable", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("display_order", sa.Integer(), nullable=False),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("psi_metrics_master", schema=SCHEMA)
    op.drop_table("psi_edit_log", schema=SCHEMA)
    op.drop_table("psi_edits", schema=SCHEMA)
    op.drop_table("psi_base", schema=SCHEMA)
    op.drop_index("uq_sessions_leader_true", table_name="sessions", schema=SCHEMA)
    op.drop_table("sessions", schema=SCHEMA)
