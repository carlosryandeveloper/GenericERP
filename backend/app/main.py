from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import SQLModel

from .db import engine

# IMPORTA MODELS pra SQLModel.metadata enxergar todas as tabelas
from . import models  # noqa: F401

from .auth_routes import router as auth_router
from .catalog_routes import router as catalog_router
from .quotes_routes import router as quotes_router
from .stock_routes import router as stock_router


app = FastAPI(title="GenericERP API", version="0.4.0")

# =========================
# CORS (DEV) - libera geral
# =========================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],       # dev: libera qualquer origem
    allow_credentials=False,   # IMPORTANTÍSSIMO: não pode "*" com credentials=True
    allow_methods=["*"],
    allow_headers=["*"],       # Content-Type, Authorization, etc.
)

@app.on_event("startup")
def on_startup():
    SQLModel.metadata.create_all(engine)

@app.get("/health")
def health():
    return {"status": "ok", "service": "GenericERP API", "version": "0.4.0"}

@app.get("/debug/routes")
def debug_routes():
    return sorted({getattr(r, "path", "") for r in app.routes})

app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(catalog_router, tags=["catalog"])
app.include_router(quotes_router, tags=["quotes"])
app.include_router(stock_router, tags=["stock"])
