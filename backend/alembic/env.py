# alembic/env.py
"""Alembic environment configuration."""
from __future__ import annotations

import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool, text

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv()

from app.config import settings
from app.models import Base

DEFAULT_SCHEMA = "psi"


def _normalized_schema(schema_name: str | None) -> str:
    """Return the schema name Alembic should target."""

    if not schema_name:
        return DEFAULT_SCHEMA

    coerced = schema_name.strip()
    return coerced or DEFAULT_SCHEMA


config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _normalize_db_url(url: str | None) -> str | None:
    """Normalize PostgreSQL URLs for SQLAlchemy/psycopg2 usage."""

    if not url:
        return url
    # Herokuは postgres:// を渡す → SQLAlchemyは postgresql(+driver) を要求
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg2://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return url


DB_URL = _normalize_db_url(settings.database_url)
TARGET_SCHEMA = _normalized_schema(getattr(settings, "db_schema", DEFAULT_SCHEMA))

# alembic.ini の設定を上書き
config.set_main_option("sqlalchemy.url", DB_URL or "")

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    context.configure(
        url=DB_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        include_schemas=True,
        version_table_schema=TARGET_SCHEMA,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    configuration = config.get_section(config.config_ini_section)
    configuration["sqlalchemy.url"] = DB_URL
    connectable = engine_from_config(configuration, prefix="sqlalchemy.", poolclass=pool.NullPool)

    with connectable.connect() as connection:
        # スキーマが指定されている場合のみ作成＆search_path設定
        if TARGET_SCHEMA:
            connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{TARGET_SCHEMA}"'))
            connection.execute(text(f'SET search_path TO "{TARGET_SCHEMA}", public'))

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_schemas=True,
            version_table_schema=TARGET_SCHEMA,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
