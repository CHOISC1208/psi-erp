"""Ensure planning sessions use the ``data_mode`` column."""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.config import settings

revision: str = "0016"
down_revision: Union[str, Sequence[str], None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = settings.db_schema or None


def _qualified(table: str) -> str:
    return f"{SCHEMA}.{table}" if SCHEMA else table


def _session_table_columns(inspector: sa.Inspector) -> set[str]:
    return {column["name"] for column in inspector.get_columns("sessions", schema=SCHEMA)}


def _session_check_constraints(inspector: sa.Inspector) -> set[str]:
    return {
        constraint["name"]
        for constraint in inspector.get_check_constraints("sessions", schema=SCHEMA)
    }


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    columns = _session_table_columns(inspector)

    if "data_mode" not in columns and "data_type" in columns:
        op.alter_column(
            "sessions",
            "data_type",
            new_column_name="data_mode",
            schema=SCHEMA,
            existing_type=sa.String(length=16),
        )
        columns = _session_table_columns(sa.inspect(op.get_bind()))

    if "data_mode" not in columns:
        op.add_column(
            "sessions",
            sa.Column(
                "data_mode",
                sa.String(length=16),
                nullable=False,
                server_default=sa.text("'base'"),
            ),
            schema=SCHEMA,
        )
        columns.add("data_mode")

    if "data_type" in columns and "data_mode" in columns:
        session_table = _qualified("sessions")
        op.execute(
            sa.text(
                f"UPDATE {session_table} "
                "SET data_mode = COALESCE(data_mode, data_type, 'base')"
            )
        )
        if bind.dialect.name != "sqlite":
            op.drop_column("sessions", "data_type", schema=SCHEMA)

    if bind.dialect.name != "sqlite":
        op.alter_column(
            "sessions",
            "data_mode",
            nullable=False,
            server_default=sa.text("'base'"),
            existing_type=sa.String(length=16),
            schema=SCHEMA,
        )

    constraints = _session_check_constraints(sa.inspect(op.get_bind()))
    if bind.dialect.name != "sqlite" and "ck_sessions_data_mode" not in constraints:
        op.create_check_constraint(
            "ck_sessions_data_mode",
            "sessions",
            "data_mode IN ('base','summary')",
            schema=SCHEMA,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    constraints = _session_check_constraints(inspector)
    if bind.dialect.name != "sqlite" and "ck_sessions_data_mode" in constraints:
        op.drop_constraint("ck_sessions_data_mode", "sessions", schema=SCHEMA)

    columns = _session_table_columns(inspector)
    if "data_type" not in columns:
        op.add_column(
            "sessions",
            sa.Column(
                "data_type",
                sa.String(length=16),
                nullable=False,
                server_default=sa.text("'base'"),
            ),
            schema=SCHEMA,
        )

    session_table = _qualified("sessions")
    op.execute(
        sa.text(
            f"UPDATE {session_table} SET data_type = COALESCE(data_mode, 'base')"
        )
    )

    if bind.dialect.name != "sqlite":
        op.alter_column(
            "sessions",
            "data_type",
            nullable=False,
            server_default=sa.text("'base'"),
            existing_type=sa.String(length=16),
            schema=SCHEMA,
        )

    if bind.dialect.name != "sqlite":
        op.drop_column("sessions", "data_mode", schema=SCHEMA)
