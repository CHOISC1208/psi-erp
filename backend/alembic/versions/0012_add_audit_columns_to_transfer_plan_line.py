"""ensure transfer plan tables expose audit metadata"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.config import settings

# revision identifiers, used by Alembic.
revision: str = "0012"
down_revision: Union[str, Sequence[str], None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = settings.db_schema or None
TRANSFER_PLAN_TABLE = "transfer_plan"
TRANSFER_PLAN_LINE_TABLE = "transfer_plan_line"
USER_TABLE = "users"


def _column_names(inspector: sa.Inspector, table: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table, schema=SCHEMA)}


def _fk_names(inspector: sa.Inspector, table: str) -> set[str]:
    return {
        fk["name"]
        for fk in inspector.get_foreign_keys(table, schema=SCHEMA)
        if fk.get("name")
    }


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name.lower() if bind else ""
    inspector = sa.inspect(bind)
    supports_fk = not dialect.startswith("sqlite")

    user_schema = SCHEMA
    session_target = f"{SCHEMA}.sessions.id" if SCHEMA else "sessions.id"
    plan_target = (
        f"{SCHEMA}.{TRANSFER_PLAN_TABLE}.plan_id"
        if SCHEMA
        else f"{TRANSFER_PLAN_TABLE}.plan_id"
    )

    # Ensure the transfer_plan table exists with audit metadata.
    if not inspector.has_table(TRANSFER_PLAN_TABLE, schema=SCHEMA):
        op.create_table(
            TRANSFER_PLAN_TABLE,
            sa.Column(
                "plan_id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False
            ),
            sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("end_date", sa.Date(), nullable=False),
            sa.Column(
                "status",
                sa.Text(),
                nullable=False,
                server_default=sa.text("'draft'"),
            ),
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
            sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
            sa.ForeignKeyConstraint(["session_id"], [session_target], ondelete="CASCADE"),
            schema=SCHEMA,
        )
    else:
        existing_columns = _column_names(inspector, TRANSFER_PLAN_TABLE)
        if "created_at" not in existing_columns:
            op.add_column(
                TRANSFER_PLAN_TABLE,
                sa.Column(
                    "created_at",
                    sa.DateTime(timezone=True),
                    nullable=False,
                    server_default=sa.func.now(),
                ),
                schema=SCHEMA,
            )
        if "updated_at" not in existing_columns:
            op.add_column(
                TRANSFER_PLAN_TABLE,
                sa.Column(
                    "updated_at",
                    sa.DateTime(timezone=True),
                    nullable=False,
                    server_default=sa.func.now(),
                ),
                schema=SCHEMA,
            )
        if "created_by" not in existing_columns:
            op.add_column(
                TRANSFER_PLAN_TABLE,
                sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
                schema=SCHEMA,
            )
        if "updated_by" not in existing_columns:
            op.add_column(
                TRANSFER_PLAN_TABLE,
                sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
                schema=SCHEMA,
            )

    if supports_fk and inspector.has_table(TRANSFER_PLAN_TABLE, schema=SCHEMA):
        existing_fks = _fk_names(inspector, TRANSFER_PLAN_TABLE)
        if "fk_transfer_plan_created_by_users" not in existing_fks:
            op.create_foreign_key(
                "fk_transfer_plan_created_by_users",
                TRANSFER_PLAN_TABLE,
                USER_TABLE,
                ["created_by"],
                ["id"],
                source_schema=SCHEMA,
                referent_schema=user_schema,
                ondelete="SET NULL",
            )
        if "fk_transfer_plan_updated_by_users" not in existing_fks:
            op.create_foreign_key(
                "fk_transfer_plan_updated_by_users",
                TRANSFER_PLAN_TABLE,
                USER_TABLE,
                ["updated_by"],
                ["id"],
                source_schema=SCHEMA,
                referent_schema=user_schema,
                ondelete="SET NULL",
            )

    # Ensure the transfer_plan_line table exists with audit metadata.
    if not inspector.has_table(TRANSFER_PLAN_LINE_TABLE, schema=SCHEMA):
        op.create_table(
            TRANSFER_PLAN_LINE_TABLE,
            sa.Column(
                "line_id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False
            ),
            sa.Column("plan_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("sku_code", sa.Text(), nullable=False),
            sa.Column("from_warehouse", sa.Text(), nullable=False),
            sa.Column("from_channel", sa.Text(), nullable=False),
            sa.Column("to_warehouse", sa.Text(), nullable=False),
            sa.Column("to_channel", sa.Text(), nullable=False),
            sa.Column("qty", sa.Numeric(20, 6), nullable=False),
            sa.Column(
                "is_manual",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            sa.Column("reason", sa.Text(), nullable=True),
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
            sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
            sa.ForeignKeyConstraint(["plan_id"], [plan_target], ondelete="CASCADE"),
            schema=SCHEMA,
        )
    else:
        existing_columns = _column_names(inspector, TRANSFER_PLAN_LINE_TABLE)
        if "created_at" not in existing_columns:
            op.add_column(
                TRANSFER_PLAN_LINE_TABLE,
                sa.Column(
                    "created_at",
                    sa.DateTime(timezone=True),
                    nullable=False,
                    server_default=sa.func.now(),
                ),
                schema=SCHEMA,
            )
        if "updated_at" not in existing_columns:
            op.add_column(
                TRANSFER_PLAN_LINE_TABLE,
                sa.Column(
                    "updated_at",
                    sa.DateTime(timezone=True),
                    nullable=False,
                    server_default=sa.func.now(),
                ),
                schema=SCHEMA,
            )
        if "created_by" not in existing_columns:
            op.add_column(
                TRANSFER_PLAN_LINE_TABLE,
                sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
                schema=SCHEMA,
            )
        if "updated_by" not in existing_columns:
            op.add_column(
                TRANSFER_PLAN_LINE_TABLE,
                sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
                schema=SCHEMA,
            )

    if supports_fk and inspector.has_table(TRANSFER_PLAN_LINE_TABLE, schema=SCHEMA):
        existing_fks = _fk_names(inspector, TRANSFER_PLAN_LINE_TABLE)
        if "fk_transfer_plan_line_plan_id_transfer_plan" not in existing_fks:
            op.create_foreign_key(
                "fk_transfer_plan_line_plan_id_transfer_plan",
                TRANSFER_PLAN_LINE_TABLE,
                TRANSFER_PLAN_TABLE,
                ["plan_id"],
                ["plan_id"],
                source_schema=SCHEMA,
                referent_schema=SCHEMA,
                ondelete="CASCADE",
            )
        if "fk_transfer_plan_line_created_by_users" not in existing_fks:
            op.create_foreign_key(
                "fk_transfer_plan_line_created_by_users",
                TRANSFER_PLAN_LINE_TABLE,
                USER_TABLE,
                ["created_by"],
                ["id"],
                source_schema=SCHEMA,
                referent_schema=user_schema,
                ondelete="SET NULL",
            )
        if "fk_transfer_plan_line_updated_by_users" not in existing_fks:
            op.create_foreign_key(
                "fk_transfer_plan_line_updated_by_users",
                TRANSFER_PLAN_LINE_TABLE,
                USER_TABLE,
                ["updated_by"],
                ["id"],
                source_schema=SCHEMA,
                referent_schema=user_schema,
                ondelete="SET NULL",
            )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name.lower() if bind else ""
    inspector = sa.inspect(bind)
    supports_fk = not dialect.startswith("sqlite")

    if supports_fk and inspector.has_table(TRANSFER_PLAN_LINE_TABLE, schema=SCHEMA):
        existing_fks = _fk_names(inspector, TRANSFER_PLAN_LINE_TABLE)
        if "fk_transfer_plan_line_updated_by_users" in existing_fks:
            op.drop_constraint(
                "fk_transfer_plan_line_updated_by_users",
                TRANSFER_PLAN_LINE_TABLE,
                type_="foreignkey",
                schema=SCHEMA,
            )
        if "fk_transfer_plan_line_created_by_users" in existing_fks:
            op.drop_constraint(
                "fk_transfer_plan_line_created_by_users",
                TRANSFER_PLAN_LINE_TABLE,
                type_="foreignkey",
                schema=SCHEMA,
            )
        if "fk_transfer_plan_line_plan_id_transfer_plan" in existing_fks:
            op.drop_constraint(
                "fk_transfer_plan_line_plan_id_transfer_plan",
                TRANSFER_PLAN_LINE_TABLE,
                type_="foreignkey",
                schema=SCHEMA,
            )

    if inspector.has_table(TRANSFER_PLAN_LINE_TABLE, schema=SCHEMA):
        columns = _column_names(inspector, TRANSFER_PLAN_LINE_TABLE)
        for column in ("updated_by", "created_by", "updated_at", "created_at"):
            if column in columns:
                op.drop_column(TRANSFER_PLAN_LINE_TABLE, column, schema=SCHEMA)

    if supports_fk and inspector.has_table(TRANSFER_PLAN_TABLE, schema=SCHEMA):
        existing_fks = _fk_names(inspector, TRANSFER_PLAN_TABLE)
        if "fk_transfer_plan_updated_by_users" in existing_fks:
            op.drop_constraint(
                "fk_transfer_plan_updated_by_users",
                TRANSFER_PLAN_TABLE,
                type_="foreignkey",
                schema=SCHEMA,
            )
        if "fk_transfer_plan_created_by_users" in existing_fks:
            op.drop_constraint(
                "fk_transfer_plan_created_by_users",
                TRANSFER_PLAN_TABLE,
                type_="foreignkey",
                schema=SCHEMA,
            )

    if inspector.has_table(TRANSFER_PLAN_TABLE, schema=SCHEMA):
        columns = _column_names(inspector, TRANSFER_PLAN_TABLE)
        for column in ("updated_by", "created_by", "updated_at", "created_at"):
            if column in columns:
                op.drop_column(TRANSFER_PLAN_TABLE, column, schema=SCHEMA)
