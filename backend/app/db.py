"""Database engine and session utilities."""
from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from .config import normalize_database_url, settings


def create_engine_from_settings() -> Engine:
    """Return a configured SQLAlchemy engine based on environment settings."""

    connect_args = (
        {"options": f"-c search_path={settings.db_schema},public"}
        if settings.db_schema.strip()
        else {}
    )

    return create_engine(
        normalize_database_url(settings.database_url),
        pool_pre_ping=True,
        future=True,
        connect_args=connect_args,
    )


engine = create_engine_from_settings()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

__all__ = ["create_engine_from_settings", "engine", "SessionLocal"]
