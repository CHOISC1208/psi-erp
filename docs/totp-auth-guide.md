# FastAPI × React × Heroku × TOTP 2FA 実装ガイド

## 目的
FastAPI バックエンドと React SPA（Vite/CRA）を Heroku に配置する構成で、既存のユーザー名 / パスワード認証に最小限の改造で TOTP 二要素認証を追加するためのテンプレートです。ユーザー登録 UI は提供せず、管理者が直接 DB にユーザーと TOTP シークレットを投入する運用を前提にしています。

---

## 全体アーキテクチャ

### 認証フロー概要
1. `POST /auth/login`
   - username/password を検証。
   - 成功時は 5 分程度有効な「一次セッション Cookie (`temp_session`)」を `HttpOnly` で発行。
2. `POST /auth/totp/verify`
   - 一次セッションを検証しつつ、TOTP 6 桁コードを検証。
   - 成功時に「本番セッション Cookie (`session`)」をセット。`SameSite=Lax`（フロントと同一オリジン運用の場合）または `SameSite=None`（別オリジンの SPA）で `Secure` を付与。
3. `GET /me`
   - 本番セッションを検証し、ユーザーの最小情報（id, username, roles, is_2fa_enabled など）を返却。
4. `POST /auth/logout`
   - `session` および `temp_session` Cookie を即時失効させる。

### セッション方式
- サーバー側セッションストア（Signed Cookie + DB/Redis バックエンド）または署名済み Cookie を採用。
- HTTPS を強制 (`Secure`)、`HttpOnly` を必須で付与。`SameSite=Lax` で CSRF を軽減。別オリジン SPA の場合は `SameSite=None; Secure` とし、CSRF 対策に Double Submit Cookie 方式を組み合わせる。
- Heroku ではリバースプロキシ配下となるため、`uvicorn --proxy-headers` および `ForwardedHeadersMiddleware`（または Starlette の `TrustedHostMiddleware` + `HTTPSRedirectMiddleware`）で `X-Forwarded-Proto` を評価。

### CSRF 対策
- SPA からの `fetch` では `credentials: 'include'` を指定。
- `SameSite=Lax` 運用時は基本的にフォーム POST 以外で CSRF されにくいが、強固にするなら Double Submit Cookie。
  - ログイン後、`csrf_token` Cookie（`SameSite=Lax`/`Secure`/非 HttpOnly）と API レスポンスにヘッダーまたは JSON で同じ値を返す。
  - クライアントは `X-CSRF-Token` ヘッダーで送信。サーバーは Cookie の値と照合。

---

## データベース設計

### users テーブル（差分）
```sql
ALTER TABLE users
    ADD COLUMN password_hash TEXT NOT NULL,
    ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN is_2fa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN last_login_at TIMESTAMPTZ;
```

### user_totp テーブル
```sql
CREATE TABLE user_totp (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    totp_secret TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);
```

### user_recovery_codes テーブル（任意）
```sql
CREATE TABLE user_recovery_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TIMESTAMPTZ
);
CREATE INDEX idx_user_recovery_codes_user ON user_recovery_codes(user_id);
```
- コードは 10 個生成し、`code_hash` に Argon2/Bcrypt を使用。
- 使用時は `used_at` を更新し再利用不可とする。

### Alembic Migration 例
`alembic revision -m "add totp"`
```python
from alembic import op
import sqlalchemy as sa

revision = "2024021501"
down_revision = "<prev_revision>"


def upgrade():
    op.add_column("users", sa.Column("password_hash", sa.Text(), nullable=False, server_default=""))
    op.add_column("users", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.sql.expression.true()))
    op.add_column("users", sa.Column("is_2fa_enabled", sa.Boolean(), nullable=False, server_default=sa.sql.expression.false()))
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True)))
    op.execute("UPDATE users SET password_hash = ''")
    op.alter_column("users", "password_hash", server_default=None)

    op.create_table(
        "user_totp",
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("totp_secret", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_used_at", sa.DateTime(timezone=True))
    )

    op.create_table(
        "user_recovery_codes",
        sa.Column("id", sa.UUID(), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code_hash", sa.Text(), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True))
    )
    op.create_index("ix_user_recovery_codes_user", "user_recovery_codes", ["user_id"])


def downgrade():
    op.drop_index("ix_user_recovery_codes_user", table_name="user_recovery_codes")
    op.drop_table("user_recovery_codes")
    op.drop_table("user_totp")
    op.drop_column("users", "last_login_at")
    op.drop_column("users", "is_2fa_enabled")
    op.drop_column("users", "is_active")
    op.drop_column("users", "password_hash")
```

