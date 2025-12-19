cat > app/main.py <<'PY'
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
PY
