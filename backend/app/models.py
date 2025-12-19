from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field

class Product(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    sku: str = Field(index=True)
    name: str
    unit: str = "UN"
    created_at: datetime = Field(default_factory=datetime.utcnow)

class StockMovement(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    product_id: int = Field(index=True)
    type: str  # IN, OUT, TRANSFER, ADJUST
    quantity: float
    note: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
