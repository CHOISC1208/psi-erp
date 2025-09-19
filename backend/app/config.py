"""Application configuration helpers."""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

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

        value = value.strip()
        if not value:
            return ""

        parsed = urlsplit(value)

        lowered_scheme = parsed.scheme.lower()
        if lowered_scheme in {"postgres", "postgresql"}:
            scheme = "postgresql+psycopg2"
        elif lowered_scheme == "postgresql+psycopg2":
            scheme = "postgresql+psycopg2"
        else:
            scheme = parsed.scheme

        path = parsed.path
        query = parsed.query

        if "sslmode=" in path and not query:
            base_path, _, sslmode_value = path.partition("sslmode=")
            base_path = base_path.rstrip("?&")
            path = base_path or "/"
            if not path.startswith("/"):
                path = f"/{path}"
            query = f"sslmode={sslmode_value.lstrip('?&')}"

        query_params = parse_qsl(query, keep_blank_values=True)
        filtered_params = [(key, value) for key, value in query_params if key != "sslmode"]
        filtered_params.append(("sslmode", "require"))
        normalized_query = urlencode(filtered_params, doseq=True)

        normalized = urlunsplit(
            (
                scheme,
                parsed.netloc,
                path,
                normalized_query,
                parsed.fragment,
            )
        )

        if not parsed.netloc and scheme:
            prefix = f"{scheme}:/"
            if normalized.startswith(prefix) and not normalized.startswith(f"{scheme}://"):
                normalized = normalized.replace(prefix, f"{scheme}:///", 1)

        return normalized

    @property
    def DATABASE_URL(self) -> str:  # pragma: no cover - backwards compat helper
        """Backwards compatible accessor for ``database_url``."""

        return self.database_url

    @property
    def DB_SCHEMA(self) -> str:  # pragma: no cover - backwards compat helper
        """Backwards compatible accessor for ``db_schema``."""

        return self.db_schema

    model_config: dict[str, Any] = {"frozen": True}


@lru_cache(1)
def get_settings() -> Settings:
    """Return a cached :class:`Settings` instance."""

    return Settings()


settings = get_settings()
