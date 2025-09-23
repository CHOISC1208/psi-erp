"""Hardening audit metadata for psi schema."""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0008"
down_revision: Union[str, Sequence[str], None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = "psi"
AUDIT_COLUMNS = ("created_by", "updated_by")
AUDITED_TABLES = (
    "sessions",
    "psi_edits",
    "psi_edit_log",
    "channel_transfers",
)
TRIGGER_TEMPLATE = "set_{table}_updated_at"


def _qualified_table(table_name: str) -> str:
    return f'{SCHEMA}."{table_name}"'


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text(f'SET search_path TO "{SCHEMA}", public'))

    op.execute(
        sa.text(
            """
            CREATE OR REPLACE FUNCTION psi.update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = NOW();
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
            """
        )
    )

    for table_name in AUDITED_TABLES:
        qualified_table = _qualified_table(table_name)

        for column in AUDIT_COLUMNS:
            op.execute(
                sa.text(
                    f"ALTER TABLE IF EXISTS {qualified_table} "
                    f'ADD COLUMN IF NOT EXISTS "{column}" UUID'
                )
            )

            index_name = f"idx_{table_name}_{column}"
            op.execute(
                sa.text(
                    f"CREATE INDEX IF NOT EXISTS {index_name} "
                    f"ON {qualified_table} (\"{column}\")"
                )
            )

            constraint_name = f"{table_name}_{column}_fkey"
            op.execute(
                sa.text(
                    f"""
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1
                            FROM pg_constraint
                            WHERE conrelid = '{SCHEMA}.{table_name}'::regclass
                              AND conname = '{constraint_name}'
                        ) THEN
                            ALTER TABLE {qualified_table}
                            ADD CONSTRAINT {constraint_name}
                            FOREIGN KEY (\"{column}\")
                            REFERENCES {SCHEMA}.users(id)
                            ON DELETE SET NULL
                            NOT VALID;
                        END IF;
                    END;
                    $$;
                    """
                )
            )

            op.execute(
                sa.text(
                    f"""
                    DO $$
                    BEGIN
                        IF EXISTS (
                            SELECT 1
                            FROM pg_constraint
                            WHERE conrelid = '{SCHEMA}.{table_name}'::regclass
                              AND conname = '{constraint_name}'
                              AND NOT convalidated
                        ) THEN
                            ALTER TABLE {qualified_table}
                            VALIDATE CONSTRAINT {constraint_name};
                        END IF;
                    END;
                    $$;
                    """
                )
            )

        trigger_name = TRIGGER_TEMPLATE.format(table=table_name)
        op.execute(
            sa.text(
                f"DROP TRIGGER IF EXISTS {trigger_name} ON {qualified_table};"
            )
        )
        op.execute(
            sa.text(
                f"""
                CREATE TRIGGER {trigger_name}
                BEFORE UPDATE ON {qualified_table}
                FOR EACH ROW EXECUTE FUNCTION psi.update_updated_at_column();
                """
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text(f'SET search_path TO "{SCHEMA}", public'))

    for table_name in AUDITED_TABLES:
        qualified_table = _qualified_table(table_name)

        trigger_name = TRIGGER_TEMPLATE.format(table=table_name)
        op.execute(
            sa.text(
                f"DROP TRIGGER IF EXISTS {trigger_name} ON {qualified_table};"
            )
        )

        for column in AUDIT_COLUMNS:
            index_name = f"idx_{table_name}_{column}"
            op.execute(
                sa.text(
                    f"DROP INDEX IF EXISTS {SCHEMA}.{index_name};"
                )
            )

            constraint_name = f"{table_name}_{column}_fkey"
            op.execute(
                sa.text(
                    f"""
                    DO $$
                    BEGIN
                        IF EXISTS (
                            SELECT 1
                            FROM pg_constraint
                            WHERE conrelid = '{SCHEMA}.{table_name}'::regclass
                              AND conname = '{constraint_name}'
                        ) THEN
                            ALTER TABLE {qualified_table}
                            DROP CONSTRAINT {constraint_name};
                        END IF;
                    END;
                    $$;
                    """
                )
            )

    op.execute(
        sa.text(
            """
            DROP FUNCTION IF EXISTS psi.update_updated_at_column();
            """
        )
    )
