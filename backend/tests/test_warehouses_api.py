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


@pytest.fixture(scope="module")
def app_env(tmp_path_factory: pytest.TempPathFactory) -> SimpleNamespace:
    db_path = tmp_path_factory.mktemp("warehouses") / "warehouse_test.sqlite"
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
    from backend.app.deps import SessionLocal, engine
    from backend.app.main import app

    with engine.begin() as connection:
        models.ChannelMaster.__table__.drop(bind=connection, checkfirst=True)
        models.WarehouseMaster.__table__.drop(bind=connection, checkfirst=True)
        models.ChannelMaster.__table__.create(bind=connection, checkfirst=True)
        models.WarehouseMaster.__table__.create(bind=connection, checkfirst=True)

    asyncio.run(app.router.startup())

    return SimpleNamespace(
        app=app,
        models=models,
        SessionLocal=SessionLocal,
        engine=engine,
    )


@pytest.fixture(autouse=True)
def clear_tables(app_env: SimpleNamespace) -> None:
    with app_env.engine.begin() as connection:
        connection.execute(app_env.models.WarehouseMaster.__table__.delete())
        connection.execute(app_env.models.ChannelMaster.__table__.delete())
    yield


def test_list_warehouses_returns_sorted_records(app_env: SimpleNamespace) -> None:
    with app_env.SessionLocal() as session:
        session.add_all(
            [
                app_env.models.ChannelMaster(channel="Online", display_name="EC"),
                app_env.models.ChannelMaster(channel="Retail", display_name="店舗"),
            ]
        )
        session.add_all(
            [
                app_env.models.WarehouseMaster(
                    warehouse_name="Osaka", region="Kansai", main_channel="Retail"
                ),
                app_env.models.WarehouseMaster(
                    warehouse_name="Tokyo", region="Kanto", main_channel="Online"
                ),
            ]
        )
        session.commit()

    status, payload = _perform_json_request(app_env.app, "GET", "/warehouses")
    assert status == 200
    assert payload == [
        {
            "warehouse_name": "Osaka",
            "region": "Kansai",
            "main_channel": "Retail",
        },
        {
            "warehouse_name": "Tokyo",
            "region": "Kanto",
            "main_channel": "Online",
        },
    ]


def test_get_warehouse_returns_record(app_env: SimpleNamespace) -> None:
    with app_env.SessionLocal() as session:
        session.add(app_env.models.ChannelMaster(channel="Online", display_name="EC"))
        session.add(
            app_env.models.WarehouseMaster(
                warehouse_name="Central", region=None, main_channel="Online"
            )
        )
        session.commit()

    status, payload = _perform_json_request(app_env.app, "GET", "/warehouses/Central")
    assert status == 200
    assert payload == {
        "warehouse_name": "Central",
        "region": None,
        "main_channel": "Online",
    }


def test_get_warehouse_missing_returns_404(app_env: SimpleNamespace) -> None:
    status, payload = _perform_json_request(app_env.app, "GET", "/warehouses/Unknown")
    assert status == 404
    assert payload == {"detail": "warehouse not found"}


def test_create_warehouse_inserts_record(app_env: SimpleNamespace) -> None:
    with app_env.SessionLocal() as session:
        session.add(app_env.models.ChannelMaster(channel="Retail", display_name="店舗"))
        session.commit()

    status, payload = _perform_json_request(
        app_env.app,
        "POST",
        "/warehouses",
        {
            "warehouse_name": "Central",
            "region": "Kanto",
            "main_channel": "Retail",
        },
    )

    assert status == 201
    assert payload == {
        "warehouse_name": "Central",
        "region": "Kanto",
        "main_channel": "Retail",
    }

    with app_env.SessionLocal() as session:
        record = session.get(app_env.models.WarehouseMaster, "Central")
        assert record is not None
        assert record.region == "Kanto"
        assert record.main_channel == "Retail"


def test_update_warehouse_allows_rename(app_env: SimpleNamespace) -> None:
    with app_env.SessionLocal() as session:
        session.add_all(
            [
                app_env.models.ChannelMaster(channel="Retail", display_name="店舗"),
                app_env.models.ChannelMaster(channel="Outlet", display_name="アウトレット"),
            ]
        )
        session.add(
            app_env.models.WarehouseMaster(
                warehouse_name="Central",
                region="Kanto",
                main_channel="Retail",
            )
        )
        session.commit()

    status, payload = _perform_json_request(
        app_env.app,
        "PUT",
        "/warehouses/Central",
        {
            "warehouse_name": "Central-East",
            "region": "Kanto East",
            "main_channel": "Outlet",
        },
    )

    assert status == 200
    assert payload == {
        "warehouse_name": "Central-East",
        "region": "Kanto East",
        "main_channel": "Outlet",
    }

    with app_env.SessionLocal() as session:
        original = session.get(app_env.models.WarehouseMaster, "Central")
        assert original is None
        updated = session.get(app_env.models.WarehouseMaster, "Central-East")
        assert updated is not None
        assert updated.region == "Kanto East"
        assert updated.main_channel == "Outlet"


def test_delete_warehouse_removes_record(app_env: SimpleNamespace) -> None:
    with app_env.SessionLocal() as session:
        session.add(app_env.models.WarehouseMaster(warehouse_name="Central", region=None, main_channel=None))
        session.commit()

    status, payload = _perform_json_request(app_env.app, "DELETE", "/warehouses/Central")
    assert status == 204
    assert payload is None

    with app_env.SessionLocal() as session:
        assert session.get(app_env.models.WarehouseMaster, "Central") is None
