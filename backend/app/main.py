# backend/app/main.py
"""FastAPI application entry-point."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse

from .routers import masters, psi, sessions

app = FastAPI(title="GEN-like PSI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- API 既存パスを維持 ---
app.include_router(sessions.router, prefix="/sessions", tags=["sessions"])
app.include_router(masters.router,  prefix="/masters",  tags=["masters"])
app.include_router(psi.router,      prefix="/psi",      tags=["psi"])

# --- 互換: /api 配下でも同じAPIを提供（フロントの設定差異に対応）---
app.include_router(sessions.router, prefix="/api/sessions", tags=["sessions"])
app.include_router(masters.router,  prefix="/api/masters",  tags=["masters"])
app.include_router(psi.router,      prefix="/api/psi",      tags=["psi"])

@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}

# ====== フロント（Viteビルド）を配信 ======
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

# /assets（Viteの静的）を配信
if (STATIC_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

# favicon
@app.get("/favicon.ico")
def favicon():
    f = STATIC_DIR / "favicon.ico"
    if f.exists():
        return FileResponse(f)
    return HTMLResponse(status_code=404)

# ルートとSPAフォールバック
def _index_html() -> str:
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return index_file.read_text(encoding="utf-8")
    return "<h1>Build not found</h1><p>frontend/dist → backend/static に配置してください。</p>"

@app.get("/", response_class=HTMLResponse)
def index():
    return _index_html()

@app.get("/{full_path:path}", response_class=HTMLResponse)
def spa_fallback(full_path: str):
    # 既存のAPI/静的にマッチしない全てのパスは SPA へ
    return _index_html()
