# PSI Mini ERP

A minimal GEN-like PSI (Production, Sales, Inventory) mini-ERP built with FastAPI, SQLAlchemy, Alembic, and a Vite + React frontend. The backend is compatible with PostgreSQL both locally and on Heroku (using `psycopg2-binary`).

## Features

- Session CRUD with leader designation.
- CSV import for daily PSI data (`date, production, sales, inventory`).
- Aggregated daily PSI calculations with projected inventory.
- React + Vite + TypeScript frontend using axios and React Query.

## Prerequisites

- Python 3.12
- Node.js 20+
- PostgreSQL database (local or hosted, e.g. Heroku Postgres)

## Backend setup

Create a virtual environment and install dependencies:

```bash
cd backend
python -m venv .venv
. .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r app/requirements.txt
```

Set environment variables (or use a `.env` file):

```env
DATABASE_URL=postgresql://user:password@localhost:5432/psi
DB_SCHEMA=public
```

Normalize `DATABASE_URL` is automatic; `postgres://` URLs are converted to `postgresql+psycopg2://` with `sslmode=require` for Heroku compatibility.

Run migrations:

```bash
cd backend
alembic upgrade head
```

Start the API:

```bash
uvicorn app.main:app --reload
```

## Frontend setup

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server runs on http://localhost:5173. Configure the backend URL with `VITE_API_BASE_URL` (or the legacy `VITE_API_BASE`) if needed.

## CSV format

Upload UTF-8 CSV files with headers:

```
date,production,sales,inventory
2024-01-01,100,80,150
```

`inventory` is optional. When present it is returned as `reported_inventory`; projected inventory is calculated from the running net change and the optional `starting_inventory` query parameter.

## Running on Heroku

- Set `DATABASE_URL` and optional `DB_SCHEMA` config vars.
- Use `Procfile` entries such as `web: uvicorn app.main:app --host=0.0.0.0 --port=${PORT}`.
- Alembic migrations can be executed with `heroku run alembic upgrade head`.


## 起動

cd .\backend\
uvicorn app.main:app --reload

npm i
npm run dev