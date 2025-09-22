"""Custom FastAPI middlewares for security headers and CSRF."""
from __future__ import annotations

from typing import Iterable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from .config import settings


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach a strict set of security related headers to all responses."""

    def __init__(self, app, *, csp: str | None = None) -> None:  # type: ignore[override]
        super().__init__(app)
        self.csp = csp or "default-src 'self'; frame-ancestors 'none'; form-action 'self'"

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        response: Response = await call_next(request)
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload"
        )
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Content-Security-Policy", self.csp)
        return response


class CSRFMiddleware(BaseHTTPMiddleware):
    """Minimal double submit cookie CSRF protection."""

    safe_methods: Iterable[str] = {"GET", "HEAD", "OPTIONS"}

    def __init__(self, app):  # type: ignore[override]
        super().__init__(app)
        self.header_name = settings.csrf_header.lower()
        self.cookie_name = settings.csrf_cookie_name
        self.exempt_paths = {
            "/auth/login",
            "/api/auth/login",
        }

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        if (
            request.method.upper() not in self.safe_methods
            and request.url.path not in self.exempt_paths
        ):
            cookie_token = request.cookies.get(self.cookie_name)
            header_token = request.headers.get(self.header_name)
            if not cookie_token or not header_token or cookie_token != header_token:
                return Response(status_code=403, content="CSRF validation failed")
        return await call_next(request)
