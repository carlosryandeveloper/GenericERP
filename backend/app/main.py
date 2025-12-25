from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import SQLModel

from .db import engine
from . import models  # noqa: F401

from .auth_routes import router as auth_router
from .catalog_routes import router as catalog_router
from .quotes_routes import router as quotes_router
from .stock_routes import router as stock_router

app = FastAPI(title="GenericERP API", version="0.4.0")

# CORS: libera qualquer origin do Codespaces (porta 5173) + local
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ],
    allow_origin_regex=r"^https://.*-5173\.app\.github\.dev$",
    allow_credentials=False,  # <- Bearer token no header, não cookie
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
