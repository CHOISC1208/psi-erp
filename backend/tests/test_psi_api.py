"""PSI router behavioural tests."""
from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _perform_request(
    app,
    method: str,
    path: str,
    json_body: dict[str, object] | None = None,
    headers: list[tuple[str, str]] | None = None,
) -> tuple[int, dict[str, str], bytes]:
    body = b""
    header_list: list[tuple[bytes, bytes]] = []
    if headers:
        header_list.extend(
            (key.lower().encode("latin-1"), value.encode("latin-1")) for key, value in headers
        )
    if json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
        header_list.append((b"content-type", b"application/json"))

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "path": path,
        "raw_path": path.encode("latin-1"),
        "scheme": "http",
        "headers": header_list,
        "query_string": b"",
        "server": ("testserver", 80),
        "client": ("testclient", 12345),
    }

    messages: list[dict[str, object]] = []
    body_sent = False

    async def receive() -> dict[str, object]:
        nonlocal body_sent
        if body_sent:
            return {"type": "http.disconnect"}
        body_sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message: dict[str, object]) -> None:
        messages.append(message)

    asyncio.run(app(scope, receive, send))

    start = next(msg for msg in messages if msg["type"] == "http.response.start")
    response_headers = {
        key.decode("latin-1"): value.decode("latin-1") for key, value in start.get("headers", [])
    }
    body_bytes = b"".join(
        msg.get("body", b"") for msg in messages if msg["type"] == "http.response.body"
    )
    return start["status"], response_headers, body_bytes


def _perform_json_request(
    app,
    method: str,
    path: str,
    json_body: dict[str, object] | None = None,
) -> tuple[int, dict[str, str], object | None]:
    status, headers, body = _perform_request(app, method, path, json_body=json_body)
    if body:
        return status, headers, json.loads(body.decode("utf-8"))
    return status, headers, None


