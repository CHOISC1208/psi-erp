"""Unit tests for the reallocation policy service helpers."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _reset_backend_modules() -> None:
    for name in list(sys.modules):
        if name.startswith("backend.app"):
            del sys.modules[name]


@pytest.fixture()
def isolated_app(tmp_path: Path):
    """Provide an isolated application environment bound to a temp database."""

    db_path = tmp_path / "policy.sqlite"
    os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{db_path}"  # use sqlite for tests
    os.environ["DB_SCHEMA"] = ""

    _reset_backend_modules()

    from backend.app import models
    from backend.app.deps import SessionLocal, engine

    yield Path(db_path), models, SessionLocal, engine

    engine.dispose()


def test_get_reallocation_policy_returns_defaults_when_table_missing(isolated_app) -> None:
    db_path, models, SessionLocal, engine = isolated_app

    if db_path.exists():
        db_path.unlink()

    with engine.begin() as connection:
        models.ReallocationPolicy.__table__.drop(bind=connection, checkfirst=True)

    from backend.app.services.reallocation_policy import (
        ReallocationPolicyData,
        get_reallocation_policy,
    )

    with SessionLocal() as session:
        policy = get_reallocation_policy(session)

    assert policy.take_from_other_main is False
    assert policy.rounding_mode == "floor"
    assert policy.allow_overfill is False
    assert policy.fair_share_mode == "off"
    assert policy.updated_by is None
    assert policy.updated_at is not None
