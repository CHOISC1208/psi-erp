# PSI Mini ERP

A minimal GEN-like PSI (Production, Sales, Inventory) ERP prototype built with FastAPI, SQLAlchemy, Alembic and a Vite + React SPA. The backend speaks PostgreSQL (schema `psi` by default) and now ships with a hardened username/password login that issues signed session cookies suitable for Heroku deployments.

## What's inside

- Username/password authentication (`/auth/login`) with Argon2 hashes, signed session cookies and optional double submit CSRF protection.
- `GET /auth/me` + `POST /auth/logout` endpoints and a React login form that persists authentication state via `credentials: 'include'` requests.
- Session CRUD with leader designation, PSI table editing APIs and master data endpoints.
- React + Vite + TypeScript frontend using axios and React Query.
- Alembic migrations living under `backend/alembic/versions`.

## Prerequisites

- Python 3.12+
- Node.js 20+
- PostgreSQL 14+ (local or hosted — e.g. Heroku Postgres)

## Quick start (local development)

1. **Clone env vars**

   Copy the sample environment file and adjust values as required.

   ```bash
   cp .env.example .env
   ```

   The most important variables are:

   | Variable | Purpose |
   | --- | --- |
   | `DATABASE_URL` | PostgreSQL connection string (SQLAlchemy compatible). |
   | `DB_SCHEMA` | Database schema (defaults to `psi`). |
   | `SESSION_SIGN_KEY` / `SECRET_KEY` | Random strings used to sign session payloads. |
   | `ALLOWED_ORIGINS` | Comma separated list of front-end origins (e.g. `http://localhost:5173,http://localhost:5174`). |

   > 📡 When you access the frontend from another device on your LAN, you **must** include that device's Vite origin in
   > `ALLOWED_ORIGINS` (for example: `http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174,http://192.168.11.64:5174`).
   > Otherwise, cross-origin cookies and authentication requests will be blocked by the browser.
   | `SESSION_COOKIE_SECURE` | Defaults to `false` locally. Set to `true` only when serving over HTTPS. |

2. **Install backend dependencies**

   ```bash
   cd backend
   python -m venv .venv
   source .venv/bin/activate  # Windows: .venv\Scripts\activate
   pip install -r app/requirements.txt
   ```

3. **Run database migrations**

   ```bash
   alembic upgrade head
   ```

4. **Create an initial user (no UI)**

   ```sql
   INSERT INTO psi.users (username, password_hash)
    VALUES (
      'admin',
      'pbkdf2_sha256$390000$xLZMCnQn7qjW030LISFGMw$wmdKegibCSwbuMOl6MQ8UhqKEMUqwdSzLdePUgVveNQ'
    );
   ```

   > ℹ️ The hash above corresponds to the password `changeme!`. Generate fresh hashes with:
   > ```bash
   > python - <<'PY'
   > from backend.app.security import hash_password
   > print(hash_password("your-secret"))
   > PY
   > ```
   > The fallback implementation uses PBKDF2-SHA256 when optional dependencies
   > aren't installed, so the command works even in lightweight development
   > environments.
   > (Refer to `docs/totp-auth-guide.md` for additional operational guidance.)

5. **Start the FastAPI app**

   ```bash
   uvicorn app.main:app --reload
   ```

6. **Install and run the frontend**

   ```bash
   cd ../frontend
   npm install
   npm run dev
   ```

   The Vite dev server runs on <http://localhost:5173>. If you open a second instance (e.g. Vite preview) it usually listens on <http://localhost:5174>. Ensure both origins are present in `ALLOWED_ORIGINS` so that cookies can be shared when using `credentials: 'include'`. When exposing the dev server over your LAN (e.g. <http://192.168.11.64:5174>), append that host to `ALLOWED_ORIGINS` as well.

## Authentication API quick check

1. **Login**

   ```bash
   curl -i -X POST http://localhost:8000/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"changeme!"}'
   ```

   A `Set-Cookie: session=...; HttpOnly; Path=/; SameSite=Lax` header is returned on success.

2. **Fetch the profile**

   ```bash
   curl -i http://localhost:8000/auth/me \
     --cookie "session=<value from login>"
   ```

3. **Logout**

   ```bash
   curl -i -X POST http://localhost:8000/auth/logout \
     --cookie "session=<value from login>"
   ```

## Running automated tests

```bash
pytest backend/tests/test_auth.py
```

The suite provisions a throwaway SQLite database and covers happy-path login + `/auth/me`, logout behaviour and rate limiting after repeated failures.

## Heroku deployment notes

- Use the provided `Procfile` which starts Uvicorn with `--proxy-headers` so secure cookies respect `X-Forwarded-Proto`.
- Set the following config vars:

  | Config Var | Example |
  | --- | --- |
  | `DATABASE_URL` | Provided by Heroku Postgres |
  | `DB_SCHEMA` | `psi` |
  | `SESSION_SIGN_KEY` / `SECRET_KEY` | Long random strings (`heroku config:set SESSION_SIGN_KEY=$(openssl rand -hex 32)`). |
  | `ALLOWED_ORIGINS` | `https://<your-app>.herokuapp.com` (and any custom domains). |
  | `SESSION_COOKIE_SECURE` | `true` (default) |

- Deploy the frontend build artefacts (`frontend/dist`) to `backend/static` (or configure a CDN) so the SPA is served alongside the API.
- Apply database migrations on release: `heroku run alembic upgrade head` (already wired via the `release` process type).

## CSV format reminder

Upload UTF-8 CSV files with headers:

```
date,production,sales,inventory
2024-01-01,100,80,150
```

`inventory` is optional. When present it is returned as `reported_inventory`; projected inventory is calculated from the running net change and the optional `starting_inventory` query parameter.