---

## バックエンド実装スケッチ（FastAPI）

### 依存ライブラリ
```bash
pip install fastapi uvicorn passlib[argon2] pyotp python-multipart itsdangerous sqlalchemy psycopg[binary]
```

### パスワードハッシュ（Passlib + Argon2）
```python
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return pwd_context.verify(password, hashed)
```
- Argon2 パラメータ（例）: `time_cost=2`, `memory_cost=102400`, `parallelism=8`。Heroku の dyno リソースに合わせて調整。
- Bcrypt fallback: `schemes=["argon2", "bcrypt"]` とし、旧ハッシュからの移行を許容。

### TOTP 検証（pyotp）
```python
import pyotp
from datetime import datetime

TOTP_WINDOW = 1  # 前後 1 ステップ


def verify_totp(secret: str, code: str) -> bool:
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=TOTP_WINDOW)


def generate_otpauth_url(secret: str, username: str, issuer: str = "MyApp") -> str:
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=username, issuer_name=issuer)
```
- 管理者は `generate_otpauth_url` で得た URL を QR 化（`qrcode` ライブラリなど）してユーザーへ共有。

### 例: FastAPI Router
`/auth/login` は `username` / `password` を含む JSON ボディを必須とし、Pydantic モデル（例: `schemas.LoginRequest`）で受け付ける。
`Content-Type: application/json` を強制することで、React/pytest/cURL などのクライアント例と同じペイロード形式に揃える。
```python
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Response, Request
from sqlalchemy.orm import Session
from starlette import status

from . import models, schemas
from .dependencies import get_db, get_current_user_from_session, create_temp_session, create_session

router = APIRouter(prefix="/auth", tags=["auth"])

TEMP_SESSION_COOKIE = "temp_session"
SESSION_COOKIE = "session"
CSRF_COOKIE = "csrf_token"
COOKIE_COMMON = {
    "secure": True,
    "httponly": True,
    "samesite": "lax",  # 別オリジンなら "none"
}


@router.post("/login")
def login(data: schemas.LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = models.User.get_by_username(db, data.username)
    if not user or not user.is_active or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="認証に失敗しました")

    temp_token = create_temp_session(user.id)
    response.set_cookie(
        TEMP_SESSION_COOKIE,
        temp_token,
        max_age=300,
        **COOKIE_COMMON,
    )
    if user.is_2fa_enabled:
        return {"next": "totp"}
    # 2FA 無効ユーザーのためのフォールバック
    session_token = create_session(user.id)
    set_session_cookie(response, session_token)
    user.last_login_at = datetime.utcnow()
    db.commit()
    return {"next": "authenticated"}


def set_session_cookie(response: Response, token: str):
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=3600,
        **COOKIE_COMMON,
    )


@router.post("/totp/verify")
def verify_totp_endpoint(data: schemas.TOTPVerify, request: Request, response: Response, db: Session = Depends(get_db)):
    temp_token = request.cookies.get(TEMP_SESSION_COOKIE)
    if not temp_token:
        raise HTTPException(status_code=401, detail="認証に失敗しました")
    session_data = validate_temp_session(temp_token)
    user = models.User.get(db, session_data.user_id)
    if not user or not user.is_active or not user.is_2fa_enabled:
        raise HTTPException(status_code=401, detail="認証に失敗しました")

    totp_secret = models.UserTOTP.get_secret(db, user.id)
    if not totp_secret or not verify_totp(totp_secret, data.code):
        register_failed_attempt(user.id, request.client.host)
        raise HTTPException(status_code=401, detail="認証に失敗しました")

    register_successful_attempt(user.id, request.client.host)
    user.last_login_at = datetime.utcnow()
    db.commit()

    session_token = create_session(user.id)
    set_session_cookie(response, session_token)
    response.delete_cookie(TEMP_SESSION_COOKIE, path="/")

    csrf_token = issue_csrf_token()
    response.set_cookie(
        CSRF_COOKIE,
        csrf_token,
        max_age=3600,
        secure=True,
        httponly=False,
        samesite="lax"
    )
    return {"next": "authenticated"}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(TEMP_SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    return {"status": "ok"}


@router.get("/me")
def read_me(current_user: models.User = Depends(get_current_user_from_session)):
    return {
        "id": str(current_user.id),
        "username": current_user.username,
        "is_2fa_enabled": current_user.is_2fa_enabled,
    }
```

