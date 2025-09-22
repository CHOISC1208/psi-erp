"""Application configuration helpers."""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import BaseModel, Field, field_validator
from dotenv import load_dotenv

load_dotenv()


def _split_csv_env(value: str | None) -> list[str]:
    """Return a list of non-empty values from a comma separated string."""

    if not value:
        return []

    parts = [item.strip() for item in value.split(",")]
    return [item for item in parts if item]


def _default_cors_allow_origins() -> list[str]:
    """Return the default set of allowed CORS origins."""

    env_value = os.getenv("CORS_ALLOW_ORIGINS")
    if env_value is None:
        return [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]

    return _split_csv_env(env_value)


class Settings(BaseModel):
    """Runtime configuration loaded from environment variables."""

    database_url: str = Field(default_factory=lambda: os.getenv("DATABASE_URL", ""))
    db_schema: str = Field(default_factory=lambda: os.getenv("DB_SCHEMA", "public"))
    cors_allow_origins: list[str] = Field(default_factory=_default_cors_allow_origins)
    cors_allow_origin_regex: str | None = Field(
        default_factory=lambda: os.getenv("CORS_ALLOW_ORIGIN_REGEX")
    )

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
