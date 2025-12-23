from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import SQLModel, Session, select
from sqlalchemy import func, case

from .db import engine, get_session
from .models import User, Product, StockMovement
from .auth import (
    get_current_user,
    hash_password,
    verify_password,
    create_access_token,
    create_reset_token,
    consume_reset_token,
)


# =========================
# Response models (SQLModel)
# =========================
class UserOut(SQLModel):
    id: int
    email: str
    created_at: datetime


class RegisterIn(SQLModel):
    email: str
    password: str


class LoginIn(SQLModel):
    email: str
    password: str


class TokenOut(SQLModel):
    access_token: str
    token_type: str = "bearer"


class ForgotIn(SQLModel):
    email: str


class ResetIn(SQLModel):
    token: str
    new_password: str


class ProductMin(SQLModel):
    id: int
    name: str
    unit: str


class StockBalance(SQLModel):
    product_id: int
    name: str
    unit: str
    balance: float


class StockStatementLine(SQLModel):
    id: int
    created_at: datetime
    type: str
    quantity: float
    signed_quantity: float
    note: str | None = None
    balance_after: float


class StockStatement(SQLModel):
    product_id: int
    from_date: date | None = None
    to_date: date | None = None
    starting_balance: float
    ending_balance: float
    lines: list[StockStatementLine]


app = FastAPI(title="GenericERP API", version="0.2.0")

# CORS liberado (DEV)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    SQLModel.metadata.create_all(engine)
cat > backend/app/main.py <<'PY'
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from fastapi import FastAPI, Depends, HTTPException
from sqlmodel import SQLModel, Session, select
from sqlalchemy import func, case

from .db import engine, get_session

# IMPORTANTE:
# Importar TODOS os models aqui garante que o create_all()
# enxergue as tabelas e crie no SQLite.
from .models import Product, StockMovement, User, PasswordReset  # <-- AQUI É A CORREÇÃO

# Se você tiver um router de auth separado, descomenta:
# from .routes_auth import router as auth_router

# Se suas rotas de auth estão em app/auth_routes.py (exemplo):
# from .auth_routes import router as auth_router


class StockBalance(SQLModel):
    product_id: int
    sku: str
    name: str
    balance: float


class StockStatementLine(SQLModel):
    id: int
    created_at: datetime
    type: str
    quantity: float
    signed_quantity: float
    note: str | None = None
    balance_after: float


class StockStatement(SQLModel):
    product_id: int
    from_date: date | None = None
    to_date: date | None = None
    starting_balance: float
    ending_balance: float
    lines: list[StockStatementLine]


app = FastAPI(title="GenericERP API", version="0.2.0")


@app.on_event("startup")
def on_startup():
    # Esse create_all só cria tabela de models que foram importados.
    SQLModel.metadata.create_all(engine)


@app.get("/health")
def health():
    return {"status": "ok", "service": "GenericERP API", "version": "0.2.0"}


@app.get("/debug/routes")
def debug_routes():
    return sorted({getattr(r, "path", "") for r in app.routes})


# -----------------------
# PRODUCTS
# -----------------------
@app.post("/products", response_model=Product)
def create_product(product: Product, session: Session = Depends(get_session)):
    existing = session.exec(select(Product).where(Product.sku == product.sku)).first()
    if existing:
        raise HTTPException(status_code=409, detail="sku already exists")

    session.add(product)
    session.commit()
    session.refresh(product)
    return product


@app.get("/products", response_model=list[Product])
def list_products(session: Session = Depends(get_session)):
    return session.exec(select(Product).order_by(Product.id.desc())).all()


@app.get("/products/min")
def products_min(session: Session = Depends(get_session)):
    # retorno mínimo pro front: id, name, unit
    rows = session.exec(select(Product.id, Product.name, Product.unit).order_by(Product.id.asc())).all()
    return [{"id": r[0], "name": r[1], "unit": r[2]} for r in rows]


# -----------------------
# MOVEMENTS
# -----------------------
@app.post("/stock/movements", response_model=StockMovement)
def create_movement(mv: StockMovement, session: Session = Depends(get_session)):
    if mv.quantity <= 0:
        raise HTTPException(status_code=400, detail="quantity must be > 0")
    session.add(mv)
    session.commit()
    session.refresh(mv)
    return mv


