"""Utility helpers for bootstrapping the application database."""
from __future__ import annotations

from sqlalchemy import inspect
from sqlalchemy.engine import Engine
from sqlalchemy.schema import CreateSchema

from .config import settings
from .db import create_engine_from_settings
from .models import Base


def ensure_schema(engine: Engine) -> None:
    """Ensure the configured schema exists when using PostgreSQL."""

    schema = settings.db_schema.strip()
    if not schema:
        return

    if engine.dialect.name != "postgresql":
        return

    with engine.begin() as connection:
        inspector = inspect(connection)
        if inspector.has_schema(schema):
            return
        connection.execute(CreateSchema(schema))


def bootstrap_database() -> None:
    """Create the configured schema (if needed) and all application tables."""

    engine = create_engine_from_settings()
    try:
        ensure_schema(engine)
        Base.metadata.create_all(bind=engine)
    finally:
        engine.dispose()


if __name__ == "__main__":  # pragma: no cover - manual invocation helper
    bootstrap_database()
