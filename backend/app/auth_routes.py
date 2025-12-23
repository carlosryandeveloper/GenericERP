from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, SQLModel

from .db import get_session
from .models import User
from .auth import (
    hash_password,
    verify_password,
    create_access_token,
    create_reset_token,
    consume_reset_token,
    get_current_user,
    revoke_access_token,
    oauth2_scheme,
)

router = APIRouter()


class RegisterIn(SQLModel):
    email: str
    password: str


class LoginIn(SQLModel):
    email: str
    password: str


class TokenOut(SQLModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(SQLModel):
    id: int
    email: str
    created_at: datetime


class ForgotIn(SQLModel):
    email: str


class ResetIn(SQLModel):
    token: str
    new_password: str


def _clean_email(email: str) -> str:
    return (email or "").strip().lower()


@router.post("/register", response_model=UserOut)
def register(payload: RegisterIn, session: Session = Depends(get_session)):
    email = _clean_email(payload.email)
    password = (payload.password or "").strip()

    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="invalid email")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="password must be >= 6 chars")

    existing = session.exec(select(User).where(User.email == email)).first()
    if existing:
        raise HTTPException(status_code=409, detail="email already exists")

    user = User(email=email, password_hash=hash_password(password))
    session.add(user)
    session.commit()
    session.refresh(user)

    return UserOut(id=user.id, email=user.email, created_at=user.created_at)


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, session: Session = Depends(get_session)):
    email = _clean_email(payload.email)
    password = (payload.password or "").strip()

    user = session.exec(select(User).where(User.email == email)).first()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="invalid credentials")

    token = create_access_token(session, user.id)
    return TokenOut(access_token=token)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return UserOut(id=user.id, email=user.email, created_at=user.created_at)


@router.post("/logout")
def logout(
    session: Session = Depends(get_session),
    token: str = Depends(oauth2_scheme),
):
    revoke_access_token(session, token)
    return {"ok": True}


@router.post("/forgot-password")
def forgot_password(payload: ForgotIn, session: Session = Depends(get_session)):
    email = _clean_email(payload.email)

    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        return {"ok": True}

    token = create_reset_token(session, user)
    return {"ok": True, "token": token}  # DEV


@router.post("/reset-password")
def reset_password(payload: ResetIn, session: Session = Depends(get_session)):
    new_password = (payload.new_password or "").strip()
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="password must be >= 6 chars")

    user = consume_reset_token(session, (payload.token or "").strip())
    user.password_hash = hash_password(new_password)

    session.add(user)
    session.commit()

    return {"ok": True}