@app.get("/stock/movements", response_model=list[StockMovement])
def list_movements(session: Session = Depends(get_session)):
    return session.exec(select(StockMovement).order_by(StockMovement.id.desc())).all()


# -----------------------
# BALANCE
# -----------------------
@app.get("/stock/balance", response_model=list[StockBalance])
def stock_balance(session: Session = Depends(get_session)):
    signed_qty = case(
        (StockMovement.type.in_(["IN", "ADJUST"]), StockMovement.quantity),
        (StockMovement.type == "OUT", -StockMovement.quantity),
        else_=0,
    )

    stmt = (
        select(
            Product.id.label("product_id"),
            Product.sku,
            Product.name,
            func.coalesce(func.sum(signed_qty), 0).label("balance"),
        )
        .outerjoin(StockMovement, StockMovement.product_id == Product.id)
        .group_by(Product.id, Product.sku, Product.name)
        .order_by(Product.id)
    )

    rows = session.exec(stmt).all()
    return [StockBalance(**dict(r._mapping)) for r in rows]


@app.get("/stock/balance/{product_id}", response_model=StockBalance)
def stock_balance_by_product(product_id: int, session: Session = Depends(get_session)):
    signed_qty = case(
        (StockMovement.type.in_(["IN", "ADJUST"]), StockMovement.quantity),
        (StockMovement.type == "OUT", -StockMovement.quantity),
        else_=0,
    )

    stmt = (
        select(
            Product.id.label("product_id"),
            Product.sku,
            Product.name,
            func.coalesce(func.sum(signed_qty), 0).label("balance"),
        )
        .outerjoin(StockMovement, StockMovement.product_id == Product.id)
        .where(Product.id == product_id)
        .group_by(Product.id, Product.sku, Product.name)
    )

    row = session.exec(stmt).first()
    if not row:
        raise HTTPException(status_code=404, detail="product not found")

    return StockBalance(**dict(row._mapping))


# -----------------------
# STATEMENT
# -----------------------
@app.get("/stock/statement", response_model=StockStatement)
def stock_statement(
    product_id: int,
    from_date: date | None = None,
    to_date: date | None = None,
    session: Session = Depends(get_session),
):
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="product not found")

    start_dt = datetime.combine(from_date, time.min) if from_date else None
    end_dt = datetime.combine(to_date + timedelta(days=1), time.min) if to_date else None

    signed_qty_expr = case(
        (StockMovement.type.in_(["IN", "ADJUST"]), StockMovement.quantity),
        (StockMovement.type == "OUT", -StockMovement.quantity),
        else_=0,
    )

    stmt_start = select(func.coalesce(func.sum(signed_qty_expr), 0)).where(
        StockMovement.product_id == product_id
    )
    if start_dt:
        stmt_start = stmt_start.where(StockMovement.created_at < start_dt)

    starting_balance = float(session.exec(stmt_start).one())

    stmt = select(StockMovement).where(StockMovement.product_id == product_id)
    if start_dt:
        stmt = stmt.where(StockMovement.created_at >= start_dt)
    if end_dt:
        stmt = stmt.where(StockMovement.created_at < end_dt)

    stmt = stmt.order_by(StockMovement.created_at.asc(), StockMovement.id.asc())
    movements = session.exec(stmt).all()

    balance = starting_balance
    lines: list[StockStatementLine] = []

    for mv in movements:
        if mv.type in ("IN", "ADJUST"):
            signed = float(mv.quantity)
        elif mv.type == "OUT":
            signed = -float(mv.quantity)
        else:
            signed = 0.0

        balance += signed

        lines.append(
            StockStatementLine(
                id=mv.id,
                created_at=mv.created_at,
                type=mv.type,
                quantity=float(mv.quantity),
                signed_quantity=signed,
                note=getattr(mv, "note", None),
                balance_after=balance,
            )
        )

    return StockStatement(
        product_id=product_id,
        from_date=from_date,
        to_date=to_date,
        starting_balance=starting_balance,
        ending_balance=balance,
        lines=lines,
    )


