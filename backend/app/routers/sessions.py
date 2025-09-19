from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session as DB
from sqlalchemy import text
from ..deps import get_db

router = APIRouter()

class SessionIn(BaseModel):
    title: str
    description: str | None = None

@router.get("")
def list_sessions(db: DB = Depends(get_db)):
    # シンプルにSQLでもOK（public.sessions 前提）
    rows = db.execute(text("""
        SELECT id, title, description, is_leader, created_at, updated_at
        FROM public.sessions
        ORDER BY created_at DESC
    """)).mappings().all()
    return [dict(r) for r in rows]

@router.post("")
def create_session(payload: SessionIn, db: DB = Depends(get_db)):
    # idはDB側でtext主キーなのでPython側で生成
    from uuid import uuid4
    sid = str(uuid4())
    db.execute(text("""
        INSERT INTO public.sessions (id, title, description, is_leader)
        VALUES (:id, :title, :description, FALSE)
    """), {"id": sid, "title": payload.title, "description": payload.description})
    db.commit()
    row = db.execute(text("""
        SELECT id, title, description, is_leader, created_at, updated_at
        FROM public.sessions WHERE id=:id
    """), {"id": sid}).mappings().one()
    return dict(row)

@router.patch("/{session_id}/leader")
def set_leader(session_id: str, db: DB = Depends(get_db)):
    # 既存Leaderを落として、指定をLeaderに
    with db.begin():
        db.execute(text("""UPDATE public.sessions SET is_leader = FALSE WHERE is_leader = TRUE"""))
        n = db.execute(text("""
            UPDATE public.sessions SET is_leader = TRUE WHERE id = :id
        """), {"id": session_id}).rowcount
        if n == 0:
            raise HTTPException(status_code=404, detail="session not found")
    return {"ok": True}
