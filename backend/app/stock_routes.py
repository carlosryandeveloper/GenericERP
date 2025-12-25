from __future__ import annotations
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import SQLModel, Session, select
from sqlalchemy import func, case

from .db import get_session
from .auth import get_current_user
from .models import Product, StockMovement, User

router = APIRouter()


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


@router.post("/stock/movements", response_model=StockMovement)
def create_movement(
    mv: StockMovement,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if mv.quantity <= 0:
        raise HTTPException(status_code=400, detail="quantity must be > 0")

    # valida produto do usuário
    p = session.get(Product, mv.product_id)
    if not p or p.user_id != user.id:
        raise HTTPException(status_code=400, detail="product inválido")

    mv.user_id = user.id
    session.add(mv)
    session.commit()
    session.refresh(mv)
    return mv


@router.get("/stock/movements", response_model=list[StockMovement])
def list_movements(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return session.exec(
        select(StockMovement)
        .where(StockMovement.user_id == user.id)
        .order_by(StockMovement.id.desc())
    ).all()


@router.get("/stock/balance", response_model=list[StockBalance])
def stock_balance(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
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
        .outerjoin(
            StockMovement,
            (StockMovement.product_id == Product.id) & (StockMovement.user_id == user.id),
        )
        .where(Product.user_id == user.id)
        .group_by(Product.id, Product.sku, Product.name)
        .order_by(Product.id)
    )

    rows = session.exec(stmt).all()
    return [StockBalance(**dict(r._mapping)) for r in rows]


@router.get("/stock/statement", response_model=StockStatement)
def stock_statement(
    product_id: int,
    from_date: date | None = None,
    to_date: date | None = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    product = session.get(Product, product_id)
    if not product or product.user_id != user.id:
        raise HTTPException(status_code=404, detail="product not found")

    start_dt = datetime.combine(from_date, time.min) if from_date else None
    end_dt = datetime.combine(to_date + timedelta(days=1), time.min) if to_date else None

    signed_qty_expr = case(
        (StockMovement.type.in_(["IN", "ADJUST"]), StockMovement.quantity),
        (StockMovement.type == "OUT", -StockMovement.quantity),
        else_=0,
    )

    stmt_start = select(func.coalesce(func.sum(signed_qty_expr), 0)).where(
        StockMovement.product_id == product_id,
        StockMovement.user_id == user.id,
    )
    if start_dt:
        stmt_start = stmt_start.where(StockMovement.created_at < start_dt)

    starting_balance = float(session.exec(stmt_start).one())

    stmt = select(StockMovement).where(
        StockMovement.product_id == product_id,
        StockMovement.user_id == user.id,
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
