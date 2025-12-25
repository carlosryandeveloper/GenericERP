from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from pydantic import BaseModel
from typing import Optional

from .db import get_session
from .auth import get_current_user
from .models import Category, Product, User

router = APIRouter()


# ---------- Categories ----------
class CategoryIn(BaseModel):
    name: str
    auto_discount_enabled: bool = False
    default_discount_percent: float = 0.0


class CategoryPatch(BaseModel):
    name: Optional[str] = None
    auto_discount_enabled: Optional[bool] = None
    default_discount_percent: Optional[float] = None


@router.post("/categories", response_model=Category)
def create_category(
    data: CategoryIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nome da categoria é obrigatório.")

    exists = session.exec(
        select(Category).where(Category.user_id == user.id).where(Category.name == name)
    ).first()
    if exists:
        raise HTTPException(status_code=409, detail="Categoria já existe.")

    if data.default_discount_percent < 0 or data.default_discount_percent > 100:
        raise HTTPException(status_code=400, detail="Desconto padrão deve ser entre 0 e 100.")

    cat = Category(
        user_id=user.id,
        name=name,
        auto_discount_enabled=bool(data.auto_discount_enabled),
        default_discount_percent=float(data.default_discount_percent or 0.0),
    )
    session.add(cat)
    session.commit()
    session.refresh(cat)
    return cat


@router.get("/categories", response_model=list[Category])
def list_categories(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return session.exec(
        select(Category).where(Category.user_id == user.id).order_by(Category.id.desc())
    ).all()


@router.patch("/categories/{category_id}", response_model=Category)
def patch_category(
    category_id: int,
    data: CategoryPatch,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    cat = session.get(Category, category_id)
    if not cat or cat.user_id != user.id:
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")

    if data.name is not None:
        name = data.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Nome inválido.")
        exists = session.exec(
            select(Category)
            .where(Category.user_id == user.id)
            .where(Category.name == name)
            .where(Category.id != category_id)
        ).first()
        if exists:
            raise HTTPException(status_code=409, detail="Já existe uma categoria com esse nome.")
        cat.name = name

    if data.auto_discount_enabled is not None:
        cat.auto_discount_enabled = bool(data.auto_discount_enabled)

    if data.default_discount_percent is not None:
        if data.default_discount_percent < 0 or data.default_discount_percent > 100:
            raise HTTPException(status_code=400, detail="Desconto padrão deve ser entre 0 e 100.")
        cat.default_discount_percent = float(data.default_discount_percent)

    session.add(cat)
    session.commit()
    session.refresh(cat)
    return cat


# ---------- Products ----------
class ProductIn(BaseModel):
    sku: str
    name: str
    unit: str
    price: float
    category_id: int
    pack_factor: float = 1.0


class ProductPatch(BaseModel):
    sku: Optional[str] = None
    name: Optional[str] = None
    unit: Optional[str] = None
    price: Optional[float] = None
    category_id: Optional[int] = None
    pack_factor: Optional[float] = None


@router.post("/products", response_model=Product)
def create_product(
    data: ProductIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    sku = (data.sku or "").strip()
    name = (data.name or "").strip()
    unit = (data.unit or "").strip().upper()

    if not sku or not name or not unit:
        raise HTTPException(status_code=400, detail="SKU, Nome e Unidade são obrigatórios.")

    if data.price < 0:
        raise HTTPException(status_code=400, detail="Preço não pode ser negativo.")
    if data.pack_factor <= 0:
        raise HTTPException(status_code=400, detail="Fator de embalagem deve ser > 0.")

    exists = session.exec(
        select(Product)
        .where(Product.user_id == user.id)
        .where(Product.sku == sku)
    ).first()
    if exists:
        raise HTTPException(status_code=409, detail="SKU já existe.")

    cat = session.get(Category, data.category_id)
    if not cat or cat.user_id != user.id:
        raise HTTPException(status_code=400, detail="Categoria inválida.")

    p = Product(
        user_id=user.id,
        category_id=data.category_id,
        sku=sku,
        name=name,
        unit=unit,
        price=float(data.price),
        pack_factor=float(data.pack_factor),
    )
    session.add(p)
    session.commit()
    session.refresh(p)
    return p


@router.get("/products", response_model=list[Product])
def list_products(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return session.exec(
        select(Product).where(Product.user_id == user.id).order_by(Product.id.desc())
    ).all()


@router.get("/products/min")
def products_min(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    # Dropdown + orçamento: precisa preço e desconto padrão da categoria
    stmt = (
        select(
            Product.id,
            Product.sku,
            Product.name,
            Product.unit,
            Product.price,
            Product.pack_factor,
            Product.category_id,
            Category.name,
            Category.auto_discount_enabled,
            Category.default_discount_percent,
        )
        .join(Category, Category.id == Product.category_id)
        .where(Product.user_id == user.id)
        .order_by(Product.name.asc())
    )

    rows = session.exec(stmt).all()
    return [
        {
            "id": r[0],
            "sku": r[1],
            "name": r[2],
            "unit": r[3],
            "price": r[4],
            "pack_factor": r[5],
            "category_id": r[6],
            "category_name": r[7],
            "auto_discount_enabled": r[8],
            "default_discount_percent": r[9],
        }
        for r in rows
    ]


@router.patch("/products/{product_id}", response_model=Product)
def patch_product(
    product_id: int,
    data: ProductPatch,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = session.get(Product, product_id)
    if not p or p.user_id != user.id:
        raise HTTPException(status_code=404, detail="Produto não encontrado.")

    if data.sku is not None:
        sku = data.sku.strip()
        if not sku:
            raise HTTPException(status_code=400, detail="SKU inválido.")
        exists = session.exec(
            select(Product)
            .where(Product.user_id == user.id)
            .where(Product.sku == sku)
            .where(Product.id != product_id)
        ).first()
        if exists:
            raise HTTPException(status_code=409, detail="SKU já existe.")
        p.sku = sku

    if data.name is not None:
        name = data.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Nome inválido.")
        p.name = name

    if data.unit is not None:
        unit = data.unit.strip().upper()
        if not unit:
            raise HTTPException(status_code=400, detail="Unidade inválida.")
        p.unit = unit

    if data.price is not None:
        if data.price < 0:
            raise HTTPException(status_code=400, detail="Preço não pode ser negativo.")
        p.price = float(data.price)

    if data.pack_factor is not None:
        if data.pack_factor <= 0:
            raise HTTPException(status_code=400, detail="Fator de embalagem deve ser > 0.")
        p.pack_factor = float(data.pack_factor)

    if data.category_id is not None:
        cat = session.get(Category, data.category_id)
        if not cat or cat.user_id != user.id:
            raise HTTPException(status_code=400, detail="Categoria inválida.")
        p.category_id = int(data.category_id)

    session.add(p)
    session.commit()
    session.refresh(p)
    return p
