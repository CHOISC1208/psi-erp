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


def _resolve_schema(value: str | None) -> str:
    """Return the configured schema or the hard-coded default."""

    if value:
        candidate = value.strip()
        if candidate:
            return candidate
    return DEFAULT_SCHEMA


config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _normalize_db_url(url: str | None) -> str | None:
    """Normalise PostgreSQL URLs for SQLAlchemy/psycopg2."""

    if not url:
        return url
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg2://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return url


DB_URL = _normalize_db_url(settings.database_url)
SCHEMA = _resolve_schema(getattr(settings, "db_schema", DEFAULT_SCHEMA))

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
        version_table_schema=SCHEMA,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    configuration = config.get_section(config.config_ini_section)
    configuration["sqlalchemy.url"] = DB_URL
    connectable = engine_from_config(configuration, prefix="sqlalchemy.", poolclass=pool.NullPool)

    with connectable.connect() as connection:
        quoted_schema = f'"{SCHEMA.replace("\"", "\"\"")}"'
        connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {quoted_schema}"))
        connection.execute(text(f"SET search_path TO {quoted_schema}, public"))

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_schemas=True,
            version_table_schema=SCHEMA,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
