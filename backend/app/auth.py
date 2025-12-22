from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlmodel import Session, select

from .db import get_session
from .models import User, PasswordReset

# MVP: chave fixa (depois você joga em ENV)
SECRET_KEY = "CHANGE_ME_GENERICERP_DEV_SECRET"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24h

# ✅ Troca importante:
# bcrypt puro tem limite de 72 bytes na senha.
# bcrypt_sha256 pré-hasheia e evita esse problema.
pwd_context = CryptContext(schemes=["bcrypt_sha256"], deprecated="auto")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(user_id: int) -> str:
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {"sub": str(user_id), "exp": expire}
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> User:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        sub = payload.get("sub")
        if not sub:
            raise HTTPException(status_code=401, detail="invalid token")
        user_id = int(sub)
    except (JWTError, ValueError):
        raise HTTPException(status_code=401, detail="invalid token")

    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="user not found")
    return user


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def create_reset_token(session: Session, user: User, minutes_valid: int = 30) -> str:
    raw = secrets.token_urlsafe(32)
    token_hash = _sha256(raw)

    reset = PasswordReset(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=datetime.utcnow() + timedelta(minutes=minutes_valid),
    )
    session.add(reset)
    session.commit()
    return raw


def consume_reset_token(session: Session, raw_token: str) -> User:
    token_hash = _sha256(raw_token)

    reset = session.exec(
        select(PasswordReset)
        .where(PasswordReset.token_hash == token_hash)
        .order_by(PasswordReset.id.desc())
    ).first()

    if not reset:
        raise HTTPException(status_code=400, detail="invalid token")

    if reset.used_at is not None:
        raise HTTPException(status_code=400, detail="token already used")

    if reset.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="token expired")

    user = session.get(User, reset.user_id)
    if not user:
        raise HTTPException(status_code=400, detail="user not found")

    reset.used_at = datetime.utcnow()
    session.add(reset)
    session.commit()

    return user
