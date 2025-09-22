"""create users table for authentication"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from app.config import settings

# revision identifiers, used by Alembic.
revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

SCHEMA = settings.db_schema or None


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if not insp.has_table("users", schema="psi"):      # ★存在しなければ作成
        op.create_table(
            "users",
            sa.Column("id", sa.UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("username", sa.String(150), nullable=False, unique=True),
            sa.Column("password_hash", sa.Text, nullable=False),
            sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.text("true")),
            sa.Column("last_login_at", sa.TIMESTAMP(timezone=True)),
            sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
            schema="psi",
        )

def downgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if insp.has_table("users", schema="psi"):          # ★あるときだけDROP
        op.drop_table("users", schema="psi")
