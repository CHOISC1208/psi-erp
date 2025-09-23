from __future__ import annotations

import asyncio
import csv
import io
import json
import os
import sys
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlencode

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


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
        encoded_params = []
        for key, value in query_params.items():
            if isinstance(value, (list, tuple)):
                encoded_params.extend((key, str(item)) for item in value)
            else:
                encoded_params.append((key, str(value)))
        query_string = urlencode(encoded_params, doseq=True).encode("latin-1")

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
    receive_calls = 0

    async def receive() -> dict[str, object]:
        nonlocal receive_calls
        if receive_calls == 0:
            receive_calls += 1
            return {"type": "http.request", "body": body, "more_body": False}
        if receive_calls == 1:
            receive_calls += 1
            return {"type": "http.request", "body": b"", "more_body": False}
        return {"type": "http.disconnect"}

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


def _create_session(env: SimpleNamespace, title: str = "Sprint"):
    with env.SessionLocal() as session:
        record = env.models.Session(title=title, description=None)
        session.add(record)
        session.commit()
        session.refresh(record)
        return record


def _collect_streaming_response(response) -> bytes:
    async def consume() -> bytes:
        chunks: list[bytes] = []
        async for chunk in response.body_iterator:
            chunks.append(chunk)
        return b"".join(chunks)

    return asyncio.run(consume())


def _export_csv(
    app_env: SimpleNamespace,
    *,
    user,
    session_id: uuid.UUID,
    include_audit: bool = False,
) -> bytes:
    from backend.app.routers import channel_transfers as channel_transfers_router

    with app_env.SessionLocal() as session:
        response = channel_transfers_router.export_channel_transfers(
            session_id=session_id,
            sku_code=None,
            warehouse_name=None,
            channel=None,
            updated_at=None,
            start_date=None,
            end_date=None,
            actor=None,
            include_audit=include_audit,
            db=session,
            current_user=user,
        )
    return _collect_streaming_response(response)


@pytest.fixture(scope="module")
def app_env(tmp_path_factory: pytest.TempPathFactory) -> SimpleNamespace:
    db_path = tmp_path_factory.mktemp("channel") / "channel_test.db"
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

    table = models.ChannelTransfer.__table__
    table.schema = None
    table.kwargs.pop("schema", None)
    for constraint in list(table.constraints):
        if hasattr(constraint, "schema"):
            constraint.schema = None

    with engine.begin() as connection:
        models.ChannelTransfer.__table__.drop(bind=connection, checkfirst=True)
        models.Session.__table__.drop(bind=connection, checkfirst=True)
        models.User.__table__.drop(bind=connection, checkfirst=True)
        models.User.__table__.create(bind=connection, checkfirst=True)
        models.Session.__table__.create(bind=connection, checkfirst=True)
        models.ChannelTransfer.__table__.create(bind=connection, checkfirst=True)

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
        connection.execute(app_env.models.ChannelTransfer.__table__.delete())
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
    ("method", "path", "payload", "query_params"),
    [
        ("GET", "/channel-transfers", None, None),
        (
            "POST",
            "/channel-transfers",
            {
                "session_id": str(uuid.uuid4()),
                "sku_code": "SKU",
                "warehouse_name": "WH",
                "transfer_date": "2023-01-01",
                "from_channel": "A",
                "to_channel": "B",
                "qty": 1,
            },
            None,
        ),
        (
            "PUT",
            "/channel-transfers/00000000-0000-0000-0000-000000000000/SKU/WH/2023-01-01/A/B",
            {"qty": 10},
            None,
        ),
        (
            "DELETE",
            "/channel-transfers/00000000-0000-0000-0000-000000000000/SKU/WH/2023-01-01/A/B",
            None,
            None,
        ),
        (
            "GET",
            "/channel-transfers/00000000-0000-0000-0000-000000000000/export",
            None,
            None,
        ),
    ],
)
def test_channel_transfer_endpoints_require_authentication(
    app_env: SimpleNamespace,
    method: str,
    path: str,
    payload: dict[str, object] | None,
    query_params: dict[str, object] | None,
) -> None:
    status, _, _ = _perform_request(
        app_env.app, method, path, json_body=payload, query_params=query_params
    )
    assert status == 401


