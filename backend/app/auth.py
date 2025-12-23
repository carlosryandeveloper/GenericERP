from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import Session, select

from .db import get_session
from .models import User, PasswordReset, AccessToken


ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24h
PWD_ITERATIONS = 200_000

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


# -----------------------
# PASSWORD HASH (PBKDF2)
# -----------------------
def hash_password(password: str) -> str:
    pw = (password or "").encode("utf-8")
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw, salt, PWD_ITERATIONS)
    return f"pbkdf2_sha256${PWD_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algo, it_str, salt_hex, hash_hex = (password_hash or "").split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        it = int(it_str)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)

        dk = hashlib.pbkdf2_hmac("sha256", (password or "").encode("utf-8"), salt, it)
        return secrets.compare_digest(dk, expected)
    except Exception:
        return False


# -----------------------
# ACCESS TOKEN (OPACO)
# -----------------------
def create_access_token(session: Session, user_id: int) -> str:
    raw = secrets.token_urlsafe(32)
    token_hash = _sha256(raw)
    expires_at = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    row = AccessToken(user_id=user_id, token_hash=token_hash, expires_at=expires_at)
    session.add(row)
    session.commit()
    return raw


def revoke_access_token(session: Session, raw_token: str) -> None:
    token_hash = _sha256(raw_token)
    row = session.exec(select(AccessToken).where(AccessToken.token_hash == token_hash)).first()
    if not row:
        return
    row.revoked_at = datetime.utcnow()
    session.add(row)
    session.commit()


def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> User:
    if not token:
        raise HTTPException(status_code=401, detail="missing token")

    token_hash = _sha256(token)

    row = session.exec(
        select(AccessToken)
        .where(AccessToken.token_hash == token_hash)
        .order_by(AccessToken.id.desc())
    ).first()

    if not row:
        raise HTTPException(status_code=401, detail="invalid token")

    if row.revoked_at is not None:
        raise HTTPException(status_code=401, detail="token revoked")

    if row.expires_at < datetime.utcnow():
        raise HTTPException(status_code=401, detail="token expired")

    user = session.get(User, row.user_id)
    if not user:
        raise HTTPException(status_code=401, detail="user not found")

    return user


# -----------------------
# PASSWORD RESET (DEV)
# -----------------------
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
