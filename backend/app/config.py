"""Application configuration helpers."""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

from pydantic import BaseModel, Field, field_validator
from dotenv import load_dotenv

load_dotenv()


class Settings(BaseModel):
    """Runtime configuration loaded from environment variables."""

    database_url: str = Field(default_factory=lambda: os.getenv("DATABASE_URL", ""))
    db_schema: str = Field(default_factory=lambda: os.getenv("DB_SCHEMA", "public"))

    @field_validator("database_url", mode="before")
    @classmethod
    def _normalize_database_url(cls, value: str | None) -> str:
        """Normalize the DATABASE_URL for SQLAlchemy / psycopg2 usage."""
        if not value:
            return ""
        normalized = value
        if normalized.startswith("postgres://"):
            normalized = normalized.replace("postgres://", "postgresql+psycopg2://", 1)
        if "sslmode=" not in normalized:
            separator = "&" if "?" in normalized else "?"
            normalized = f"{normalized}{separator}sslmode=require"
        return normalized

    model_config: dict[str, Any] = {"frozen": True}


@lru_cache(1)
def get_settings() -> Settings:
    """Return a cached :class:`Settings` instance."""

    return Settings()


settings = get_settings()
