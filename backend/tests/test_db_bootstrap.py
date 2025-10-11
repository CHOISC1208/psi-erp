from __future__ import annotations

import importlib
import sys

import sqlalchemy as sa


def _reload_backend_modules() -> None:
    for module in (
        "backend.app.config",
        "backend.app.models",
        "backend.app.db",
        "backend.app.init_db",
    ):
        if module in sys.modules:
            importlib.reload(sys.modules[module])
        else:
            importlib.import_module(module)


def test_bootstrap_creates_expected_tables(tmp_path, monkeypatch):
    db_path = tmp_path / "bootstrap.sqlite"
    db_url = f"sqlite+pysqlite:///{db_path}"

    monkeypatch.setenv("DATABASE_URL", db_url)
    monkeypatch.setenv("DB_SCHEMA", "")

    _reload_backend_modules()

    from backend.app import db, init_db

    init_db.bootstrap_database()

    engine = db.create_engine_from_settings()
    inspector = sa.inspect(engine)

    expected_columns = {
        "sessions": {"created_by", "updated_by", "data_mode"},
        "psi_edits": {"created_by", "updated_by"},
        "channel_transfers": {"created_by", "updated_by"},
        "psi_edit_log": {
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
            "edited_by",
        },
        "warehouse_master": {"main_channel"},
    }

    for table, columns in expected_columns.items():
        names = {column["name"] for column in inspector.get_columns(table)}
        missing = columns - names
        assert not missing, f"{table} missing columns: {sorted(missing)}"

    engine.dispose()
