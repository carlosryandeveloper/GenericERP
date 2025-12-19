from fastapi import FastAPI, Depends, HTTPException
from sqlmodel import SQLModel, Session, select
from .db import engine, get_session
from .models import Product, StockMovement

app = FastAPI(title="GenericERP API", version="0.1.0")

@app.on_event("startup")
def on_startup():
    SQLModel.metadata.create_all(engine)

@app.get("/health")
def health():
    return {"status": "ok", "service": "GenericERP API"}

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