def _create_user(env: SimpleNamespace, username: str = "auditor"):
    with env.SessionLocal() as session:
        user = env.models.User(
            username=username,
            password_hash="x",
            is_active=True,
            is_admin=False,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        return user


def _create_session(env: SimpleNamespace, user) -> object:
    with env.SessionLocal() as session:
        record = env.models.Session(
            title="Forecast",
            description=None,
            is_leader=False,
            created_by=user.id,
            updated_by=user.id,
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record


@pytest.fixture(scope="module")
def app_env(tmp_path_factory: pytest.TempPathFactory) -> SimpleNamespace:
    db_path = tmp_path_factory.mktemp("psi") / "psi_test.db"
    os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{db_path}"
    os.environ["DB_SCHEMA"] = ""
    os.environ.setdefault("SESSION_SIGN_KEY", "test-sign-key")
    os.environ.setdefault("SECRET_KEY", "test-secret")
    os.environ.setdefault(
        "ALLOWED_ORIGINS",
        "http://testserver,http://localhost:5173,http://localhost:5174",
    )
    os.environ.setdefault("SESSION_COOKIE_SECURE", "false")
    os.environ.setdefault("SESSION_COOKIE_SAMESITE", "lax")
    os.environ.setdefault("SESSION_TTL_SECONDS", "300")
    os.environ.setdefault("CSRF_ENABLED", "false")
    os.environ.setdefault("LOGIN_MAX_ATTEMPTS", "3")
    os.environ.setdefault("LOGIN_BLOCK_SECONDS", "60")
    os.environ.setdefault("EXPOSE_AUDIT_FIELDS", "false")

    for module in list(sys.modules):
        if module.startswith("backend.app"):
            sys.modules.pop(module)

    from backend.app import models
    from backend.app.config import settings
    from backend.app.deps import SessionLocal, engine, get_current_user
    from backend.app.main import app

    assert settings.db_schema == ""

    with engine.begin() as connection:
        models.PSIEditLog.__table__.drop(bind=connection, checkfirst=True)
        models.PSIEdit.__table__.drop(bind=connection, checkfirst=True)
        models.Session.__table__.drop(bind=connection, checkfirst=True)
        models.User.__table__.drop(bind=connection, checkfirst=True)

        models.User.__table__.create(bind=connection, checkfirst=True)
        models.Session.__table__.create(bind=connection, checkfirst=True)
        models.PSIEdit.__table__.create(bind=connection, checkfirst=True)
        models.PSIEditLog.__table__.create(bind=connection, checkfirst=True)

    asyncio.run(app.router.startup())

    return SimpleNamespace(
        app=app,
        models=models,
        settings=settings,
        SessionLocal=SessionLocal,
        engine=engine,
        get_current_user=get_current_user,
    )


@pytest.fixture(autouse=True)
def clear_database(app_env: SimpleNamespace) -> None:
    with app_env.engine.begin() as connection:
        connection.execute(app_env.models.PSIEditLog.__table__.delete())
        connection.execute(app_env.models.PSIEdit.__table__.delete())
        connection.execute(app_env.models.Session.__table__.delete())
        connection.execute(app_env.models.User.__table__.delete())
    yield


@pytest.fixture(autouse=True)
def clear_overrides(app_env: SimpleNamespace) -> None:
    yield
    app_env.app.dependency_overrides.clear()


@pytest.fixture
def auth_user(app_env: SimpleNamespace):
    user = _create_user(app_env)

    def override_current_user():
        return user

    app_env.app.dependency_overrides[app_env.get_current_user] = override_current_user
    return user


def test_apply_edits_requires_authentication(app_env: SimpleNamespace) -> None:
    session_id = uuid.uuid4()
    status, _, _ = _perform_request(
        app_env.app,
        "POST",
        f"/psi/{session_id}/edits/apply",
        json_body={"edits": []},
    )
    assert status == 401


def test_apply_edits_records_audit_users(app_env: SimpleNamespace, auth_user) -> None:
    user = auth_user
    session = _create_session(app_env, user)

    status, _, body = _perform_json_request(
        app_env.app,
        "POST",
        f"/psi/{session.id}/edits/apply",
        json_body={
            "edits": [
                {
                    "sku_code": "SKU-1",
                    "warehouse_name": "Tokyo",
                    "channel": "Online",
                    "date": "2024-01-01",
                    "inbound_qty": 12.0,
                }
            ]
        },
    )

    assert status == 200
    assert body == {
        "applied": 1,
        "log_entries": 1,
        "last_edited_by": None,
        "last_edited_by_username": None,
        "last_edited_at": None,
    }

    with app_env.SessionLocal() as db:
        edit_row = db.scalars(select(app_env.models.PSIEdit)).one()
        log_row = db.scalars(select(app_env.models.PSIEditLog)).one()

    assert edit_row.created_by == user.id
    assert edit_row.updated_by == user.id
    assert log_row.edited_by == user.id


def test_apply_edits_response_obeys_audit_flag(
    app_env: SimpleNamespace, auth_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = auth_user
    session = _create_session(app_env, user)

    status, _, body = _perform_json_request(
        app_env.app,
        "POST",
        f"/psi/{session.id}/edits/apply",
        json_body={
            "edits": [
                {
                    "sku_code": "SKU-2",
                    "warehouse_name": "Osaka",
                    "channel": "Retail",
                    "date": "2024-02-01",
                    "inbound_qty": 5.0,
                }
            ]
        },
    )

    assert status == 200
    assert body == {
        "applied": 1,
        "log_entries": 1,
        "last_edited_by": None,
        "last_edited_by_username": None,
        "last_edited_at": None,
    }

    monkeypatch.setattr(
        "backend.app.routers.psi.settings",
        app_env.settings.model_copy(update={"expose_audit_fields": True}),
    )

    status, _, body = _perform_json_request(
        app_env.app,
        "POST",
        f"/psi/{session.id}/edits/apply",
        json_body={
            "edits": [
                {
                    "sku_code": "SKU-2",
                    "warehouse_name": "Osaka",
                    "channel": "Retail",
                    "date": "2024-02-01",
                    "inbound_qty": 7.5,
                }
            ]
        },
    )

    assert status == 200
    assert body["applied"] == 1
    assert body["log_entries"] == 1
    assert body["last_edited_by"] == str(user.id)
    assert body["last_edited_by_username"] == user.username
    assert isinstance(body["last_edited_at"], str)
    assert body["last_edited_at"]