# -----------------------
# AUTH ROUTER (se existir)
# -----------------------
# Se você tem arquivo de rotas de auth separado, inclua aqui:
# app.include_router(auth_router, prefix="/auth", tags=["auth"])
PY


@app.get("/health")
def health():
    return {"status": "ok", "service": "GenericERP API", "version": "0.2.0"}


@app.get("/debug/routes")
def debug_routes():
    return sorted({getattr(r, "path", "") for r in app.routes})


# ===========
# AUTH
# ===========
@app.post("/auth/register", response_model=UserOut)
def register(payload: RegisterIn, session: Session = Depends(get_session)):
    email = (payload.email or "").strip().lower()
    password = payload.password or ""

    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="invalid email")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="password must be >= 6 chars")

    existing = session.exec(select(User).where(User.email == email)).first()
    if existing:
        raise HTTPException(status_code=409, detail="email already exists")

    user = User(email=email, password_hash=hash_password(password))
    session.add(user)
    session.commit()
    session.refresh(user)

    return UserOut(id=user.id, email=user.email, created_at=user.created_at)


@app.post("/auth/login", response_model=TokenOut)
def login(payload: LoginIn, session: Session = Depends(get_session)):
    email = (payload.email or "").strip().lower()
    password = payload.password or ""

    user = session.exec(select(User).where(User.email == email)).first()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="invalid credentials")

    token = create_access_token(user.id)
    return TokenOut(access_token=token)


@app.get("/auth/me", response_model=UserOut)
def me(current: User = Depends(get_current_user)):
    return UserOut(id=current.id, email=current.email, created_at=current.created_at)


@app.post("/auth/forgot-password")
def forgot_password(payload: ForgotIn, session: Session = Depends(get_session)):
    email = (payload.email or "").strip().lower()

    # sempre responde "ok" pra não expor se existe ou não
    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        return {"ok": True, "message": "if the email exists, a token was generated"}

    token = create_reset_token(session, user, minutes_valid=30)

    # DEV: retornando token no response (em prod você envia por email)
    return {
        "ok": True,
        "message": "token generated (DEV). use /auth/reset-password",
        "token": token,
        "expires_minutes": 30,
    }


@app.post("/auth/reset-password")
def reset_password(payload: ResetIn, session: Session = Depends(get_session)):
    new_password = payload.new_password or ""
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="password must be >= 6 chars")

    user = consume_reset_token(session, payload.token)
    user.password_hash = hash_password(new_password)
    session.add(user)
    session.commit()
    return {"ok": True}


