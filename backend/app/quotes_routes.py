from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlmodel import Session, select

from .db import get_session
from .auth import get_current_user
from .models import Quote, QuoteItem, Product, Category, User

router = APIRouter()


def calc_line(quantity: float, unit_price: float, discount_percent: float):
    gross = float(quantity) * float(unit_price)
    disc = gross * (float(discount_percent) / 100.0)
    net = gross - disc
    return gross, disc, net


def recalc_quote(session: Session, quote: Quote):
    items = session.exec(
        select(QuoteItem)
        .where(QuoteItem.quote_id == quote.id)
        .where(QuoteItem.user_id == quote.user_id)
        .order_by(QuoteItem.id.asc())
    ).all()

    tg = sum(i.gross_total for i in items)
    td = sum(i.discount_total for i in items)
    tn = sum(i.net_total for i in items)

    quote.total_gross = float(tg)
    quote.total_discount = float(td)
    quote.total_net = float(tn)

    session.add(quote)
    session.commit()
    session.refresh(quote)
    return quote, items


class QuoteIn(BaseModel):
    customer_name: str
    customer_email: Optional[EmailStr] = None
    valid_days: int = 7
    notes: Optional[str] = None


class QuoteStatusIn(BaseModel):
    status: str  # DRAFT/SENT/APPROVED/REJECTED/CANCELLED


class QuoteItemIn(BaseModel):
    product_id: int
    quantity: float
    unit_price: Optional[float] = None
    discount_percent: Optional[float] = None


class QuoteItemPatch(BaseModel):
    quantity: Optional[float] = None
    unit_price: Optional[float] = None
    discount_percent: Optional[float] = None


@router.post("/quotes", response_model=Quote)
def create_quote(
    data: QuoteIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    name = (data.customer_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Cliente é obrigatório.")

    valid_days = int(data.valid_days or 0)
    if valid_days <= 0 or valid_days > 365:
        raise HTTPException(status_code=400, detail="Validade deve ser entre 1 e 365 dias.")

    q = Quote(
        user_id=user.id,
        customer_name=name,
        customer_email=(str(data.customer_email).strip().lower() if data.customer_email else None),
        issued_at=date.today(),
        valid_until=date.today() + timedelta(days=valid_days),
        notes=(data.notes.strip() if data.notes else None),
        status="DRAFT",
    )
    session.add(q)
    session.commit()
    session.refresh(q)
    return q


@router.get("/quotes")
def list_quotes(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    rows = session.exec(
        select(Quote)
        .where(Quote.user_id == user.id)
        .order_by(Quote.id.desc())
    ).all()
    return rows


@router.get("/quotes/{quote_id}")
def get_quote(
    quote_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    q = session.get(Quote, quote_id)
    if not q or q.user_id != user.id:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")

    q, items = recalc_quote(session, q)
    return {"quote": q, "items": items}


@router.patch("/quotes/{quote_id}/status", response_model=Quote)
def set_quote_status(
    quote_id: int,
    data: QuoteStatusIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    q = session.get(Quote, quote_id)
    if not q or q.user_id != user.id:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")

    status = (data.status or "").strip().upper()
    allowed = {"DRAFT", "SENT", "APPROVED", "REJECTED", "CANCELLED"}
    if status not in allowed:
        raise HTTPException(status_code=400, detail=f"Status inválido. Use: {sorted(allowed)}")

    q.status = status
    session.add(q)
    session.commit()
    session.refresh(q)
    return q


@router.post("/quotes/{quote_id}/items", response_model=QuoteItem)
def add_item(
    quote_id: int,
    data: QuoteItemIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    q = session.get(Quote, quote_id)
    if not q or q.user_id != user.id:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")

    if data.quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantidade deve ser > 0.")

    p = session.get(Product, data.product_id)
    if not p or p.user_id != user.id:
        raise HTTPException(status_code=400, detail="Produto inválido.")

    cat = session.get(Category, p.category_id)
    if not cat or cat.user_id != user.id:
        raise HTTPException(status_code=400, detail="Categoria inválida.")

    unit_price = float(data.unit_price) if data.unit_price is not None else float(p.price)

    # desconto automático (categoria), mas editável:
    if data.discount_percent is None:
        discount = float(cat.default_discount_percent) if cat.auto_discount_enabled else 0.0
    else:
        discount = float(data.discount_percent)

    if unit_price < 0:
        raise HTTPException(status_code=400, detail="Preço unitário não pode ser negativo.")
    if discount < 0 or discount > 100:
        raise HTTPException(status_code=400, detail="Desconto deve ser entre 0 e 100.")

    gross, disc, net = calc_line(data.quantity, unit_price, discount)

    item = QuoteItem(
        quote_id=q.id,
        user_id=user.id,
        product_id=p.id,
        sku_snapshot=p.sku,
        name_snapshot=p.name,
        unit_snapshot=p.unit,
        quantity=float(data.quantity),
        unit_price=float(unit_price),
        discount_percent=float(discount),
        gross_total=float(gross),
        discount_total=float(disc),
        net_total=float(net),
    )

    session.add(item)
    session.commit()
    session.refresh(item)

    # recalcula totais do orçamento
    recalc_quote(session, q)
    return item


@router.patch("/quotes/{quote_id}/items/{item_id}", response_model=QuoteItem)
def patch_item(
    quote_id: int,
    item_id: int,
    data: QuoteItemPatch,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    q = session.get(Quote, quote_id)
    if not q or q.user_id != user.id:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")

    item = session.get(QuoteItem, item_id)
    if not item or item.user_id != user.id or item.quote_id != quote_id:
        raise HTTPException(status_code=404, detail="Item não encontrado.")

    if data.quantity is not None:
        if data.quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantidade deve ser > 0.")
        item.quantity = float(data.quantity)

    if data.unit_price is not None:
        if data.unit_price < 0:
            raise HTTPException(status_code=400, detail="Preço unitário não pode ser negativo.")
        item.unit_price = float(data.unit_price)

    if data.discount_percent is not None:
        if data.discount_percent < 0 or data.discount_percent > 100:
            raise HTTPException(status_code=400, detail="Desconto deve ser entre 0 e 100.")
        item.discount_percent = float(data.discount_percent)

    gross, disc, net = calc_line(item.quantity, item.unit_price, item.discount_percent)
    item.gross_total = gross
    item.discount_total = disc
    item.net_total = net

    session.add(item)
    session.commit()
    session.refresh(item)

    recalc_quote(session, q)
    return item


@router.delete("/quotes/{quote_id}/items/{item_id}")
def delete_item(
    quote_id: int,
    item_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    q = session.get(Quote, quote_id)
    if not q or q.user_id != user.id:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")

    item = session.get(QuoteItem, item_id)
    if not item or item.user_id != user.id or item.quote_id != quote_id:
        raise HTTPException(status_code=404, detail="Item não encontrado.")

    session.delete(item)
    session.commit()

    recalc_quote(session, q)
    return {"ok": True}