#### セッション管理補助（itsdangerous など）
```python
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from datetime import timedelta

serializer = URLSafeTimedSerializer(secret_key=SESSION_SIGN_KEY, salt="session")

def create_session(user_id: str) -> str:
    return serializer.dumps({"user_id": user_id})


def validate_session(token: str, max_age: int = 3600):
    try:
        data = serializer.loads(token, max_age=max_age)
        return data
    except (BadSignature, SignatureExpired):
        raise HTTPException(status_code=401, detail="認証に失敗しました")
```
- Redis などを使う場合は Token をキーにユーザー ID を紐づけて TTL を制御。

#### レート制限・ロック例
```python
from collections import defaultdict
from datetime import datetime, timedelta

FAILED_ATTEMPTS = defaultdict(list)  # 実運用では Redis 等を使用
LOCK_DURATION = timedelta(minutes=5)
MAX_ATTEMPTS = 5


def register_failed_attempt(user_id: str, ip: str):
    key = (user_id, ip)
    FAILED_ATTEMPTS[key].append(datetime.utcnow())


def is_locked(user_id: str, ip: str) -> bool:
    key = (user_id, ip)
    now = datetime.utcnow()
    recent = [t for t in FAILED_ATTEMPTS[key] if now - t < LOCK_DURATION]
    FAILED_ATTEMPTS[key] = recent
    return len(recent) >= MAX_ATTEMPTS
```
- ログには `username`, `ip`, `結果` のみ記録。パスワード/TOTP は記録しない。

### ミドルウェアと設定
```python
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.httpsredirect import HTTPSRedirectMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://frontend.example.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(TrustedHostMiddleware, allowed_hosts=["myapp.herokuapp.com", "localhost", "127.0.0.1"])
app.add_middleware(HTTPSRedirectMiddleware)
```
- Heroku では `uvicorn main:app --host=0.0.0.0 --port=${PORT} --proxy-headers`。
- HSTS や CSP をレスポンスヘッダーで設定：
```python
@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
    response.headers.setdefault("Content-Security-Policy", "default-src 'self'")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    return response
```

---

## React SPA 側の最小改造

```tsx
// src/api/auth.ts
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export async function login(username: string, password: string) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error("認証に失敗しました");
  return res.json();
}

export async function verifyTotp(code: string) {
  const res = await fetch(`${BASE_URL}/auth/totp/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": getCsrfTokenFromCookie(),
    },
    credentials: "include",
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error("認証に失敗しました");
  return res.json();
}