# ===========
# PRODUCTS (protected)
# ===========
@app.post("/products", response_model=Product)
def create_product(
    product: Product,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    # força dono
    product.user_id = current.id

    # regra: SKU único POR USUÁRIO
    existing = session.exec(
        select(Product).where(Product.user_id == current.id, Product.sku == product.sku)
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="sku already exists")

    session.add(product)
    session.commit()
    session.refresh(product)
    return product


@app.get("/products", response_model=list[Product])
def list_products(
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    return session.exec(
        select(Product)
        .where(Product.user_id == current.id)
        .order_by(Product.id.desc())
    ).all()


@app.get("/products/min", response_model=list[ProductMin])
def list_products_min(
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    rows = session.exec(
        select(Product.id, Product.name, Product.unit)
        .where(Product.user_id == current.id)
        .order_by(Product.name.asc())
    ).all()

    # rows vem como tuplas
    return [ProductMin(id=r[0], name=r[1], unit=r[2]) for r in rows]


# ===========
# STOCK MOVEMENTS (protected)
# ===========
def _signed_expr():
    return case(
        (StockMovement.type.in_(["IN", "ADJUST"]), StockMovement.quantity),
        (StockMovement.type == "OUT", -StockMovement.quantity),
        else_=0,
    )


def _current_balance(session: Session, user_id: int, product_id: int) -> float:
    signed_qty = _signed_expr()
    stmt = (
        select(func.coalesce(func.sum(signed_qty), 0))
        .where(StockMovement.user_id == user_id)
        .where(StockMovement.product_id == product_id)
    )
    return float(session.exec(stmt).one())


@app.post("/stock/movements", response_model=StockMovement)
def create_movement(
    mv: StockMovement,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    if mv.quantity <= 0:
        raise HTTPException(status_code=400, detail="quantity must be > 0")

    mv.type = (mv.type or "").strip().upper()

    if mv.type not in ("IN", "OUT", "ADJUST"):
        raise HTTPException(status_code=400, detail="type must be IN/OUT/ADJUST")

    if mv.type == "ADJUST" and not (mv.note or "").strip():
        raise HTTPException(status_code=400, detail="ADJUST requires note")

    # valida produto do usuário
    product = session.get(Product, mv.product_id)
    if not product or product.user_id != current.id:
        raise HTTPException(status_code=404, detail="product not found")

    # regra: OUT não pode deixar saldo negativo
    if mv.type == "OUT":
        bal = _current_balance(session, current.id, mv.product_id)
        if (bal - float(mv.quantity)) < 0:
            raise HTTPException(status_code=400, detail="insufficient balance")

    mv.user_id = current.id
    session.add(mv)
    session.commit()
    session.refresh(mv)
    return mv


@app.get("/stock/movements", response_model=list[StockMovement])
def list_movements(
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    return session.exec(
        select(StockMovement)
        .where(StockMovement.user_id == current.id)
        .order_by(StockMovement.id.desc())
    ).all()


# ===========
# BALANCE (protected)
# ===========
@app.get("/stock/balance", response_model=list[StockBalance])
def stock_balance(
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    signed_qty = _signed_expr()

    stmt = (
        select(
            Product.id.label("product_id"),
            Product.name,
            Product.unit,
            func.coalesce(func.sum(signed_qty), 0).label("balance"),
        )
        .outerjoin(
            StockMovement,
            (StockMovement.product_id == Product.id) & (StockMovement.user_id == current.id),
        )
        .where(Product.user_id == current.id)
        .group_by(Product.id, Product.name, Product.unit)
        .order_by(Product.name.asc())
    )

    rows = session.exec(stmt).all()
    return [StockBalance(**dict(r._mapping)) for r in rows]


# ===========
# STATEMENT (protected)
# ===========
@app.get("/stock/statement", response_model=StockStatement)
def stock_statement(
    product_id: int,
    from_date: date | None = None,
    to_date: date | None = None,
    session: Session = Depends(get_session),
    current: User = Depends(get_current_user),
):
    product = session.get(Product, product_id)
    if not product or product.user_id != current.id:
        raise HTTPException(status_code=404, detail="product not found")

    start_dt = datetime.combine(from_date, time.min) if from_date else None
    end_dt = datetime.combine(to_date + timedelta(days=1), time.min) if to_date else None

    signed_qty_expr = _signed_expr()

    # saldo anterior ao período (do usuário)
    stmt_start = select(func.coalesce(func.sum(signed_qty_expr), 0)).where(
        StockMovement.user_id == current.id,
        StockMovement.product_id == product_id,
    )
    if start_dt:
        stmt_start = stmt_start.where(StockMovement.created_at < start_dt)

    starting_balance = float(session.exec(stmt_start).one())

    # movimentos no período (do usuário)
    stmt = select(StockMovement).where(
        StockMovement.user_id == current.id,
        StockMovement.product_id == product_id,
    )
    if start_dt:
        stmt = stmt.where(StockMovement.created_at >= start_dt)
    if end_dt:
        stmt = stmt.where(StockMovement.created_at < end_dt)

    stmt = stmt.order_by(StockMovement.created_at.asc(), StockMovement.id.asc())
    movements = session.exec(stmt).all()

    balance = starting_balance
    lines: list[StockStatementLine] = []

    for mv in movements:
        if mv.type in ("IN", "ADJUST"):
            signed = float(mv.quantity)
        elif mv.type == "OUT":
            signed = -float(mv.quantity)
        else:
            signed = 0.0

        balance += signed

        lines.append(
            StockStatementLine(
                id=mv.id,
                created_at=mv.created_at,
                type=mv.type,
                quantity=float(mv.quantity),
                signed_quantity=signed,
                note=getattr(mv, "note", None),
                balance_after=balance,
            )
        )

    return StockStatement(
        product_id=product_id,
        from_date=from_date,
        to_date=to_date,
        starting_balance=starting_balance,
        ending_balance=balance,
        lines=lines,
    )
