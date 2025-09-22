"""Application configuration helpers."""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import BaseModel, Field, field_validator
from dotenv import load_dotenv

load_dotenv()


def _env_flag(name: str, default: bool = False) -> bool:
    """Return a boolean flag read from the environment."""

    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def normalize_database_url(value: str | None) -> str:
    """Normalize a PostgreSQL connection URL for psycopg2 usage."""

    if not value:
        return ""

    value = value.strip()
    if not value:
        return ""

    parsed = urlsplit(value)

    lowered_scheme = parsed.scheme.lower()
    if lowered_scheme in {"postgres", "postgresql", "postgresql+psycopg"}:
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


def normalized_db_url() -> str:
    """Return the normalized DATABASE_URL from the environment."""

    return normalize_database_url(os.getenv("DATABASE_URL", ""))


class Settings(BaseModel):
    """Runtime configuration loaded from environment variables."""

    database_url: str = Field(default_factory=lambda: os.getenv("DATABASE_URL", ""))
    db_schema: str = Field(default_factory=lambda: os.getenv("DB_SCHEMA", "psi"))
    allowed_origins_raw: str = Field(
        default_factory=lambda: os.getenv("ALLOWED_ORIGINS", "")
    )
    session_sign_key: str = Field(
        default_factory=lambda: os.getenv("SESSION_SIGN_KEY", "change-me")
    )
    secret_key: str = Field(default_factory=lambda: os.getenv("SECRET_KEY", "change-me"))
    session_cookie_name: str = Field(
        default_factory=lambda: os.getenv("SESSION_COOKIE_NAME", "session")
    )
    session_cookie_domain: str | None = Field(
        default_factory=lambda: os.getenv("SESSION_COOKIE_DOMAIN")
    )
    session_cookie_samesite: str = Field(
        default_factory=lambda: os.getenv("SESSION_COOKIE_SAMESITE", "lax")
    )
    session_cookie_secure: bool = Field(
        default_factory=lambda: _env_flag("SESSION_COOKIE_SECURE", default=False)
    )
    session_ttl_seconds: int = Field(
        default_factory=lambda: int(os.getenv("SESSION_TTL_SECONDS", "3600"))
    )
    csrf_cookie_name: str = Field(
        default_factory=lambda: os.getenv("CSRF_COOKIE_NAME", "csrf_token")
    )
    csrf_header_name: str = Field(
        default_factory=lambda: os.getenv("CSRF_HEADER_NAME", "x-csrf-token")
    )
    csrf_enabled: bool = Field(
        default_factory=lambda: os.getenv("CSRF_ENABLED", "false").lower()
        in {"1", "true", "yes", "on"}
    )
    login_max_attempts: int = Field(
        default_factory=lambda: int(os.getenv("LOGIN_MAX_ATTEMPTS", "5"))
    )
    login_block_seconds: int = Field(
        default_factory=lambda: int(os.getenv("LOGIN_BLOCK_SECONDS", "300"))
    )

    @field_validator("database_url", mode="before")
    @classmethod
    def _normalize_database_url(cls, value: str | None) -> str:
        """Normalize the DATABASE_URL for SQLAlchemy / psycopg2 usage."""

        return normalize_database_url(value)

    @property
    def DATABASE_URL(self) -> str:  # pragma: no cover - backwards compat helper
        """Backwards compatible accessor for ``database_url``."""

        return self.database_url

    @property
    def DB_SCHEMA(self) -> str:  # pragma: no cover - backwards compat helper
        """Backwards compatible accessor for ``db_schema``."""

        return self.db_schema

    @property
    def allowed_origins(self) -> list[str]:
        """Return a sanitized list of allowed CORS origins."""

        default_origins = [
            "http://localhost:5173",
            "http://localhost:5174",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:5174",
        ]

        if not self.allowed_origins_raw:
            return default_origins

        parts = [part.strip() for part in self.allowed_origins_raw.split(",")]
        origins = [part for part in parts if part]

        if not origins:
            return default_origins

        return origins

    @property
    def csrf_header(self) -> str:
        """Return the canonical CSRF header name."""

        return self.csrf_header_name.strip() or "x-csrf-token"

    @property
    def normalized_samesite(self) -> str:
        """Return a normalized SameSite value recognised by Starlette."""

        value = self.session_cookie_samesite.strip().lower()
        if value not in {"lax", "strict", "none"}:
            value = "lax"
        if value == "none":
            return "None"
        return value.capitalize()

    @field_validator("session_cookie_domain", mode="before")
    @classmethod
    def _blank_domain_to_none(cls, value: str | None) -> str | None:
        """Treat blank cookie domain values as ``None``."""

        if value is None:
            return None
        value = value.strip()
        return value or None

    model_config: dict[str, Any] = {"frozen": True}


@lru_cache(1)
def get_settings() -> Settings:
    """Return a cached :class:`Settings` instance."""

    return Settings()


settings = get_settings()
