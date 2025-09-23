# backend/app/routers/sessions.py
"""Session related API routes."""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session as DBSession, selectinload

from .. import models, schemas
from ..config import settings
from ..deps import get_current_user, get_db

router = APIRouter()

# ---- collection（/sessions と /sessions/ の両方を許容） ----
@router.get(
    "",
    response_model=list[schemas.SessionRead],
    response_model_exclude_none=True,
)
@router.get(
    "/",
    response_model=list[schemas.SessionRead],
    response_model_exclude_none=True,
)
def list_sessions(
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> list[schemas.SessionRead]:
    """セッション一覧を返す。"""
    _ = current_user
    stmt = select(models.Session).order_by(models.Session.created_at.desc())
    stmt = _with_audit_options(stmt)
    sessions = db.scalars(stmt).all()
    return [_serialize_session(session) for session in sessions]


@router.post(
    "",
    response_model=schemas.SessionRead,
    status_code=status.HTTP_201_CREATED,
    response_model_exclude_none=True,
)
@router.post(
    "/",
    response_model=schemas.SessionRead,
    status_code=status.HTTP_201_CREATED,
    response_model_exclude_none=True,
)
def create_session(
    payload: schemas.SessionCreate,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.SessionRead:
    """新しいセッションを作成。"""
    session = models.Session(title=payload.title, description=payload.description)
    session.created_by = current_user.id
    session.updated_by = current_user.id
    db.add(session)
    db.commit()
    db.refresh(session)
    _refresh_audit_relationships(db, session)
    return _serialize_session(session)


# ---- static path は dynamic path より前に置く！ ----
@router.get(
    "/leader",
    response_model=Optional[schemas.SessionRead],
    response_model_exclude_none=True,
)
def get_leader_session(
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> Optional[schemas.SessionRead]:
    """
    現在のリーダーセッションを返す。無ければ null を返す。
    """
    _ = current_user
    stmt = (
        select(models.Session)
        .where(models.Session.is_leader.is_(True))
        .order_by(models.Session.updated_at.desc())
        .limit(1)
    )
    stmt = _with_audit_options(stmt)
    session = db.scalars(stmt).first()
    if session is None:
        return None
    return _serialize_session(session)


# ---- item ----
def _get_session_or_404(db: DBSession, session_id: UUID) -> models.Session:
    stmt = select(models.Session).where(models.Session.id == session_id).limit(1)
    stmt = _with_audit_options(stmt)
    session = db.scalars(stmt).first()
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session


@router.get(
    "/{session_id}",
    response_model=schemas.SessionRead,
    response_model_exclude_none=True,
)
def get_session(
    session_id: UUID,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.SessionRead:
    """セッション詳細を取得。"""
    _ = current_user
    session = _get_session_or_404(db, session_id)
    return _serialize_session(session)


@router.put(
    "/{session_id}",
    response_model=schemas.SessionRead,
    response_model_exclude_none=True,
)
def update_session(
    session_id: UUID,
    payload: schemas.SessionUpdate,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.SessionRead:
    """セッションを更新。"""
    session = _get_session_or_404(db, session_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(session, field, value)
    session.updated_by = current_user.id
    db.add(session)
    db.commit()
    db.refresh(session)
    _refresh_audit_relationships(db, session)
    return _serialize_session(session)


@router.delete(
    "/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,  # 204 はボディ無し
)
def delete_session(
    session_id: UUID,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> Response:
    """セッションを削除。"""
    _ = current_user
    session = _get_session_or_404(db, session_id)
    db.delete(session)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch(
    "/{session_id}/leader",
    response_model=schemas.SessionRead,
    response_model_exclude_none=True,
)
def set_leader(
    session_id: UUID,
    db: DBSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.SessionRead:
    """指定セッションをリーダーに設定（他はすべて False）。"""
    _ = current_user

    # 全ての is_leader を False に
    db.execute(update(models.Session).values(is_leader=False))

    session = _get_session_or_404(db, session_id)
    session.is_leader = True
    session.updated_by = current_user.id
    db.add(session)
    db.commit()
    db.refresh(session)
    _refresh_audit_relationships(db, session)
    return _serialize_session(session)


def _with_audit_options(stmt):
    if settings.audit_metadata_enabled:
        return stmt.options(
            selectinload(models.Session.created_by_user),
            selectinload(models.Session.updated_by_user),
        )
    return stmt


def _refresh_audit_relationships(db: DBSession, session: models.Session) -> None:
    if settings.audit_metadata_enabled:
        db.refresh(session, attribute_names=["created_by_user", "updated_by_user"])


def _serialize_session(session: models.Session) -> schemas.SessionRead:
    data = schemas.SessionRead.model_validate(session, from_attributes=True)
    if settings.audit_metadata_enabled:
        data.created_by_username = (
            session.created_by_user.username if session.created_by_user else None
        )
        data.updated_by_username = (
            session.updated_by_user.username if session.updated_by_user else None
        )
        return data

    data.created_by = None
    data.updated_by = None
    data.created_by_username = None
    data.updated_by_username = None
    return data
