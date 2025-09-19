from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="GEN-like PSI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

# ここを追加
from .routers import sessions
app.include_router(sessions.router, prefix="/sessions", tags=["sessions"])

@app.get("/health")
def health():
    return {"ok": True}
