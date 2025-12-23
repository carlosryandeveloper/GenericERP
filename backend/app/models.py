from __future__ import annotations

from datetime import datetime, date
from typing import Optional, List

from sqlmodel import SQLModel, Field, Relationship


# =========================
# AUTH
# =========================
class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PasswordReset(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")

    token_hash: str = Field(index=True)
    expires_at: datetime
    used_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


# =========================
# CATALOG
# =========================
class Category(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")

    name: str = Field(index=True)
    auto_discount_enabled: bool = Field(default=False)
    default_discount_percent: float = Field(default=0.0)

    created_at: datetime = Field(default_factory=datetime.utcnow)


class Product(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")

    category_id: int = Field(index=True, foreign_key="category.id")

    sku: str = Field(index=True)
    name: str
    unit: str  # UN, CX, KG, L...
    pack_factor: float = Field(default=1.0)  # ex: CX = 12 UN
    price: float = Field(default=0.0)

    created_at: datetime = Field(default_factory=datetime.utcnow)


# =========================
# STOCK
# =========================
class StockMovement(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    user_id: int = Field(index=True, foreign_key="user.id")
    product_id: int = Field(index=True, foreign_key="product.id")

    # IN / OUT / ADJUST
    type: str = Field(index=True)
    quantity: float
    note: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)


# =========================
# QUOTES (ORÇAMENTOS)
# =========================
class Quote(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")

    customer_name: str
    customer_email: Optional[str] = None

    status: str = Field(default="DRAFT", index=True)  # DRAFT/SENT/APPROVED/REJECTED/CANCELLED
    issued_at: date = Field(default_factory=lambda: date.today())
    valid_until: Optional[date] = None
    notes: Optional[str] = None

    total_gross: float = Field(default=0.0)
    total_discount: float = Field(default=0.0)
    total_net: float = Field(default=0.0)

    created_at: datetime = Field(default_factory=datetime.utcnow)


class QuoteItem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    quote_id: int = Field(index=True, foreign_key="quote.id")
    user_id: int = Field(index=True, foreign_key="user.id")

    product_id: int = Field(index=True, foreign_key="product.id")

    # "foto do momento" (pra não mudar se preço/cadastro mudar)
    sku_snapshot: str
    name_snapshot: str
    unit_snapshot: str

    quantity: float
    unit_price: float
    discount_percent: float = Field(default=0.0)

    gross_total: float = Field(default=0.0)
    discount_total: float = Field(default=0.0)
    net_total: float = Field(default=0.0)

    created_at: datetime = Field(default_factory=datetime.utcnow)
