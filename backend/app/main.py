"""FastAPI application entry-point."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import psi, sessions

app = FastAPI(title="GEN-like PSI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router, prefix="/sessions", tags=["sessions"])
app.include_router(psi.router, prefix="/psi", tags=["psi"])


@app.get("/health")
def health() -> dict[str, bool]:
    """Health-check endpoint used for liveness probes."""

    return {"ok": True}
