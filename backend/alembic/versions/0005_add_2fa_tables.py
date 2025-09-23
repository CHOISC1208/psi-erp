"""add tables to support two-factor authentication"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.config import settings

revision: str = "0005"
down_revision: Union[str, Sequence[str], None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = settings.db_schema or None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto";')

    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("user_totp", schema=SCHEMA):
        op.create_table(
            "user_totp",
            sa.Column("user_id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("totp_secret", sa.Text(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(
                ["user_id"],
                [f"{SCHEMA}.users.id" if SCHEMA else "users.id"],
                ondelete="CASCADE",
            ),
            schema=SCHEMA,
        )

    if not inspector.has_table("user_recovery_codes", schema=SCHEMA):
        op.create_table(
            "user_recovery_codes",
            sa.Column(
                "id",
                postgresql.UUID(as_uuid=True),
                primary_key=True,
                nullable=False,
                server_default=sa.text("gen_random_uuid()"),
            ),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("code_hash", sa.Text(), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(
                ["user_id"],
                [f"{SCHEMA}.users.id" if SCHEMA else "users.id"],
                ondelete="CASCADE",
            ),
            schema=SCHEMA,
        )
        op.create_index(
            "idx_user_recovery_codes_user",
            "user_recovery_codes",
            ["user_id"],
            schema=SCHEMA,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("user_recovery_codes", schema=SCHEMA):
        op.drop_index(
            "idx_user_recovery_codes_user",
            table_name="user_recovery_codes",
            schema=SCHEMA,
        )
        op.drop_table("user_recovery_codes", schema=SCHEMA)

    if inspector.has_table("user_totp", schema=SCHEMA):
        op.drop_table("user_totp", schema=SCHEMA)
