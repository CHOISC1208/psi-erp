"""Session related API routes."""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session as DBSession

from .. import models, schemas
from ..deps import get_db

router = APIRouter()


@router.get("/", response_model=list[schemas.SessionRead])
def list_sessions(db: DBSession = Depends(get_db)) -> list[schemas.SessionRead]:
    query = select(models.Session).order_by(models.Session.created_at.desc())
    sessions = db.scalars(query).all()
    return sessions


@router.post("/", response_model=schemas.SessionRead, status_code=status.HTTP_201_CREATED)
def create_session(
    payload: schemas.SessionCreate, db: DBSession = Depends(get_db)
) -> schemas.SessionRead:
    session = models.Session(title=payload.title, description=payload.description)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def _get_session_or_404(db: DBSession, session_id: str) -> models.Session:
    try:
        UUID(session_id)
    except ValueError as exc:  # pragma: no cover - sanity check
        raise HTTPException(status_code=404, detail="session not found") from exc

    session = db.get(models.Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session


@router.get("/{session_id}", response_model=schemas.SessionRead)
def get_session(session_id: str, db: DBSession = Depends(get_db)) -> schemas.SessionRead:
    return _get_session_or_404(db, session_id)


@router.put("/{session_id}", response_model=schemas.SessionRead)
def update_session(
    session_id: str, payload: schemas.SessionUpdate, db: DBSession = Depends(get_db)
) -> schemas.SessionRead:
    session = _get_session_or_404(db, session_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(session, field, value)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: str, db: DBSession = Depends(get_db)) -> None:
    _get_session_or_404(db, session_id)
    db.execute(delete(models.PSIRecord).where(models.PSIRecord.session_id == session_id))
    db.execute(delete(models.Session).where(models.Session.id == session_id))
    db.commit()


@router.patch("/{session_id}/leader", response_model=schemas.SessionRead)
def set_leader(session_id: str, db: DBSession = Depends(get_db)) -> schemas.SessionRead:
    session = _get_session_or_404(db, session_id)
    db.execute(update(models.Session).values(is_leader=False))
    session.is_leader = True
    db.add(session)
    db.commit()
    db.refresh(session)
    return session
