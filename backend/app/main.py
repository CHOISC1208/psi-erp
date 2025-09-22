# backend/app/main.py
"""FastAPI application entry-point."""
from __future__ import annotations

from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, PlainTextResponse

from .config import settings
from .routers import channel_transfers, masters, psi, sessions

app = FastAPI(title="GEN-like PSI API")

cors_kwargs: dict[str, object] = {
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}

configured_origins = [origin for origin in settings.cors_allow_origins if origin]

if configured_origins and "*" not in configured_origins:
    cors_kwargs["allow_origins"] = configured_origins
    cors_kwargs["allow_credentials"] = True
elif settings.cors_allow_origin_regex:
    cors_kwargs["allow_origin_regex"] = settings.cors_allow_origin_regex
    cors_kwargs["allow_credentials"] = False
else:
    cors_kwargs["allow_origins"] = configured_origins if "*" not in configured_origins else ["*"]
    cors_kwargs["allow_credentials"] = False

app.add_middleware(CORSMiddleware, **cors_kwargs)

# ========= 1) API を最初に登録 =========
# 既存の互換エンドポイント
app.include_router(sessions.router, prefix="/sessions", tags=["sessions"])
app.include_router(masters.router,  prefix="/masters",  tags=["masters"])
app.include_router(psi.router,      prefix="/psi",      tags=["psi"])
app.include_router(
    channel_transfers.router,
    prefix="/channel-transfers",
    tags=["channel-transfers"],
)

# /api 配下にもミラー（フロントが /api/* を叩いてもOKに）
app.include_router(sessions.router, prefix="/api/sessions", tags=["sessions"])
app.include_router(masters.router,  prefix="/api/masters",  tags=["masters"])
app.include_router(psi.router,      prefix="/api/psi",      tags=["psi"])
app.include_router(
    channel_transfers.router,
    prefix="/api/channel-transfers",
    tags=["channel-transfers"],
)

@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}

# ========= 2) 静的配信 =========
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if (STATIC_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

@app.get("/favicon.ico")
def favicon():
    f = STATIC_DIR / "favicon.ico"
    if f.exists():
        return FileResponse(f)
    return HTMLResponse(status_code=404)

def _index_html() -> str:
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return index_file.read_text(encoding="utf-8")
    return "<h1>Build not found</h1><p>frontend/dist → backend/static に配置してください。</p>"

# ルート
@app.get("/", response_class=HTMLResponse)
def index():
    return _index_html()

# ========= 3) SPA フォールバック（最後に置く & APIは除外） =========
API_PREFIXES = (
    "api/",
    "sessions",
    "masters",
    "psi",
    "channel-transfers",
    "health",
    "assets",
    "favicon.ico",
)

@app.get("/{full_path:path}", response_class=HTMLResponse, include_in_schema=False)
def spa_fallback(full_path: str, request: Request):
    # API っぽいパスはフォールバックしない（= 404 を返してAPI側に任せる）
    # ここで 404 を返すと、上で定義した API / 静的 ルートが優先される
    for p in API_PREFIXES:
        if full_path.startswith(p):
            return PlainTextResponse("Not Found", status_code=404)
    return _index_html()
