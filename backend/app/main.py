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
# CORS (Front -> API)
# =========================
ALLOWED_ORIGINS = [
    # Local (http.server 5173 / Live Server 5500)
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
]

# Codespaces (às vezes existe essa env, às vezes não)
codespace_name = os.getenv("CODESPACE_NAME")
if codespace_name:
    ALLOWED_ORIGINS.append(f"https://{codespace_name}-5173.app.github.dev")
    ALLOWED_ORIGINS.append(f"https://{codespace_name}-5500.app.github.dev")

# Regex para cobrir qualquer Codespaces:
# Ex.: https://legendary-parakeet-xxxx-5173.app.github.dev
CODESPACES_ORIGIN_REGEX = r"^https://.*-(5173|5500)\.app\.github\.dev$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=CODESPACES_ORIGIN_REGEX,
    allow_credentials=False,  # <- importante (você usa Authorization Bearer, não cookie)
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# Startup / DB
# =========================
@app.on_event("startup")
def on_startup():
    SQLModel.metadata.create_all(engine)

# =========================
# Health / Debug
# =========================
@app.get("/health")
def health():
    return {"status": "ok", "service": "GenericERP API", "version": "0.4.0"}

@app.get("/debug/routes")
def debug_routes():
    return sorted({getattr(r, "path", "") for r in app.routes})

# =========================
# Routers
# =========================
app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(catalog_router, tags=["catalog"])
app.include_router(quotes_router, tags=["quotes"])
app.include_router(stock_router, tags=["stock"])
