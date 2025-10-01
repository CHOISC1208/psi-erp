from __future__ import annotations

import sys
from pathlib import Path

import sqlalchemy as sa
from alembic import command
from alembic.config import Config


BACKEND_ROOT = Path(__file__).resolve().parents[1]
ALEMBIC_INI = BACKEND_ROOT / "alembic.ini"
ALEMBIC_DIR = BACKEND_ROOT / "alembic"


def _reset_backend_modules() -> None:
    for name in list(sys.modules):
        if name.startswith("backend.app"):
            del sys.modules[name]


def test_upgrade_adds_audit_columns(tmp_path, monkeypatch):
    db_path = tmp_path / "migration.sqlite"
    db_url = f"sqlite+pysqlite:///{db_path}"

    monkeypatch.setenv("DATABASE_URL", db_url)
    monkeypatch.setenv("DB_SCHEMA", "")

    _reset_backend_modules()

    alembic_cfg = Config(str(ALEMBIC_INI))
    alembic_cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    alembic_cfg.set_main_option("sqlalchemy.url", db_url)

    command.upgrade(alembic_cfg, "head")

    engine = sa.create_engine(db_url)
    inspector = sa.inspect(engine)

    expected_columns = {
        "sessions": {"created_by", "updated_by"},
        "psi_edits": {"created_by", "updated_by"},
        "channel_transfers": {"created_by", "updated_by"},
        "psi_edit_log": {"created_at", "updated_at", "created_by", "updated_by", "edited_by"},
        "warehouse_master": {"main_channel"},
    }

    for table, columns in expected_columns.items():
        names = {column["name"] for column in inspector.get_columns(table)}
        missing = columns - names
        assert not missing, f"{table} missing columns: {sorted(missing)}"

    engine.dispose()
