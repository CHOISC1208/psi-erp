"""Authentication helpers (password hashing, session handling, rate limiting)."""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import secrets
import threading
import time
from typing import Any

try:  # pragma: no cover - optional dependency is validated via tests
    from passlib.context import CryptContext
except ModuleNotFoundError:  # pragma: no cover - exercised when passlib isn't installed
    CryptContext = None
else:  # pragma: no cover - import succeeds in production environments
    _pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto")


if "_pwd_context" not in globals():  # pragma: no cover - evaluated in test environment
    _pwd_context = None


try:  # pragma: no cover - optional dependency
    from argon2 import PasswordHasher
    from argon2.exceptions import InvalidHash, VerifyMismatchError
except ModuleNotFoundError:  # pragma: no cover - exercised when argon2-cffi isn't installed
    PasswordHasher = None
    InvalidHash = VerifyMismatchError = Exception
else:  # pragma: no cover - import succeeds when argon2-cffi is present
    _argon2_hasher = PasswordHasher()


if "_argon2_hasher" not in globals():  # pragma: no cover - evaluated in test environment
    _argon2_hasher = None

from .config import settings


def hash_password(password: str) -> str:
    """Return a secure hash for ``password``."""

    if _pwd_context is not None:
        return _pwd_context.hash(password)
    if _argon2_hasher is not None:
        return _argon2_hasher.hash(password)
    # Fallback for environments where passlib isn't available (e.g. CI without
    # network access). ``plain:`` is intentionally obvious so operators avoid
    # using it outside development.
    return f"plain:{password}"


def verify_password(password: str, hashed: str) -> bool:
    """Return ``True`` if ``password`` matches ``hashed``."""

    if hashed.startswith("plain:"):
        return hmac.compare_digest(password, hashed.removeprefix("plain:"))

    if _pwd_context is not None:
        try:
            return _pwd_context.verify(password, hashed)
        except (TypeError, ValueError):
            return False

    if _argon2_hasher is not None and hashed.startswith("$argon2"):
        try:
            return _argon2_hasher.verify(hashed, password)
        except (VerifyMismatchError, InvalidHash, TypeError, ValueError):
            return False

    # Without passlib/argon2 we cannot validate hashed passwords created with
    # strong algorithms. Return ``False`` instead of raising so the caller
    # handles it as an authentication failure.
    return False


def _password_signature(password_hash: str) -> str:
    digest = hashlib.sha256(password_hash.encode("utf-8")).hexdigest()
    return digest[:32]


def session_signature_from_hash(password_hash: str) -> str:
    """Return the deterministic signature stored in session tokens."""

    return _password_signature(password_hash)


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode((data + padding).encode("ascii"))


def _sign_payload(payload: bytes) -> bytes:
    key = settings.session_sign_key.encode("utf-8")
    return hmac.new(key, payload, hashlib.sha256).digest()


def sign_session(data: dict[str, Any]) -> str:
    """Return a signed session string."""

    payload = json.dumps(data, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signature = _sign_payload(payload)
    return f"{_b64encode(payload)}.{_b64encode(signature)}"


def create_session_payload(user_id: str, password_hash: str) -> dict[str, Any]:
    """Return the payload embedded inside the signed session token."""

    return {
        "uid": user_id,
        "sid": secrets.token_urlsafe(16),
        "pwd": _password_signature(password_hash),
        "iat": int(time.time()),
    }


def load_session(token: str) -> dict[str, Any] | None:
    """Decode and verify ``token`` returning the original payload."""

    try:
        payload_b64, signature_b64 = token.split(".", 1)
        payload_bytes = _b64decode(payload_b64)
        signature_bytes = _b64decode(signature_b64)
    except (ValueError, binascii.Error):
        return None

    expected_signature = _sign_payload(payload_bytes)
    if not hmac.compare_digest(expected_signature, signature_bytes):
        return None

    try:
        data = json.loads(payload_bytes)
    except json.JSONDecodeError:
        return None

    if not isinstance(data, dict):
        return None

    issued_at = data.get("iat")
    if not isinstance(issued_at, (int, float)):
        return None

    if time.time() - float(issued_at) > settings.session_ttl_seconds:
        return None

    return data


def generate_csrf_token() -> str:
    """Return a cryptographically random CSRF token."""

    return secrets.token_urlsafe(32)


class LoginRateLimiter:
    """In-memory rate limiter intended for login attempts."""

    def __init__(self, max_attempts: int, block_seconds: int) -> None:
        self.max_attempts = max_attempts
        self.block_seconds = block_seconds
        self._lock = threading.Lock()
        self._attempts: dict[str, list[float]] = {}

    def _cleanup(self, now: float) -> None:
        expire_before = now - self.block_seconds
        for key, timestamps in list(self._attempts.items()):
            filtered = [ts for ts in timestamps if ts > expire_before]
            if filtered:
                self._attempts[key] = filtered
            else:
                self._attempts.pop(key, None)

    def can_attempt(self, key: str, now: float | None = None) -> bool:
        """Return ``True`` if ``key`` is allowed to attempt a login."""

        current = now or time.monotonic()
        with self._lock:
            self._cleanup(current)
            attempts = self._attempts.get(key, [])
            return len(attempts) < self.max_attempts

    def register_failure(self, key: str, now: float | None = None) -> None:
        current = now or time.monotonic()
        with self._lock:
            self._cleanup(current)
            self._attempts.setdefault(key, []).append(current)

    def reset(self, key: str) -> None:
        with self._lock:
            self._attempts.pop(key, None)


def rate_limiter_factory() -> LoginRateLimiter:
    """Return a configured :class:`LoginRateLimiter` instance."""

    return LoginRateLimiter(settings.login_max_attempts, settings.login_block_seconds)
