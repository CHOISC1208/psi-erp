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
    db_path = tmp_path_factory.mktemp("rank_params") / "rank_params.sqlite"
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
        models.CategoryRankParameter.__table__.drop(bind=connection, checkfirst=True)
        models.CategoryRankParameter.__table__.create(bind=connection, checkfirst=True)

    asyncio.run(app.router.startup())

    return SimpleNamespace(
        app=app,
        models=models,
        SessionLocal=SessionLocal,
        engine=engine,
    )


@pytest.fixture(autouse=True)
def clear_table(app_env: SimpleNamespace) -> None:
    with app_env.engine.begin() as connection:
        connection.execute(app_env.models.CategoryRankParameter.__table__.delete())
    yield


def test_create_rank_parameter(app_env: SimpleNamespace) -> None:
    status, payload = _perform_json_request(
        app_env.app,
        "POST",
        "/category-rank-parameters",
        {
            "rank_type": "FW",
            "category_1": "A",
            "category_2": "01",
            "threshold": "12.5",
        },
    )

    assert status == 201
    assert payload is not None
    assert payload["rank_type"] == "FW"
    assert payload["category_1"] == "A"
    assert payload["category_2"] == "01"
    assert float(payload["threshold"]) == 12.5

    with app_env.SessionLocal() as session:
        record = session.get(app_env.models.CategoryRankParameter, ("FW", "A", "01"))
        assert record is not None
        assert float(record.threshold) == 12.5


def test_update_rank_parameter_changes_key(app_env: SimpleNamespace) -> None:
    with app_env.SessionLocal() as session:
        session.add(
            app_env.models.CategoryRankParameter(
                rank_type="FW",
                category_1="A",
                category_2="01",
                threshold=12.5,
            )
        )
        session.commit()

    status, payload = _perform_json_request(
        app_env.app,
        "PUT",
        "/category-rank-parameters/FW/A/01",
        {
            "rank_type": "SS",
            "category_1": "A",
            "category_2": "02",
            "threshold": "20.000000",
        },
    )

    assert status == 200
    assert payload is not None
    assert payload["rank_type"] == "SS"
    assert payload["category_1"] == "A"
    assert payload["category_2"] == "02"
    assert float(payload["threshold"]) == 20

    with app_env.SessionLocal() as session:
        old_record = session.get(app_env.models.CategoryRankParameter, ("FW", "A", "01"))
        assert old_record is None
        new_record = session.get(app_env.models.CategoryRankParameter, ("SS", "A", "02"))
        assert new_record is not None
        assert float(new_record.threshold) == 20


def test_delete_rank_parameter(app_env: SimpleNamespace) -> None:
    with app_env.SessionLocal() as session:
        session.add(
            app_env.models.CategoryRankParameter(
                rank_type="FW",
                category_1="A",
                category_2="01",
                threshold=12.5,
            )
        )
        session.commit()

    status, payload = _perform_json_request(
        app_env.app, "DELETE", "/category-rank-parameters/FW/A/01"
    )

    assert status == 204
    assert payload is None

    with app_env.SessionLocal() as session:
        assert (
            session.get(app_env.models.CategoryRankParameter, ("FW", "A", "01")) is None
        )
