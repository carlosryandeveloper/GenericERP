from datetime import date, datetime, time, timedelta

from fastapi import FastAPI, Depends, HTTPException
from sqlmodel import SQLModel, Session, select
from sqlalchemy import func, case

from .db import engine, get_session
from .models import Product, StockMovement


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


app = FastAPI(title="GenericERP API", version="0.1.0")


@app.on_event("startup")
def on_startup():
    SQLModel.metadata.create_all(engine)


@app.get("/health")
def health():
    return {"status": "ok", "service": "GenericERP API"}


@app.get("/debug/routes")
def debug_routes():
    return sorted({getattr(r, "path", "") for r in app.routes})


@app.post("/products", response_model=Product)
def create_product(product: Product, session: Session = Depends(get_session)):
    # Regra: SKU deve ser único
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


@app.get("/stock/statement", response_model=StockStatement)
def stock_statement(
    product_id: int,
    from_date: date | None = None,
    to_date: date | None = None,
    session: Session = Depends(get_session),
):
    # Confere se o produto existe (extrato sem produto é fofoca)
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="product not found")

    start_dt = datetime.combine(from_date, time.min) if from_date else None
    end_dt = (
        datetime.combine(to_date + timedelta(days=1), time.min) if to_date else None
    )  # exclusivo (menor que)

    signed_qty = case(
        (StockMovement.type.in_(["IN", "ADJUST"]), StockMovement.quantity),
        (StockMovement.type == "OUT", -StockMovement.quantity),
        else_=0,
    )

    # Saldo antes do período (pra começar o extrato com base correta)
    stmt_start = select(func.coalesce(func.sum(signed_qty), 0)).where(
        StockMovement.product_id == product_id
    )
    if start_dt:
        stmt_start = stmt_start.where(StockMovement.created_at < start_dt)
    starting_balance = float(session.exec(stmt_start).one())

    # Movimentações dentro do período
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
