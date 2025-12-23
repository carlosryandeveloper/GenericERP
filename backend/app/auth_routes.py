import os
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from pydantic import BaseModel, EmailStr

from .db import get_session
from .models import User
from .auth import hash_password, verify_password, create_access_token, get_current_user, create_reset_code, consume_reset_code
from .mailer import send_email

router = APIRouter()


class RegisterIn(BaseModel):
    email: EmailStr
    password: str


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    email: EmailStr
    code: str
    new_password: str


@router.post("/register")
def register(data: RegisterIn, session: Session = Depends(get_session)):
    email = data.email.strip().lower()

    exists = session.exec(select(User).where(User.email == email)).first()
    if exists:
        raise HTTPException(
            status_code=409,
            detail="E-mail já cadastrado. Use 'Esqueci minha senha' para redefinir.",
        )

    if len(data.password.strip()) < 6:
        raise HTTPException(status_code=400, detail="A senha deve ter no mínimo 6 caracteres.")

    user = User(email=email, password_hash=hash_password(data.password.strip()))
    session.add(user)
    session.commit()
    session.refresh(user)

    send_email(
        to_email=email,
        subject="GenericERP — Conta criada",
        text="Sua conta foi criada com sucesso. Você já pode fazer login.",
    )

    return {"ok": True, "message": "Conta criada. Verifique seu e-mail para confirmação."}


@router.post("/login")
def login(data: LoginIn, session: Session = Depends(get_session)):
    email = data.email.strip().lower()
    user = session.exec(select(User).where(User.email == email)).first()
    if not user or not verify_password(data.password.strip(), user.password_hash):
        raise HTTPException(status_code=401, detail="Credenciais inválidas.")

    token = create_access_token(user.id)
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "created_at": user.created_at}


@router.post("/forgot-password")
def forgot_password(data: ForgotIn, session: Session = Depends(get_session)):
    email = data.email.strip().lower()
    user = session.exec(select(User).where(User.email == email)).first()

    # Resposta neutra (não expõe se existe ou não)
    if not user:
        return {"ok": True, "message": "Se o e-mail existir, enviaremos um código de 6 dígitos."}

    code = create_reset_code(session, user, minutes_valid=15)

    ok = send_email(
        to_email=email,
        subject="GenericERP — Código de redefinição (6 dígitos)",
        text=f"Seu código é: {code}\n\nEle expira em 15 minutos.",
    )
    if not ok:
        raise HTTPException(status_code=500, detail="Falha ao enviar e-mail. Verifique SMTP.")

    # DEV opcional: retornar o código (pra teste local)
    if os.getenv("DEV_RETURN_RESET_CODE", "false").lower() == "true":
        return {"ok": True, "message": "Código enviado.", "dev_code": code}

    return {"ok": True, "message": "Código enviado para o e-mail (se existir)."}  # neutro


@router.post("/reset-password")
def reset_password(data: ResetIn, session: Session = Depends(get_session)):
    email = data.email.strip().lower()
    user = session.exec(select(User).where(User.email == email)).first()
    if not user:
        raise HTTPException(status_code=400, detail="E-mail ou código inválido.")

    if len(data.new_password.strip()) < 6:
        raise HTTPException(status_code=400, detail="A senha deve ter no mínimo 6 caracteres.")

    consume_reset_code(session, user, data.code.strip())

    user.password_hash = hash_password(data.new_password.strip())
    session.add(user)
    session.commit()

    return {"ok": True, "message": "Senha atualizada. Faça login novamente."}
