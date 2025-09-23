"""Administrative endpoints for managing application users."""
from __future__ import annotations

import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..deps import get_admin_user, get_db
from ..security import hash_password

router = APIRouter()


def generate_temporary_password(*, length: int = 12) -> str:
    """Return a random password that satisfies the minimum policy requirements."""

    if length < 8:
        msg = "Temporary passwords must be at least 8 characters long"
        raise ValueError(msg)
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


@router.post(
    "",
    response_model=schemas.UserCreateResult,
    status_code=status.HTTP_201_CREATED,
)
def create_user(
    payload: schemas.UserCreateRequest,
    _: models.User = Depends(get_admin_user),
    db: Session = Depends(get_db),
) -> schemas.UserCreateResult:
    """Create a new application user.

    The authenticated user must be an administrator. Usernames are treated as
    case-sensitive strings to match login behaviour.
    """

    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="username required")

    stmt = select(models.User).where(models.User.username == username)
    if db.scalars(stmt).first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="username already exists",
        )

    password = generate_temporary_password()
    user = models.User(
        username=username,
        password_hash=hash_password(password),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return schemas.UserCreateResult(
        id=user.id,
        username=user.username,
        is_active=user.is_active,
        is_admin=user.is_admin,
        created_at=user.created_at,
        password=password,
    )
