"""Session router behavioural tests."""
from __future__ import annotations

import asyncio
import csv
import json
import os
import sys
import uuid
from decimal import Decimal
from functools import lru_cache
from io import BytesIO, StringIO
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlencode

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import select

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


@lru_cache(maxsize=1)
def _get_sessions_router():
    from backend.app.routers import sessions as sessions_router

    return sessions_router


def _perform_request(
    app,
    method: str,
    path: str,
    json_body: dict[str, object] | None = None,
    query_params: dict[str, object] | None = None,
    headers: list[tuple[str, str]] | None = None,
) -> tuple[int, dict[str, str], bytes]:
    body = b""
    header_list: list[tuple[bytes, bytes]] = []
    if headers:
        header_list.extend(
            (key.lower().encode("latin-1"), value.encode("latin-1"))
            for key, value in headers
        )
    if json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
        header_list.append((b"content-type", b"application/json"))

    query_string = b""
    if query_params:
        encoded: list[tuple[str, str]] = []
        for key, value in query_params.items():
            if isinstance(value, (list, tuple)):
                encoded.extend((key, str(item)) for item in value)
            else:
                encoded.append((key, str(value)))
        query_string = urlencode(encoded, doseq=True).encode("latin-1")

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "path": path,
        "raw_path": path.encode("latin-1"),
        "scheme": "http",
        "headers": header_list,
        "query_string": query_string,
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
        key.decode("latin-1"): value.decode("latin-1")
        for key, value in start.get("headers", [])
    }
    body_bytes = b"".join(
        msg.get("body", b"")
        for msg in messages
        if msg["type"] == "http.response.body"
    )
    return start["status"], response_headers, body_bytes


def _perform_json_request(
    app,
    method: str,
    path: str,
    json_body: dict[str, object] | None = None,
    query_params: dict[str, object] | None = None,
) -> tuple[int, dict[str, str], object | None]:
    status, headers, body = _perform_request(
        app, method, path, json_body=json_body, query_params=query_params
    )
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


@pytest.fixture(scope="module")
def app_env(tmp_path_factory: pytest.TempPathFactory) -> SimpleNamespace:
    db_path = tmp_path_factory.mktemp("sessions") / "sessions_test.db"
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
        models.PSIBase.__table__.drop(bind=connection, checkfirst=True)
        models.Session.__table__.drop(bind=connection, checkfirst=True)
        models.User.__table__.drop(bind=connection, checkfirst=True)
        models.User.__table__.create(bind=connection, checkfirst=True)
        models.Session.__table__.create(bind=connection, checkfirst=True)
        models.PSIBase.__table__.create(bind=connection, checkfirst=True)

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
        connection.execute(app_env.models.PSIBase.__table__.delete())
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


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("GET", "/sessions", None),
        ("GET", "/sessions/leader", None),
        ("GET", f"/sessions/{uuid.uuid4()}", None),
        ("POST", "/sessions", {"title": "Blocked"}),
        ("PUT", f"/sessions/{uuid.uuid4()}", {"title": "Blocked"}),
        ("DELETE", f"/sessions/{uuid.uuid4()}", None),
        ("PATCH", f"/sessions/{uuid.uuid4()}/leader", {}),
    ],
)
def test_sessions_require_authentication(
    app_env: SimpleNamespace, method: str, path: str, payload: dict[str, object] | None
) -> None:
    status, _, _ = _perform_request(app_env.app, method, path, json_body=payload)
    assert status == 401


def test_create_session_stamps_audit_fields_without_exposing(
    app_env: SimpleNamespace, auth_user
) -> None:
    user = auth_user
    payload = {"title": "Sprint 1", "description": "Initial"}

    status, _, body = _perform_json_request(app_env.app, "POST", "/sessions", payload)
    assert status == 201
    assert isinstance(body, dict)
    assert body["title"] == "Sprint 1"
    assert body["data_mode"] == "base"
    assert body["data_type"] == "base"
    assert "created_by" not in body
    assert "updated_by" not in body
    assert body["created_by_username"] == user.username
    assert body["updated_by_username"] == user.username

    session_id = uuid.UUID(body["id"])
    with app_env.SessionLocal() as session:
        stored = session.get(app_env.models.Session, session_id)
        assert stored is not None
        assert stored.created_by == user.id
        assert stored.updated_by == user.id


