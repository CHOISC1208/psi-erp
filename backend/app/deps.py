from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from .config import settings

# 重要: pool_pre_ping=True で接続切れを検知
engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
