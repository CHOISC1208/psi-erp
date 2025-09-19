# backend/app/deps.py

"""Shared FastAPI dependencies."""
from __future__ import annotations

from collections.abc import Generator
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from .config import settings

connect_args = {"options": f"-csearch_path={settings.db_schema},public"} if settings.db_schema else {}

# ✅ Herokuの DATABASE_URL は postgres:// なので SQLAlchemy 用に置換
db_url = settings.database_url
if db_url and db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)

engine = create_engine(
    db_url,                # ← ここを置換後の db_url に
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