def test_session_responses_include_audit_fields_when_enabled(
    app_env: SimpleNamespace, auth_user, monkeypatch
) -> None:
    user = auth_user
    new_settings = app_env.settings.model_copy(update={"expose_audit_fields": True})
    monkeypatch.setattr("backend.app.config.settings", new_settings, raising=False)
    monkeypatch.setattr("backend.app.routers.sessions.settings", new_settings, raising=False)

    payload = {"title": "Sprint 2", "description": "Audit", "data_mode": "summary"}
    status, _, created = _perform_json_request(app_env.app, "POST", "/sessions", payload)
    assert status == 201
    assert isinstance(created, dict)
    assert created["data_mode"] == "summary"
    assert created["data_type"] == "summary"
    assert created["created_by"] == str(user.id)
    assert created["updated_by"] == str(user.id)
    assert created["created_by_username"] == user.username
    assert created["updated_by_username"] == user.username

    session_id = created["id"]

    status, _, updated = _perform_json_request(
        app_env.app,
        "PUT",
        f"/sessions/{session_id}",
        {"description": "Updated", "data_mode": "base"},
    )
    assert status == 409
    assert updated == {"detail": "data_mode cannot be modified after session creation."}

    status, _, leader = _perform_json_request(
        app_env.app, "PATCH", f"/sessions/{session_id}/leader", {}
    )
    assert status == 200
    assert isinstance(leader, dict)
    assert leader["is_leader"] is True
    assert leader["updated_by"] == str(user.id)
    assert leader["data_mode"] == "summary"

    status, _, listing = _perform_json_request(app_env.app, "GET", "/sessions")
    assert status == 200
    assert isinstance(listing, list)
    assert listing
    assert listing[0]["created_by_username"] == user.username
    assert listing[0]["updated_by_username"] == user.username
    assert listing[0]["data_mode"] == "summary"

    with app_env.SessionLocal() as session:
        stored = session.get(app_env.models.Session, uuid.UUID(session_id))
        assert stored is not None
        assert stored.created_by == user.id
        assert stored.updated_by == user.id


def test_update_session_does_not_allow_data_mode_change(
    app_env: SimpleNamespace, auth_user
) -> None:
    payload = {"title": "Mode locked", "data_mode": "base"}
    status, _, created = _perform_json_request(app_env.app, "POST", "/sessions", payload)
    assert status == 201
    session_id = created["id"]

    status, _, response = _perform_json_request(
        app_env.app,
        "PUT",
        f"/sessions/{session_id}",
        {"title": "Mode locked", "data_mode": "summary"},
    )
    assert status == 409
    assert response == {"detail": "data_mode cannot be modified after session creation."}


def test_update_session_allows_other_fields(
    app_env: SimpleNamespace, auth_user
) -> None:
    payload = {"title": "Editable", "description": "initial"}
    status, _, created = _perform_json_request(app_env.app, "POST", "/sessions", payload)
    assert status == 201
    session_id = created["id"]

    status, _, updated = _perform_json_request(
        app_env.app,
        "PUT",
        f"/sessions/{session_id}",
        {"description": "updated"},
    )
    assert status == 200
    assert updated["description"] == "updated"
    assert updated["data_mode"] == "base"


