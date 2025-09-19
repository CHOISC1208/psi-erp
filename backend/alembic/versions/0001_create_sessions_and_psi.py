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


def upgrade() -> None:
    op.create_table(
        "sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
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
        schema=settings.db_schema,
    )
    op.create_index(
        "uq_sessions_leader_true",
        "sessions",
        ["is_leader"],
        unique=True,
        postgresql_where=sa.text("is_leader = TRUE"),
        schema=settings.db_schema,
    )

    op.create_table(
        "psi_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("record_date", sa.Date(), nullable=False),
        sa.Column("production", sa.Numeric(12, 2), nullable=False),
        sa.Column("sales", sa.Numeric(12, 2), nullable=False),
        sa.Column("reported_inventory", sa.Numeric(12, 2), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["session_id"], [f"{settings.db_schema}.sessions.id"],),
        schema=settings.db_schema,
    )
    op.create_index(
        "ix_psi_records_record_date",
        "psi_records",
        ["record_date"],
        unique=False,
        schema=settings.db_schema,
    )


def downgrade() -> None:
    op.drop_index("ix_psi_records_record_date", table_name="psi_records", schema=settings.db_schema)
    op.drop_table("psi_records", schema=settings.db_schema)
    op.drop_index("uq_sessions_leader_true", table_name="sessions", schema=settings.db_schema)
    op.drop_table("sessions", schema=settings.db_schema)
