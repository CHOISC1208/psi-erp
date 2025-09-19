"""Shared FastAPI dependencies."""
from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from .config import settings

connect_args = {"options": f"-csearch_path={settings.db_schema},public"} if settings.db_schema else {}

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    future=True,
    connect_args=connect_args,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    """Yield a SQLAlchemy session scoped to the request."""

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
