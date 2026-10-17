from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...db import get_db, utcnow
from ...errors import APIError
from ...models import User
from ...schemas import LoginIn, TokenOut, UserOut
from ...security import client_ip, create_access_token, dummy_verify, get_current_user, verify_password
from ...services.audit import audit

router = APIRouter(prefix="/auth", tags=["auth"])

GENERIC = "Invalid e-mail or password"


@router.post("/login", response_model=TokenOut, summary="Log in and obtain a JWT bearer token")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    limiter = request.app.state.login_limiter
    settings = request.app.state.settings
    ip = client_ip(request)
    retry = limiter.check(body.email, ip)
    if retry:
        audit(db, request, None, "login_blocked", "auth", None, {"email": body.email}, commit=True,
              user_email=body.email)
        raise APIError(429, "RATE_LIMITED", "Too many failed login attempts. Try again later.",
                       headers={"Retry-After": str(retry)})
    user = db.scalars(select(User).where(User.email == body.email)).first()
    if user is None:
        dummy_verify()
        ok = False
    else:
        ok = verify_password(body.password, user.hashed_password) and user.active
    if not ok:
        limiter.fail(body.email, ip)
        audit(db, request, None, "login_failed", "auth", user.id if user else None,
              {"email": body.email}, commit=True, user_email=body.email)
        raise APIError(401, "INVALID_CREDENTIALS", GENERIC, headers={"WWW-Authenticate": "Bearer"})
    limiter.success(body.email)
    user.last_login_at = utcnow()
    audit(db, request, user, "login", "auth", user.id, {})
    db.commit()
    return TokenOut(access_token=create_access_token(user, settings), expires_in=settings.jwt_expire_min * 60,
                    user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut, summary="Current user")
def me(user: User = Depends(get_current_user)):
    return user
