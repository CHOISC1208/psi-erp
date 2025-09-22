"""add is_admin flag to users"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

from app.config import settings

# revision identifiers, used by Alembic.
revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

SCHEMA = settings.db_schema or None


def _column_exists(inspector: sa.Inspector, table: str, column: str) -> bool:
    columns = inspector.get_columns(table, schema=SCHEMA)
    return any(col["name"] == column for col in columns)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_name = "users"
    column_name = "is_admin"

    if not inspector.has_table(table_name, schema=SCHEMA):
        return

    if not _column_exists(inspector, table_name, column_name):
        op.add_column(
            table_name,
            sa.Column(
                column_name,
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            schema=SCHEMA,
        )

    metadata = sa.MetaData()
    users_table = sa.Table(
        table_name,
        metadata,
        sa.Column("username", sa.String),
        sa.Column(column_name, sa.Boolean),
        schema=SCHEMA,
    )
    op.execute(
        users_table.update()
        .where(users_table.c.username == "admin")
        .values({column_name: True})
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_name = "users"
    column_name = "is_admin"

    if not inspector.has_table(table_name, schema=SCHEMA):
        return

    if _column_exists(inspector, table_name, column_name):
        op.drop_column(table_name, column_name, schema=SCHEMA)
