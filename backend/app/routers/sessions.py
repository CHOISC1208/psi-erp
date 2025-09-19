"""Session related API routes."""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session as DBSession

from .. import models, schemas
from ..deps import get_db

router = APIRouter()

# ---- collection (末尾スラなしに統一) ----
@router.get("", response_model=list[schemas.SessionRead])
def list_sessions(db: DBSession = Depends(get_db)) -> list[schemas.SessionRead]:
    """セッション一覧を返す"""
    query = select(models.Session).order_by(models.Session.created_at.desc())
    return db.scalars(query).all()

@router.post("", response_model=schemas.SessionRead, status_code=status.HTTP_201_CREATED)
def create_session(
    payload: schemas.SessionCreate, db: DBSession = Depends(get_db)
) -> schemas.SessionRead:
    """新しいセッションを作成"""
    session = models.Session(title=payload.title, description=payload.description)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session

# ---- static path は dynamic path より前に置く！ ----
@router.get("/leader", response_model=Optional[schemas.SessionRead])
def get_leader_session(db: DBSession = Depends(get_db)) -> Optional[schemas.SessionRead]:
    """
    現在のリーダーセッションを返す。無ければ null を返す。
    """
    stmt = (
        select(models.Session)
        .where(models.Session.is_leader.is_(True))
        .order_by(models.Session.updated_at.desc())
        .limit(1)
    )
    return db.scalars(stmt).first()

# ---- item ----
def _get_session_or_404(db: DBSession, session_id: UUID) -> models.Session:
    session = db.get(models.Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session

@router.get("/{session_id}", response_model=schemas.SessionRead)
def get_session(session_id: UUID, db: DBSession = Depends(get_db)) -> schemas.SessionRead:
    """セッション詳細を取得"""
    return _get_session_or_404(db, session_id)

@router.put("/{session_id}", response_model=schemas.SessionRead)
def update_session(
    session_id: UUID, payload: schemas.SessionUpdate, db: DBSession = Depends(get_db)
) -> schemas.SessionRead:
    """セッションを更新"""
    session = _get_session_or_404(db, session_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(session, field, value)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session

@router.delete(
    "/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,  # 204 はボディ無し
)
def delete_session(session_id: UUID, db: DBSession = Depends(get_db)) -> Response:
    """セッションを削除"""
    session = _get_session_or_404(db, session_id)
    db.delete(session)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@router.patch("/{session_id}/leader", response_model=schemas.SessionRead)
def set_leader(session_id: UUID, db: DBSession = Depends(get_db)) -> schemas.SessionRead:
    """指定セッションをリーダーに設定（他はすべて False）"""
    _ = _get_session_or_404(db, session_id)
    db.execute(update(models.Session).values(is_leader=False))
    result = db.execute(
        update(models.Session)
        .where(models.Session.id == session_id)
        .values(is_leader=True)
        .returning(models.Session.id)
    ).first()
    if not result:
        raise HTTPException(status_code=404, detail="session not found")
    db.commit()
    return db.get(models.Session, session_id)
