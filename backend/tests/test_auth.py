"""Authentication flow tests without relying on httpx."""
from __future__ import annotations

import os
import sys
from pathlib import Path

from starlette.requests import Request
from starlette.responses import Response

DB_FILE = Path(__file__).parent / "auth_test.db"
if DB_FILE.exists():
    DB_FILE.unlink()

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

os.environ.setdefault("DATABASE_URL", f"sqlite+pysqlite:///{DB_FILE}")
os.environ.setdefault("DB_SCHEMA", "")
os.environ.setdefault("SESSION_SIGN_KEY", "test-sign-key")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("ALLOWED_ORIGINS", "http://testserver")
os.environ.setdefault("SESSION_COOKIE_SECURE", "false")
os.environ.setdefault("SESSION_COOKIE_SAMESITE", "lax")
os.environ.setdefault("SESSION_TTL_SECONDS", "300")
os.environ.setdefault("CSRF_ENABLED", "false")
os.environ.setdefault("LOGIN_MAX_ATTEMPTS", "3")
os.environ.setdefault("LOGIN_BLOCK_SECONDS", "60")

for module in list(sys.modules):
    if module.startswith("backend.app"):
        sys.modules.pop(module)

from backend.app import models
from backend.app.config import settings
from backend.app.deps import SessionLocal, engine, get_current_user
from backend.app.routers import auth
from backend.app.schemas import LoginRequest
from backend.app.security import hash_password

models.Base.metadata.drop_all(bind=engine)
models.Base.metadata.create_all(bind=engine)


def create_user(username: str, password: str) -> None:
    with SessionLocal() as session:
        session.add(models.User(username=username, password_hash=hash_password(password)))
        session.commit()


def make_request(path: str, method: str = "POST", cookie: str | None = None) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if cookie:
        headers.append((b"cookie", cookie.encode("latin-1")))
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "headers": headers,
        "query_string": b"",
        "client": ("127.0.0.1", 12345),
    }

    async def receive() -> dict[str, str]:  # pragma: no cover - FastAPI expects async callable
        return {"type": "http.request"}

    return Request(scope, receive)


def extract_session_cookie(header_value: str) -> str:
    parts = header_value.split(",")
    for part in parts:
        if part.strip().startswith(f"{settings.session_cookie_name}="):
            return part.split(";", 1)[0]
    raise AssertionError("session cookie not present")


def test_login_and_me_flow():
    create_user("alice", "wonderland")

    response = Response()
    request = make_request("/auth/login")
    with SessionLocal() as session:
        login_result = auth.login(
            payload=LoginRequest(username="alice", password="wonderland"),
            request=request,
            response=response,
            db=session,
        )

    assert login_result.next == "authenticated"
    cookie_header = response.headers.get("set-cookie")
    assert cookie_header is not None
    cookie_kv = extract_session_cookie(cookie_header)

    me_request = make_request("/auth/me", method="GET", cookie=cookie_kv)
    with SessionLocal() as session:
        current_user = get_current_user(me_request, db=session)
    profile = auth.me(current_user=current_user)
    assert profile.username == "alice"
    assert profile.is_active is True

    logout_response = Response()
    auth.logout(logout_response)
    assert settings.session_cookie_name in logout_response.headers.get("set-cookie", "")

    unauth_request = make_request("/auth/me", method="GET")
    try:
        with SessionLocal() as session:
            get_current_user(unauth_request, db=session)
    except Exception as exc:  # noqa: BLE001
        assert "invalid session" in str(exc)
    else:  # pragma: no cover - should not happen
        raise AssertionError("Expected authentication failure")


def test_rate_limiting_blocks_after_failures():
    create_user("bob", "builder")
    for _ in range(3):
        response = Response()
        request = make_request("/auth/login")
        try:
            with SessionLocal() as session:
                auth.login(
                    payload=LoginRequest(username="bob", password="wrong"),
                    request=request,
                    response=response,
                    db=session,
                )
        except Exception as exc:  # noqa: BLE001
            assert "invalid credentials" in str(exc)

    blocked_response = Response()
    blocked_request = make_request("/auth/login")
    try:
        with SessionLocal() as session:
            auth.login(
                payload=LoginRequest(username="bob", password="wrong"),
                request=blocked_request,
                response=blocked_response,
                db=session,
            )
    except Exception as exc:  # noqa: BLE001
        assert "too many failed attempts" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("Expected rate limiting to trigger")
