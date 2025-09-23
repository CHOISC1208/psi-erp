"""Harden audit metadata and triggers"""
from __future__ import annotations

from typing import Sequence, Union

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.config import settings

# revision identifiers, used by Alembic.
revision: str = "0008"
down_revision: Union[str, Sequence[str], None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = (settings.db_schema or "").strip()
USER_TABLE = "users"
AUDIT_COLUMNS = ("created_by", "updated_by")
AUDIT_TABLES = ("sessions", "psi_edits", "psi_edit_log", "channel_transfers")
FUNCTION_NAME = "update_updated_at_column"


def _qualify(identifier: str) -> str:
    if SCHEMA:
        return f'"{SCHEMA}"."{identifier}"'
    return f'"{identifier}"'


def _qualify_index(index_name: str) -> str:
    if SCHEMA:
        return f'"{SCHEMA}"."{index_name}"'
    return f'"{index_name}"'


def _qualified_function() -> str:
    if SCHEMA:
        return f'"{SCHEMA}"."{FUNCTION_NAME}"'
    return f'"{FUNCTION_NAME}"'


def _execute(sql: str) -> None:
    op.execute(sa.text(sql))


def _ensure_foreign_key(table: str, column: str) -> None:
    constraint_name = f"fk_{table}_{column}_users"
    constraint_exists_check = f"""
SELECT 1
  FROM pg_constraint con
  JOIN pg_namespace nsp ON nsp.oid = con.connamespace
  JOIN pg_class rel ON rel.oid = con.conrelid
 WHERE nsp.nspname = '{SCHEMA}'
   AND rel.relname = '{table}'
   AND con.conname = '{constraint_name}'
"""

    _execute(
        f"""
DO $$
BEGIN
    IF NOT EXISTS ({constraint_exists_check}) THEN
        EXECUTE format(
            'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I.%I(%I) ON DELETE SET NULL NOT VALID',
            '{SCHEMA}', '{table}', '{constraint_name}', '{column}', '{SCHEMA}', '{USER_TABLE}', 'id'
        );
    END IF;
END$$;
"""
    )

    _execute(
        f"""
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_constraint con
          JOIN pg_namespace nsp ON nsp.oid = con.connamespace
          JOIN pg_class rel ON rel.oid = con.conrelid
         WHERE nsp.nspname = '{SCHEMA}'
           AND rel.relname = '{table}'
           AND con.conname = '{constraint_name}'
           AND con.convalidated = false
    ) THEN
        EXECUTE format(
            'ALTER TABLE %I.%I VALIDATE CONSTRAINT %I',
            '{SCHEMA}', '{table}', '{constraint_name}'
        );
    END IF;
END$$;
"""
    )


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name.lower() if bind else ""
    if not dialect.startswith("postgres"):
        return

    for table in AUDIT_TABLES:
        for column in AUDIT_COLUMNS:
            _execute(
                f"ALTER TABLE {_qualify(table)} ADD COLUMN IF NOT EXISTS \"{column}\" uuid"
            )

    _execute(
        f"""
ALTER TABLE {_qualify("psi_edit_log")}
    ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW();
"""
    )

    for table in AUDIT_TABLES:
        for column in AUDIT_COLUMNS:
            index_name = f"ix_{table}_{column}"
            _execute(
                f"CREATE INDEX IF NOT EXISTS \"{index_name}\" ON {_qualify(table)} (\"{column}\")"
            )
            _ensure_foreign_key(table, column)

    _execute(
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

    for table in AUDIT_TABLES:
        trigger_name = f"set_{table}_updated_at"
        _execute(
            f"DROP TRIGGER IF EXISTS \"{trigger_name}\" ON {_qualify(table)}"
        )
        _execute(
            f"""
CREATE TRIGGER "{trigger_name}"
BEFORE UPDATE ON {_qualify(table)}
FOR EACH ROW
EXECUTE FUNCTION {_qualified_function()}();
"""
        )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name.lower() if bind else ""
    if not dialect.startswith("postgres"):
        return

    for table in AUDIT_TABLES:
        for column in AUDIT_COLUMNS:
            index_name = f"ix_{table}_{column}"
            _execute(f"DROP INDEX IF EXISTS {_qualify_index(index_name)}")
