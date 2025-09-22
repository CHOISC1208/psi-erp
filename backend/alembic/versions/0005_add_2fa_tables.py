# backend/alembic/versions/0005_add_2fa_tables.py
from alembic import op
import sqlalchemy as sa

# --- ヘッダ（数字IDで統一） ---
revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    # 1) 必要なら拡張 (gen_random_uuid)
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto";')

    bind = op.get_bind()
    insp = sa.inspect(bind)

    # 2) user_totp
    if not insp.has_table("user_totp", schema="psi"):
        op.create_table(
            "user_totp",
            sa.Column("user_id", sa.UUID, primary_key=True),
            sa.Column("totp_secret", sa.Text, nullable=False),
            sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("last_used_at", sa.TIMESTAMP(timezone=True)),
            sa.ForeignKeyConstraint(["user_id"], ["psi.users.id"], ondelete="CASCADE"),
            schema="psi",
        )

    # 3) user_recovery_codes + index
    if not insp.has_table("user_recovery_codes", schema="psi"):
        op.create_table(
            "user_recovery_codes",
            sa.Column("id", sa.UUID, primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("user_id", sa.UUID, nullable=False),
            sa.Column("code_hash", sa.Text, nullable=False),  # 平文は保存しない
            sa.Column("used_at", sa.TIMESTAMP(timezone=True)),
            sa.ForeignKeyConstraint(["user_id"], ["psi.users.id"], ondelete="CASCADE"),
            schema="psi",
        )
        op.create_index(
            "idx_user_recovery_codes_user",
            "user_recovery_codes",
            ["user_id"],
            schema="psi",
            unique=False,
        )


def downgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # 逆順で削除
    if insp.has_table("user_recovery_codes", schema="psi"):
        op.drop_index("idx_user_recovery_codes_user", table_name="user_recovery_codes", schema="psi")
        op.drop_table("user_recovery_codes", schema="psi")

    if insp.has_table("user_totp", schema="psi"):
        op.drop_table("user_totp", schema="psi")