def test_list_sessions_supports_search(
    app_env: SimpleNamespace, auth_user
) -> None:
    user = auth_user

    first_payload = {"title": "Alpha Plan", "description": "North region"}
    second_payload = {"title": "Roadmap", "description": "Q2 planning"}

    status, _, _ = _perform_json_request(app_env.app, "POST", "/sessions", first_payload)
    assert status == 201
    status, _, _ = _perform_json_request(app_env.app, "POST", "/sessions", second_payload)
    assert status == 201

    other_user = _create_user(app_env, username="planner")

    app_env.app.dependency_overrides[app_env.get_current_user] = lambda: other_user
    third_payload = {"title": "Gamma", "description": "Central"}
    status, _, _ = _perform_json_request(app_env.app, "POST", "/sessions", third_payload)
    assert status == 201
    app_env.app.dependency_overrides[app_env.get_current_user] = lambda: user

    status, _, by_title = _perform_json_request(
        app_env.app, "GET", "/sessions", query_params={"search": "road"}
    )
    assert status == 200
    assert [item["title"] for item in by_title] == ["Roadmap"]

    status, _, by_description = _perform_json_request(
        app_env.app, "GET", "/sessions", query_params={"search": "north"}
    )
    assert status == 200
    assert [item["title"] for item in by_description] == ["Alpha Plan"]

    status, _, by_username = _perform_json_request(
        app_env.app, "GET", "/sessions", query_params={"search": "planner"}
    )
    assert status == 200
    assert [item["title"] for item in by_username] == ["Gamma"]


def _create_csv_payload(session_id: uuid.UUID, *, date_value: str = "2024-01-01") -> bytes:
    definition = _get_sessions_router().DATASET_DEFINITIONS["psi_base"]
    row = {column: "" for column in definition.columns}
    row.update(
        {
            "session_id": str(session_id),
            "sku_code": "SKU-001",
            "sku_name": "Widget",
            "warehouse_name": "Main",
            "channel": "ONLINE",
            "date": date_value,
            "stock_at_anchor": "5",
            "inbound_qty": "3",
            "outbound_qty": "2",
            "safety_stock": "4",
            "movable_stock": "1",
        }
    )
    buffer = StringIO()
    writer = csv.writer(buffer)
    writer.writerow(definition.columns)
    writer.writerow([row[column] for column in definition.columns])
    return buffer.getvalue().encode("utf-8")


def _invoke_import(
    session_id: uuid.UUID,
    csv_bytes: bytes,
    *,
    app_env: SimpleNamespace,
    current_user,
) -> object:
    router = _get_sessions_router()
    upload = UploadFile(filename="psi_base.csv", file=BytesIO(csv_bytes))
    upload.file.seek(0)
    with app_env.SessionLocal() as db_session:
        return asyncio.run(
            router.import_session_psi_base(
                session_id=session_id,
                file=upload,
                mode="replace",
                db=db_session,
                current_user=current_user,
            )
        )


def test_import_psi_base_blank_numeric_defaults_to_zero(
    app_env: SimpleNamespace, auth_user
) -> None:
    status, _, created = _perform_json_request(
        app_env.app, "POST", "/sessions", {"title": "Import"}
    )
    assert status == 201
    session_id = uuid.UUID(created["id"])

    response = _invoke_import(
        session_id,
        _create_csv_payload(session_id),
        app_env=app_env,
        current_user=auth_user,
    )
    assert response.added == 1
    assert response.updated == 0
    assert response.deleted == 0

    with app_env.SessionLocal() as check_session:
        stored = check_session.scalars(select(app_env.models.PSIBase)).one()
        assert stored.net_flow == Decimal("0")
        assert stored.stock_closing == Decimal("0")


def test_import_psi_base_invalid_date_reports_row_error(
    app_env: SimpleNamespace, auth_user
) -> None:
    status, _, created = _perform_json_request(
        app_env.app, "POST", "/sessions", {"title": "Import"}
    )
    assert status == 201
    session_id = uuid.UUID(created["id"])

    invalid_csv = _create_csv_payload(session_id, date_value="20240101")

    with pytest.raises(HTTPException) as exc_info:
        _invoke_import(
            session_id,
            invalid_csv,
            app_env=app_env,
            current_user=auth_user,
        )

    error = exc_info.value
    assert error.status_code == 400
    assert error.detail["message"] == "Validation failed"
    assert error.detail["errors"] == [
        {"row": 2, "field": "date", "message": "must use YYYY-MM-DD"}
    ]

    with app_env.SessionLocal() as check_session:
        assert check_session.scalars(select(app_env.models.PSIBase)).first() is None
