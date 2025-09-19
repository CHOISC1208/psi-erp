"""create sessions table

Revision ID: 93c1ff7f769b
Revises: 
Create Date: 2025-09-19 14:14:55.477046

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '93c1ff7f769b'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sessions",
        sa.Column("id", sa.String(), primary_key=True, nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_leader", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        schema=settings.DB_SCHEMA,   # ← psi スキーマに作成
    )

    # Leader を1つにする部分ユニーク（任意だけど推奨）
    op.create_index(
        "uq_sessions_leader_true",
        "sessions",
        ["is_leader"],
        unique=True,
        postgresql_where=sa.text("is_leader = TRUE"),
        schema=settings.DB_SCHEMA,
    )

def downgrade() -> None:
    op.drop_index("uq_sessions_leader_true", table_name="sessions", schema=settings.DB_SCHEMA)
    op.drop_table("sessions", schema=settings.DB_SCHEMA)