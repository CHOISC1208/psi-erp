"""Shared FastAPI dependencies."""
from __future__ import annotations

from collections.abc import Generator
import uuid

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from . import models
from .config import settings
from .db import SessionLocal, engine
from .security import load_session, session_signature_from_hash


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


def get_admin_user(
    request: Request, db: Session = Depends(get_db)
) -> models.User:
    """Return the authenticated user ensuring they have admin privileges."""

    user = get_current_user(request, db)
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin access required")
    return user