export async function fetchMe() {
  const res = await fetch(`${BASE_URL}/me`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("セッションが無効です");
  return res.json();
}
```
- `useEffect` で初期マウント時に `fetchMe()` を呼びログイン状態を復元。
- 画面遷移：
  1. ログインフォーム (`username/password`) → 成功すると `next` 値が `"totp"` なら TOTP 画面へ。
  2. TOTP 入力画面 → 成功でダッシュボードへ。
- エラーメッセージは共通文言に統一。

---

## Heroku 固有設定

### Procfile
```
web: uvicorn app.main:app --host=0.0.0.0 --port=${PORT} --proxy-headers
```
- ワーカー並列が必要なら `gunicorn` を利用：`web: gunicorn app.main:app -k uvicorn.workers.UvicornWorker --forwarded-allow-ips='*'`。

### Config Vars
- `DATABASE_URL`
- `SECRET_KEY`（Flask/itsdangerous 用）
- `SESSION_SIGN_KEY`
- `CSRF_SECRET`
- `ARGON2_MEMORY_COST` などのパラメータ（必要に応じて）
- `ALLOWED_ORIGINS`

### Dyno メモ
- Cookie セッション方式であれば Dyno のスケール/再起動でセッションが失われない。
- Procfile の `--proxy-headers` を忘れると HTTPS 判定に失敗し、`Secure` Cookie が送信されない。

---

## テスト & cURL 例

### cURL シナリオ
```bash
# Step1: login
curl -i -c cookies.txt -X POST https://api.example.com/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"password"}'

# Step2: totp verify
curl -i -b cookies.txt -c cookies.txt -X POST https://api.example.com/auth/totp/verify \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: $(awk '/csrf_token/ {print $7}' cookies.txt)" \
  -d '{"code":"123456"}'

# Get current user
curl -b cookies.txt https://api.example.com/me

# Logout
curl -i -b cookies.txt -X POST https://api.example.com/auth/logout
```

`curl` の `-c` オプションで生成される Netscape 形式の Cookie ジャーでは 7 列目に Cookie 値が入るため、`awk '/csrf_token/ {print $7}' cookies.txt` で `csrf_token` の値を抽出し、その結果をコマンド置換で `X-CSRF-Token` ヘッダーに渡している。

### pytest 最小例
```python
from httpx import AsyncClient

async def test_login_and_totp(async_client: AsyncClient, user_factory):
    user = await user_factory(password="password", totp_secret="JBSWY3DPEHPK3PXP")

    res = await async_client.post("/auth/login", json={"username": user.username, "password": "password"})
    assert res.status_code == 200
    assert res.cookies.get("temp_session")

    res = await async_client.post("/auth/totp/verify", json={"code": pyotp.TOTP(user.totp_secret).now()})
    assert res.status_code == 200
    assert res.cookies.get("session")

    res = await async_client.get("/me")
    assert res.status_code == 200
    assert res.json()["username"] == user.username
```
- テストでは `AsyncClient` の `cookies` を共有し、`credentials` の挙動を再現。

---

## よくある落とし穴と対策
- **Secure Cookie 未送信**: `SameSite=None` の場合は必ず `Secure` を付与。Heroku の HTTP アクセスを HTTPS にリダイレクト。
- **X-Forwarded-Proto 未対応**: `--proxy-headers` を忘れると `request.url.scheme` が `http` のままになり、`Secure` Cookie がブロック。
- **CORS + credentials**: `allow_origins` にワイルドカード `*` を使うと `allow_credentials=True` と併用できない。明示的なオリジンを列挙。
- **CSRF トークン未送信**: 別オリジン SPA で `SameSite=None` の場合は Double Submit Cookie を必須に。
- **TOTP 時刻ズレ**: サーバーの時刻同期（NTP）を確認。`valid_window=1` で前後 30 秒を許容。
- **レート制限未実装**: 最低でもユーザー＋IP 単位で 5 回連続失敗で 5 分ロック。

---

## JWT ベース代替案（参考）

### 差分ポイント
- Step1 で返すのは短命な一次 `temp_token`（JWT）。
- Step2 で `access_token`（JWT, 5 分）と `refresh_token`（HttpOnly Cookie, 14 日）を発行。
- React は `Authorization: Bearer` で `access_token` を送信。更新は `/auth/refresh` で Cookie の `refresh_token` を送信。

```python
from jose import jwt

ACCESS_EXPIRE = timedelta(minutes=5)
REFRESH_EXPIRE = timedelta(days=14)


def create_access_token(data: dict):
    return jwt.encode({"exp": datetime.utcnow() + ACCESS_EXPIRE, **data}, SECRET_KEY, algorithm="HS256")


def create_refresh_token(data: dict):
    return jwt.encode({"exp": datetime.utcnow() + REFRESH_EXPIRE, **data}, REFRESH_SECRET, algorithm="HS256")
```
- Cookie は `refresh_token` のみ `HttpOnly`。`access_token` はメモリ保持。
- CSRF 対策は `refresh_token` の発行時に Double Submit Cookie を併用。
- セッション方式との差分は主に「サーバー側セッションストア不要」「アクセストークンのローテーション管理が必要」点。

---

## 参考コマンド
- Alembic 生成: `alembic revision --autogenerate -m "add totp"`
- マイグレーション適用: `alembic upgrade head`
- React dev server 起動: `npm run dev -- --host`
- FastAPI ローカル起動: `uvicorn app.main:app --reload`

---

## まとめ
- 二段階の Cookie セッションで 2FA を構築し、Heroku のプロキシ環境を意識した HTTPS 判定と `Secure` Cookie 設定を必ず行う。
- DB には Argon2 ハッシュ済みパスワードと TOTP シークレット、任意でリカバリーコードを保存。
- React SPA は `credentials: 'include'` と最小 UI 変更で対応可能。CSRF 対策の組み合わせに注意。
- pytest/cURL 例とレート制限テンプレートを活用して実装を検証する。
