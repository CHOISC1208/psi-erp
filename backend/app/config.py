import os
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

def _normalize(url: str) -> str:
    if url.startswith("postgres://"):
        # ここを psycopg2 に
        url = url.replace("postgres://", "postgresql+psycopg2://", 1)
    if "sslmode=" not in url:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}sslmode=require"
    return url


class Settings(BaseModel):
    DATABASE_URL: str = _normalize(os.getenv("DATABASE_URL", ""))
    DB_SCHEMA: str = os.getenv("DB_SCHEMA", "public")  # ← ここでスキーマ名を持つ

settings = Settings()