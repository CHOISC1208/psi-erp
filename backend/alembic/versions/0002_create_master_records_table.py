"""create master records table"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.config import settings

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "master_records",
        sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
        sa.Column("master_type", sa.String(length=64), nullable=False),
        sa.Column(
            "data",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
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
        schema=settings.db_schema,
    )
    op.create_index(
        "ix_master_records_master_type",
        "master_records",
        ["master_type"],
        unique=False,
        schema=settings.db_schema,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_master_records_master_type",
        table_name="master_records",
        schema=settings.db_schema,
    )
    op.drop_table("master_records", schema=settings.db_schema)
