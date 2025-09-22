"""Authentication endpoints for username/password login."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..config import settings
from ..deps import get_current_user, get_db
from ..security import (
    LoginRateLimiter,
    create_session_payload,
    generate_csrf_token,
    rate_limiter_factory,
    sign_session,
    verify_password,
)

router = APIRouter()
_login_rate_limiter: LoginRateLimiter = rate_limiter_factory()


def _client_key(request: Request, username: str) -> str:
    host = request.client.host if request.client else "unknown"
    return f"{host}:{username.lower()}"


@router.post("/login", response_model=schemas.LoginResult)
def login(
    payload: schemas.LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> schemas.LoginResult:
    """Validate credentials and issue a signed session cookie."""

    key = _client_key(request, payload.username)
    if not _login_rate_limiter.can_attempt(key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="too many failed attempts, please try again later",
        )

    stmt = select(models.User).where(models.User.username == payload.username)
    user = db.scalars(stmt).first()

    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        _login_rate_limiter.register_failure(key)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")

    _login_rate_limiter.reset(key)

    user.last_login_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()

    payload_data = create_session_payload(str(user.id), user.password_hash)
    token = sign_session(payload_data)

    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.normalized_samesite,
        domain=settings.session_cookie_domain,
        path="/",
    )

    csrf_token: str | None = None
    if settings.csrf_enabled:
        csrf_token = generate_csrf_token()
        response.set_cookie(
            key=settings.csrf_cookie_name,
            value=csrf_token,
            max_age=settings.session_ttl_seconds,
            httponly=False,
            secure=settings.session_cookie_secure,
            samesite=settings.normalized_samesite,
            domain=settings.session_cookie_domain,
            path="/",
        )
        response.headers[settings.csrf_header] = csrf_token

    return schemas.LoginResult(next="authenticated", csrf_token=csrf_token)


@router.get("/me", response_model=schemas.UserProfile)
def me(current_user: models.User = Depends(get_current_user)) -> schemas.UserProfile:
    """Return the profile of the authenticated user."""

    return schemas.UserProfile(
        id=current_user.id,
        username=current_user.username,
        is_active=current_user.is_active,
        is_admin=current_user.is_admin,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> Response:
    """Invalidate the session cookie for the current browser."""

    response.delete_cookie(
        key=settings.session_cookie_name,
        domain=settings.session_cookie_domain,
        path="/",
    )
    if settings.csrf_enabled:
        response.delete_cookie(
            key=settings.csrf_cookie_name,
            domain=settings.session_cookie_domain,
            path="/",
        )
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
