"""add audit columns and triggers"""
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
FUNCTION_NAME = "update_updated_at_column"
FUNCTION_SCHEMA = settings.db_schema or "public"


def _qualified_table(name: str) -> str:
    if SCHEMA:
        return f'"{SCHEMA}"."{name}"'
    return f'"{name}"'


def _qualified_function() -> str:
    if FUNCTION_SCHEMA:
        return f'"{FUNCTION_SCHEMA}"."{FUNCTION_NAME}"'
    return f'"{FUNCTION_NAME}"'


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name.lower() if bind else ""
    supports_fk = not dialect.startswith("sqlite")
    is_postgres = dialect.startswith("postgres")

    user_table = "users"
    user_schema = SCHEMA
    user_target = ["id"]

    # sessions audit columns
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
    if supports_fk:
        op.create_foreign_key(
            "fk_sessions_created_by_users",
            "sessions",
            user_table,
            ["created_by"],
            user_target,
            source_schema=SCHEMA,
            referent_schema=user_schema,
            ondelete="SET NULL",
        )
        op.create_foreign_key(
            "fk_sessions_updated_by_users",
            "sessions",
            user_table,
            ["updated_by"],
            user_target,
            source_schema=SCHEMA,
            referent_schema=user_schema,
            ondelete="SET NULL",
        )

    # psi_edits audit columns
    op.add_column(
        "psi_edits",
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "psi_edits",
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )
    if supports_fk:
        op.create_foreign_key(
            "fk_psi_edits_created_by_users",
            "psi_edits",
            user_table,
            ["created_by"],
            user_target,
            source_schema=SCHEMA,
            referent_schema=user_schema,
            ondelete="SET NULL",
        )
        op.create_foreign_key(
            "fk_psi_edits_updated_by_users",
            "psi_edits",
            user_table,
            ["updated_by"],
            user_target,
            source_schema=SCHEMA,
            referent_schema=user_schema,
            ondelete="SET NULL",
        )

    # channel_transfers audit columns
    op.add_column(
        "channel_transfers",
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "channel_transfers",
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )
    if supports_fk:
        op.create_foreign_key(
            "fk_channel_transfers_created_by_users",
            "channel_transfers",
            user_table,
            ["created_by"],
            user_target,
            source_schema=SCHEMA,
            referent_schema=user_schema,
            ondelete="SET NULL",
        )
        op.create_foreign_key(
            "fk_channel_transfers_updated_by_users",
            "channel_transfers",
            user_table,
            ["updated_by"],
            user_target,
            source_schema=SCHEMA,
            referent_schema=user_schema,
            ondelete="SET NULL",
        )

    # psi_edit_log audit columns
    op.add_column(
        "psi_edit_log",
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "psi_edit_log",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "psi_edit_log",
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "psi_edit_log",
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        schema=SCHEMA,
    )

    if supports_fk:
        op.create_foreign_key(
            "fk_psi_edit_log_created_by_users",
            "psi_edit_log",
            user_table,
            ["created_by"],
            user_target,
            source_schema=SCHEMA,
            referent_schema=user_schema,
            ondelete="SET NULL",
        )
        op.create_foreign_key(
            "fk_psi_edit_log_updated_by_users",
            "psi_edit_log",
            user_table,
            ["updated_by"],
            user_target,
            source_schema=SCHEMA,
            referent_schema=user_schema,
            ondelete="SET NULL",
        )

    if is_postgres:
        op.alter_column(
            "psi_edit_log",
            "edited_by",
            type_=postgresql.UUID(as_uuid=True),
            existing_nullable=True,
            postgresql_using="NULLIF(edited_by, '')::uuid",
            schema=SCHEMA,
        )
    if supports_fk:
        op.create_foreign_key(
            "fk_psi_edit_log_edited_by_users",
            "psi_edit_log",
            user_table,
            ["edited_by"],
            user_target,
            source_schema=SCHEMA,
            referent_schema=user_schema,
            ondelete="SET NULL",
        )

    if is_postgres:
        op.execute(
            sa.text(
                f"""
                CREATE OR REPLACE FUNCTION {_qualified_function()}()
                RETURNS trigger AS $$
                BEGIN
                    NEW.updated_at = NOW();
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;
                """
            )
        )

        for table in ("sessions", "psi_edits", "psi_edit_log", "channel_transfers"):
            trigger_name = f"set_{table}_updated_at"
            op.execute(
                sa.text(
                    f"""
                    DROP TRIGGER IF EXISTS {trigger_name} ON {_qualified_table(table)};
                    CREATE TRIGGER {trigger_name}
                    BEFORE UPDATE ON {_qualified_table(table)}
                    FOR EACH ROW
                    EXECUTE FUNCTION {_qualified_function()}();
                    """
                )
            )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name.lower() if bind else ""
    supports_fk = not dialect.startswith("sqlite")
    is_postgres = dialect.startswith("postgres")

    if is_postgres:
        for table in ("sessions", "psi_edits", "psi_edit_log", "channel_transfers"):
            trigger_name = f"set_{table}_updated_at"
            op.execute(
                sa.text(
                    f"DROP TRIGGER IF EXISTS {trigger_name} ON {_qualified_table(table)};"
                )
            )
        op.execute(sa.text(f"DROP FUNCTION IF EXISTS {_qualified_function()}();"))

    if supports_fk:
        op.drop_constraint(
            "fk_psi_edit_log_edited_by_users",
            "psi_edit_log",
            type_="foreignkey",
            schema=SCHEMA,
        )
    if is_postgres:
        op.alter_column(
            "psi_edit_log",
            "edited_by",
            type_=sa.Text(),
            existing_nullable=True,
            schema=SCHEMA,
        )

    if supports_fk:
        op.drop_constraint(
            "fk_psi_edit_log_updated_by_users",
            "psi_edit_log",
            type_="foreignkey",
            schema=SCHEMA,
        )
        op.drop_constraint(
            "fk_psi_edit_log_created_by_users",
            "psi_edit_log",
            type_="foreignkey",
            schema=SCHEMA,
        )
    op.drop_column("psi_edit_log", "updated_by", schema=SCHEMA)
    op.drop_column("psi_edit_log", "created_by", schema=SCHEMA)
    op.drop_column("psi_edit_log", "updated_at", schema=SCHEMA)
    op.drop_column("psi_edit_log", "created_at", schema=SCHEMA)

    if supports_fk:
        op.drop_constraint(
            "fk_channel_transfers_updated_by_users",
            "channel_transfers",
            type_="foreignkey",
            schema=SCHEMA,
        )
        op.drop_constraint(
            "fk_channel_transfers_created_by_users",
            "channel_transfers",
            type_="foreignkey",
            schema=SCHEMA,
        )
    op.drop_column("channel_transfers", "updated_by", schema=SCHEMA)
    op.drop_column("channel_transfers", "created_by", schema=SCHEMA)

    if supports_fk:
        op.drop_constraint(
            "fk_psi_edits_updated_by_users",
            "psi_edits",
            type_="foreignkey",
            schema=SCHEMA,
        )
        op.drop_constraint(
            "fk_psi_edits_created_by_users",
            "psi_edits",
            type_="foreignkey",
            schema=SCHEMA,
        )
    op.drop_column("psi_edits", "updated_by", schema=SCHEMA)
    op.drop_column("psi_edits", "created_by", schema=SCHEMA)

    if supports_fk:
        op.drop_constraint(
            "fk_sessions_updated_by_users",
            "sessions",
            type_="foreignkey",
            schema=SCHEMA,
        )
        op.drop_constraint(
            "fk_sessions_created_by_users",
            "sessions",
            type_="foreignkey",
            schema=SCHEMA,
        )
    op.drop_column("sessions", "updated_by", schema=SCHEMA)
    op.drop_column("sessions", "created_by", schema=SCHEMA)
