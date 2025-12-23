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

SECRET_KEY = "CHANGE_ME_GENERICERP_DEV_SECRET"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24h

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def _normalize_password_for_bcrypt(password: str) -> str:
    pw_bytes = password.encode("utf-8")
    if len(pw_bytes) <= 72:
        return password
    return hashlib.sha256(pw_bytes).hexdigest()


def hash_password(password: str) -> str:
    return pwd_context.hash(_normalize_password_for_bcrypt(password))


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(_normalize_password_for_bcrypt(password), password_hash)


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


def create_reset_code(session: Session, user: User, minutes_valid: int = 15) -> str:
    # 6 dígitos numéricos
    code = f"{secrets.randbelow(1_000_000):06d}"

    reset = PasswordReset(
        user_id=user.id,
        token_hash=_sha256(code),
        expires_at=datetime.utcnow() + timedelta(minutes=minutes_valid),
    )
    session.add(reset)
    session.commit()
    return code


def consume_reset_code(session: Session, user: User, code: str) -> None:
    code_hash = _sha256(code)

    reset = session.exec(
        select(PasswordReset)
        .where(PasswordReset.user_id == user.id)
        .where(PasswordReset.token_hash == code_hash)
        .order_by(PasswordReset.id.desc())
    ).first()

    if not reset:
        raise HTTPException(status_code=400, detail="código inválido")

    if reset.used_at is not None:
        raise HTTPException(status_code=400, detail="código já utilizado")

    if reset.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="código expirado")

    reset.used_at = datetime.utcnow()
    session.add(reset)
    session.commit()
