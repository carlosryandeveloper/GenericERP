import os

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
# CORS (Front 5173 -> API 8000)
# =========================

ALLOWED_ORIGINS = [
    # Local
    "http://localhost:5173",
    "http://127.0.0.1:5173",

    # (opcional) se você usa Live Server
    "http://localhost:5500",
    "http://127.0.0.1:5500",
]

# Codespaces: normalmente vem algo como:
# https://<CODESPACE_NAME>-5173.app.github.dev
codespace_name = os.getenv("CODESPACE_NAME")
if codespace_name:
    ALLOWED_ORIGINS.append(f"https://{codespace_name}-5173.app.github.dev")

# Regex para cobrir variações de Codespaces sem ficar trocando a cada workspace
CODESPACES_ORIGIN_REGEX = r"^https://.*-5173\.app\.github\.dev$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=CODESPACES_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
