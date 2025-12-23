from __future__ import annotations

from datetime import date, datetime, time, timedelta

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import SQLModel, Session, select
from sqlalchemy import func, case, and_

from .db import engine, get_session
from .models import Product, StockMovement, User, PasswordReset, AccessToken
from .auth import get_current_user
from .auth_routes import router as auth_router


class ProductCreate(SQLModel):
    sku: str
    name: str
    unit: str


class MovementCreate(SQLModel):
    product_id: int
    type: str  # IN / OUT / ADJUST
    quantity: float
    note: str | None = None


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


app = FastAPI(title="GenericERP API", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    SQLModel.metadata.create_all(engine)


@app.get("/health")
def health():
    return {"status": "ok", "service": "GenericERP API", "version": "0.3.0"}


@app.get("/debug/routes")
def debug_routes():
    return sorted({getattr(r, "path", "") for r in app.routes})


app.include_router(auth_router, prefix="/auth", tags=["auth"])


@app.post("/products", response_model=Product)
def create_product(
    payload: ProductCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    sku = (payload.sku or "").strip()
    name = (payload.name or "").strip()
    unit = (payload.unit or "").strip()

    if not sku:
        raise HTTPException(status_code=400, detail="sku é obrigatório")
    if not name:
        raise HTTPException(status_code=400, detail="nome é obrigatório")
    if not unit:
        raise HTTPException(status_code=400, detail="unidade é obrigatória")

    existing = session.exec(
        select(Product).where(and_(Product.user_id == user.id, Product.sku == sku))
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="sku já existe")

    product = Product(user_id=user.id, sku=sku, name=name, unit=unit)
    session.add(product)
    session.commit()
    session.refresh(product)
    return product


@app.get("/products", response_model=list[Product])
def list_products(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return session.exec(
        select(Product)
        .where(Product.user_id == user.id)
        .order_by(Product.id.desc())
    ).all()


@app.get("/products/min")
def products_min(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    rows = session.exec(
        select(Product.id, Product.name, Product.unit)
        .where(Product.user_id == user.id)
        .order_by(Product.id.asc())
    ).all()
    return [{"id": r[0], "name": r[1], "unit": r[2]} for r in rows]


def _signed_qty_expr():
    return case(
        (StockMovement.type.in_(["IN", "ADJUST"]), StockMovement.quantity),
        (StockMovement.type == "OUT", -StockMovement.quantity),
        else_=0,
    )


def _current_balance(session: Session, user_id: int, product_id: int) -> float:
    expr = _signed_qty_expr()
    stmt = select(func.coalesce(func.sum(expr), 0)).where(
        and_(StockMovement.user_id == user_id, StockMovement.product_id == product_id)
    )
    return float(session.exec(stmt).one())


@app.post("/stock/movements", response_model=StockMovement)
def create_movement(
    payload: MovementCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    mv_type = (payload.type or "").strip().upper()
    note = (payload.note or "").strip() or None

    if mv_type not in ("IN", "OUT", "ADJUST"):
        raise HTTPException(status_code=400, detail="type deve ser IN, OUT ou ADJUST")
    if payload.quantity is None or float(payload.quantity) <= 0:
        raise HTTPException(status_code=400, detail="quantity deve ser > 0")
    if mv_type == "ADJUST" and not note:
        raise HTTPException(status_code=400, detail="ADJUST exige observação")

    product = session.exec(
        select(Product).where(and_(Product.id == payload.product_id, Product.user_id == user.id))
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="produto não encontrado")

    if mv_type == "OUT":
        bal = _current_balance(session, user.id, payload.product_id)
        if bal - float(payload.quantity) < 0:
            raise HTTPException(status_code=400, detail="saldo insuficiente")

    mv = StockMovement(
        user_id=user.id,
        product_id=payload.product_id,
        type=mv_type,
        quantity=float(payload.quantity),
        note=note,
    )
    session.add(mv)
    session.commit()
    session.refresh(mv)
    return mv


@app.get("/stock/balance", response_model=list[StockBalance])
def stock_balance(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    signed_qty = _signed_qty_expr()

    stmt = (
        select(
            Product.id.label("product_id"),
            Product.sku,
            Product.name,
            func.coalesce(func.sum(signed_qty), 0).label("balance"),
        )
        .where(Product.user_id == user.id)
        .outerjoin(
            StockMovement,
            and_(StockMovement.product_id == Product.id, StockMovement.user_id == user.id),
        )
        .group_by(Product.id, Product.sku, Product.name)
        .order_by(Product.id.asc())
    )

    rows = session.exec(stmt).all()
    return [StockBalance(**dict(r._mapping)) for r in rows]


@app.get("/stock/statement", response_model=StockStatement)
def stock_statement(
    product_id: int,
    from_date: date | None = None,
    to_date: date | None = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    product = session.exec(
        select(Product).where(and_(Product.id == product_id, Product.user_id == user.id))
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="produto não encontrado")

    start_dt = datetime.combine(from_date, time.min) if from_date else None
    end_dt = datetime.combine(to_date + timedelta(days=1), time.min) if to_date else None

    signed_qty_expr = _signed_qty_expr()

    stmt_start = select(func.coalesce(func.sum(signed_qty_expr), 0)).where(
        and_(StockMovement.user_id == user.id, StockMovement.product_id == product_id)
    )
    if start_dt:
        stmt_start = stmt_start.where(StockMovement.created_at < start_dt)

    starting_balance = float(session.exec(stmt_start).one())

    stmt = select(StockMovement).where(
        and_(StockMovement.user_id == user.id, StockMovement.product_id == product_id)
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
