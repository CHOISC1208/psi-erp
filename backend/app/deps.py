"""Shared FastAPI dependencies."""
from __future__ import annotations

from collections.abc import Generator
import uuid
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from . import models
from .config import settings
from .security import load_session, session_signature_from_hash

connect_args = (
    {"options": f"-c search_path={settings.db_schema},public"}
    if settings.db_schema
    else {}
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


def get_current_user(
    request: Request, db: Session = Depends(get_db)
) -> models.User:
    """Return the authenticated user derived from the session cookie."""

    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="not authenticated")

    data = load_session(token)
    if not data:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid session")

    user_id = data.get("uid")
    password_signature = data.get("pwd")

    try:
        uuid_val = uuid.UUID(str(user_id))
    except (ValueError, TypeError):  # pragma: no cover - defensive
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid session")

    user = db.get(models.User, uuid_val)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid session")

    expected_signature = session_signature_from_hash(user.password_hash)
    if password_signature != expected_signature:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid session")

    return user
