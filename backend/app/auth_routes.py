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
    get_current_user,
    oauth2_scheme,
    revoke_access_token,
    create_password_reset,
    consume_password_reset,
    RESET_TOKEN_EXPIRE_MINUTES,
)
from .mailer import send_email

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


class ForgotOut(SQLModel):
    ok: bool = True
    email_sent: bool = False


class ResetIn(SQLModel):
    email: str
    token: str
    new_password: str


def _clean_email(email: str) -> str:
    return (email or "").strip().lower()


@router.post("/register")
def register(payload: RegisterIn, session: Session = Depends(get_session)):
    email = _clean_email(payload.email)
    password = (payload.password or "").strip()

    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="email inválido")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="senha deve ter no mínimo 6 caracteres")

    existing = session.exec(select(User).where(User.email == email)).first()
    if existing:
        raise HTTPException(status_code=409, detail="e-mail já cadastrado")

    user = User(email=email, password_hash=hash_password(password))
    session.add(user)
    session.commit()
    session.refresh(user)

    subject = "Sua conta foi criada no GenericERP"
    body = (
        "Olá!\n\n"
        "Sua conta no GenericERP foi criada com sucesso.\n"
        "Você já pode voltar para a tela de login e entrar com seu e-mail e senha.\n\n"
        "Se não foi você, ignore este e-mail."
    )
    email_sent = send_email(email, subject, body)

    return {
        "ok": True,
        "user": UserOut(id=user.id, email=user.email, created_at=user.created_at).model_dump(),
        "email_sent": email_sent,
    }


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, session: Session = Depends(get_session)):
    email = _clean_email(payload.email)
    password = (payload.password or "").strip()

    user = session.exec(select(User).where(User.email == email)).first()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="credenciais inválidas")

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


@router.post("/forgot-password", response_model=ForgotOut)
def forgot_password(payload: ForgotIn, session: Session = Depends(get_session)):
    email = _clean_email(payload.email)

    # resposta sempre ok (pra não entregar se o e-mail existe)
    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        return ForgotOut(ok=True, email_sent=False)

    code = create_password_reset(session, user.id)

    subject = "Token para redefinir sua senha (GenericERP)"
    body = (
        "Você pediu para redefinir sua senha.\n\n"
        f"Seu token de 6 dígitos é: {code}\n"
        f"Ele expira em {RESET_TOKEN_EXPIRE_MINUTES} minutos.\n\n"
        "Se não foi você, ignore este e-mail."
    )
    email_sent = send_email(email, subject, body)

    return ForgotOut(ok=True, email_sent=email_sent)


@router.post("/reset-password")
def reset_password(payload: ResetIn, session: Session = Depends(get_session)):
    email = _clean_email(payload.email)
    token = (payload.token or "").strip()
    new_password = (payload.new_password or "").strip()

    if len(token) != 6 or not token.isdigit():
        raise HTTPException(status_code=400, detail="token deve ter 6 números")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="senha deve ter no mínimo 6 caracteres")

    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        raise HTTPException(status_code=400, detail="token inválido ou expirado")

    consume_password_reset(session, user.id, token)

    user.password_hash = hash_password(new_password)
    session.add(user)
    session.commit()

    send_email(
        email,
        "Senha alterada no GenericERP",
        "Sua senha foi alterada com sucesso.\nSe não foi você, redefina novamente e revise a segurança da sua conta.",
    )

    return {"ok": True}
