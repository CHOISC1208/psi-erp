# backend/app/deps.py

"""Shared FastAPI dependencies."""
from __future__ import annotations

from collections.abc import Generator
import os
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from .config import settings

connect_args = (
    {"options": f"-c search_path={settings.db_schema},public"}
    if settings.db_schema else {}
)

# ✅ DB URL 正規化（Heroku の postgres:// → postgresql+psycopg://）
db_url = settings.database_url
if db_url and db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)

# ✅ sslmode=require を付与（既にあれば維持）
if db_url:
    u = urlparse(db_url)
    q = dict(parse_qsl(u.query))
    q.setdefault("sslmode", "require")
    db_url = urlunparse(u._replace(query=urlencode(q)))

engine = create_engine(
    db_url,
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
