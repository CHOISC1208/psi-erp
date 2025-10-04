import asyncio
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _perform_json_request(app, method: str, path: str, payload: dict | None = None):
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": method,
        "path": path,
        "raw_path": path.encode("latin-1"),
        "scheme": "http",
        "headers": [(b"content-type", b"application/json")] if payload else [],
        "query_string": b"",
        "server": ("testserver", 80),
        "client": ("testclient", 12345),
    }

    messages: list[dict[str, object]] = []
    received = False

    async def receive() -> dict[str, object]:
        nonlocal received
        if received:
            return {"type": "http.disconnect"}
        received = True
        body = json.dumps(payload).encode("utf-8") if payload else b""
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message: dict[str, object]) -> None:
        messages.append(message)

    asyncio.run(app(scope, receive, send))

    start = next(msg for msg in messages if msg["type"] == "http.response.start")
    body = b"".join(
        part.get("body", b"") for part in messages if part["type"] == "http.response.body"
    )
    payload = None
    if body:
        payload = json.loads(body.decode("utf-8"))
    return start["status"], payload


def _create_user(env: SimpleNamespace, *, is_admin: bool, username: str) -> SimpleNamespace:
    with env.SessionLocal() as session:
        user = env.models.User(
            username=username,
            password_hash="x",
            is_active=True,
            is_admin=is_admin,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        return SimpleNamespace(id=user.id, username=user.username, is_admin=user.is_admin)


@pytest.fixture(scope="module")
def app_env(tmp_path_factory: pytest.TempPathFactory) -> SimpleNamespace:
    db_path = tmp_path_factory.mktemp("policy") / "policy.sqlite"
    os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{db_path}"
    os.environ["DB_SCHEMA"] = ""
    os.environ.setdefault("SESSION_SIGN_KEY", "sign")
    os.environ.setdefault("SECRET_KEY", "secret")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:5173")
    os.environ.setdefault("CSRF_ENABLED", "false")

    for name in list(sys.modules):
        if name.startswith("backend.app"):
            del sys.modules[name]

    from backend.app import models
    from backend.app.deps import (
        SessionLocal,
        engine,
        get_admin_user,
        get_current_user,
    )
    from backend.app.main import app

    with engine.begin() as connection:
        models.ReallocationPolicy.__table__.drop(bind=connection, checkfirst=True)
        models.User.__table__.drop(bind=connection, checkfirst=True)
        models.User.__table__.create(bind=connection, checkfirst=True)
        models.ReallocationPolicy.__table__.create(bind=connection, checkfirst=True)

    asyncio.run(app.router.startup())

    return SimpleNamespace(
        app=app,
        models=models,
        SessionLocal=SessionLocal,
        engine=engine,
        get_current_user=get_current_user,
        get_admin_user=get_admin_user,
    )


@pytest.fixture(autouse=True)
def clear_tables(app_env: SimpleNamespace) -> None:
    with app_env.engine.begin() as connection:
        connection.execute(app_env.models.User.__table__.delete())
        connection.execute(app_env.models.ReallocationPolicy.__table__.delete())
    yield
    app_env.app.dependency_overrides.clear()


def test_get_reallocation_policy_returns_defaults(app_env: SimpleNamespace) -> None:
    user = _create_user(app_env, is_admin=False, username="viewer")

    def override_current_user():
        return user

    app_env.app.dependency_overrides[app_env.get_current_user] = override_current_user

    status, payload = _perform_json_request(app_env.app, "GET", "/reallocation-policy")
    assert status == 200
    assert payload is not None
    updated_at = payload["updated_at"]
    assert updated_at is not None
    assert payload == {
        "take_from_other_main": False,
        "rounding_mode": "floor",
        "allow_overfill": False,
        "updated_at": updated_at,
        "updated_by": None,
    }


def test_put_reallocation_policy_updates_values(app_env: SimpleNamespace) -> None:
    admin = _create_user(app_env, is_admin=True, username="admin")

    def override_admin_user():
        return admin

    app_env.app.dependency_overrides[app_env.get_admin_user] = override_admin_user

    status, payload = _perform_json_request(
        app_env.app,
        "PUT",
        "/reallocation-policy",
        {
            "take_from_other_main": True,
            "rounding_mode": "ceil",
            "allow_overfill": True,
            "updated_by": "  policy-bot  ",
        },
    )
    assert status == 200
    assert payload is not None
    assert payload["take_from_other_main"] is True
    assert payload["rounding_mode"] == "ceil"
    assert payload["allow_overfill"] is True
    assert payload["updated_by"] == "policy-bot"

    viewer = _create_user(app_env, is_admin=False, username="viewer")

    def override_current_user():
        return viewer

    app_env.app.dependency_overrides[app_env.get_current_user] = override_current_user

    status, payload = _perform_json_request(app_env.app, "GET", "/reallocation-policy")
    assert status == 200
    assert payload["take_from_other_main"] is True
    assert payload["rounding_mode"] == "ceil"
    assert payload["allow_overfill"] is True
    assert payload["updated_by"] == "policy-bot"