def test_create_and_update_stamp_audit_fields(
    app_env: SimpleNamespace, auth_user
) -> None:
    user = auth_user
    session_record = _create_session(app_env)

    payload = {
        "session_id": str(session_record.id),
        "sku_code": "SKU-100",
        "warehouse_name": "Tokyo",
        "transfer_date": "2023-04-01",
        "from_channel": "Online",
        "to_channel": "Retail",
        "qty": 5,
        "note": "Initial",
    }

    status, _, created = _perform_json_request(
        app_env.app, "POST", "/channel-transfers", json_body=payload
    )
    assert status == 201
    assert isinstance(created, dict)
    assert "created_by" not in created
    assert "updated_by" not in created

    key = (
        session_record.id,
        payload["sku_code"],
        payload["warehouse_name"],
        date.fromisoformat(payload["transfer_date"]),
        payload["from_channel"],
        payload["to_channel"],
    )
    with app_env.SessionLocal() as session:
        stored = session.get(app_env.models.ChannelTransfer, key)
        assert stored is not None
        assert stored.created_by == user.id
        assert stored.updated_by == user.id

    update_payload = {"qty": 8}
    path = (
        f"/channel-transfers/{session_record.id}/{payload['sku_code']}/"
        f"{payload['warehouse_name']}/{payload['transfer_date']}/"
        f"{payload['from_channel']}/{payload['to_channel']}"
    )
    status, _, updated = _perform_json_request(
        app_env.app, "PUT", path, json_body=update_payload
    )
    assert status == 200
    assert isinstance(updated, dict)
    assert "updated_by" not in updated

    with app_env.SessionLocal() as session:
        stored = session.get(app_env.models.ChannelTransfer, key)
        assert stored is not None
        assert stored.qty == Decimal("8")
        assert stored.updated_by == user.id


def test_actor_filtering_supports_uuid_and_username(
    app_env: SimpleNamespace, auth_user
) -> None:
    user = auth_user
    other = _create_user(app_env, username="observer")
    session_record = _create_session(app_env, title="Filtering")

    with app_env.SessionLocal() as session:
        transfer_a = app_env.models.ChannelTransfer(
            session_id=session_record.id,
            sku_code="SKU-A",
            warehouse_name="Central",
            transfer_date=date(2023, 5, 1),
            from_channel="Outlet",
            to_channel="Online",
            qty=Decimal("3"),
            note=None,
            created_by=user.id,
            updated_by=user.id,
        )
        transfer_b = app_env.models.ChannelTransfer(
            session_id=session_record.id,
            sku_code="SKU-B",
            warehouse_name="Central",
            transfer_date=date(2023, 5, 2),
            from_channel="Online",
            to_channel="Outlet",
            qty=Decimal("4"),
            note=None,
            created_by=other.id,
            updated_by=other.id,
        )
        session.add_all([transfer_a, transfer_b])
        session.commit()

    status, _, body = _perform_json_request(
        app_env.app,
        "GET",
        "/channel-transfers",
        query_params={"actor": str(user.id)},
    )
    assert status == 200
    assert isinstance(body, list)
    assert [item["sku_code"] for item in body] == ["SKU-A"]

    status, _, body = _perform_json_request(
        app_env.app,
        "GET",
        "/channel-transfers",
        query_params={"actor": other.username.upper()},
    )
    assert status == 200
    assert isinstance(body, list)
    assert [item["sku_code"] for item in body] == ["SKU-B"]


def test_export_audit_columns_toggle(
    app_env: SimpleNamespace, auth_user, monkeypatch
) -> None:
    user = auth_user
    session_record = _create_session(app_env, title="Export")

    payload = {
        "session_id": str(session_record.id),
        "sku_code": "SKU-EXP",
        "warehouse_name": "Osaka",
        "transfer_date": "2023-06-01",
        "from_channel": "HQ",
        "to_channel": "Store",
        "qty": 2,
    }
    status, _, _ = _perform_json_request(
        app_env.app, "POST", "/channel-transfers", json_body=payload
    )
    assert status == 201

    body = _export_csv(app_env, user=user, session_id=session_record.id)
    rows = list(csv.reader(io.StringIO(body.decode("utf-8"))))
    assert len(rows) == 2
    assert rows[0] == [
        "session_title",
        "transfer_date",
        "sku_code",
        "warehouse_name",
        "from_channel",
        "to_channel",
        "qty",
        "note",
    ]

    new_settings = app_env.settings.model_copy(update={"expose_audit_fields": True})
    monkeypatch.setattr("backend.app.config.settings", new_settings, raising=False)
    monkeypatch.setattr(
        "backend.app.routers.channel_transfers.settings", new_settings, raising=False
    )
    app_env.settings = new_settings

    body = _export_csv(
        app_env,
        user=user,
        session_id=session_record.id,
        include_audit=True,
    )
    rows = list(csv.reader(io.StringIO(body.decode("utf-8"))))
    assert len(rows) == 2
    assert rows[0] == [
        "session_title",
        "transfer_date",
        "sku_code",
        "warehouse_name",
        "from_channel",
        "to_channel",
        "qty",
        "note",
        "created_by",
        "created_by_username",
        "created_at",
        "updated_by",
        "updated_by_username",
        "updated_at",
    ]
    data_row = rows[1]
    assert data_row[8] == str(user.id)
    assert data_row[9] == user.username
    assert data_row[11] == str(user.id)
    assert data_row[12] == user.username
    assert data_row[10]
    assert data_row[13]
