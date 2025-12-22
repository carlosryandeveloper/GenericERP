from datetime import datetime
from typing import Optional

from sqlmodel import SQLModel, Field


class Product(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    sku: str = Field(index=True, default="")
    name: str = Field(default="")
    unit: str = Field(default="")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class StockMovement(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    product_id: int = Field(index=True)
    type: str = Field(default="IN", index=True)  # IN / OUT / ADJUST
    quantity: float = Field(default=0)
    note: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
