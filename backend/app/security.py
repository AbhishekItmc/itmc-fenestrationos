"""Password hashing (bcrypt), JWT (HS256) bearer auth, role checks and login rate limiting."""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Callable, Deque, Dict, Optional

import bcrypt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .db import get_db
from .errors import APIError
from .models import User

_bearer = HTTPBearer(auto_error=False, description="JWT from POST /api/v1/auth/login")

MIN_PASSWORD_LEN = 8
MAX_PASSWORD_BYTES = 72  # bcrypt limit


def hash_password(password: str) -> str:
    pw = password.encode("utf-8")
    if len(pw) > MAX_PASSWORD_BYTES:
        raise ValueError("password too long")
    return bcrypt.hashpw(pw, bcrypt.gensalt(rounds=12)).decode("ascii")


def verify_password(password: str, hashed: str) -> bool:
    try:
        pw = password.encode("utf-8")
        if len(pw) > MAX_PASSWORD_BYTES:
            return False
        return bcrypt.checkpw(pw, hashed.encode("ascii"))
    except (ValueError, TypeError):
        return False


# constant-time-ish dummy hash so unknown-email logins cost the same as wrong-password logins
_DUMMY_HASH = bcrypt.hashpw(b"dummy-password-not-used", bcrypt.gensalt(rounds=12)).decode("ascii")


def dummy_verify() -> None:
    verify_password("x" * 12, _DUMMY_HASH)


def create_access_token(user: User, settings) -> str:
    now = datetime.now(timezone.utc)
    claims = {"sub": str(user.id), "role": user.role, "email": user.email, "iat": int(now.timestamp()),
              "exp": int((now + timedelta(minutes=settings.jwt_expire_min)).timestamp()), "iss": "fos"}
    return jwt.encode(claims, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def _unauth(msg: str = "Not authenticated") -> APIError:
    return APIError(401, "UNAUTHORIZED", msg, headers={"WWW-Authenticate": "Bearer"})


def get_current_user(request: Request, cred: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
                     db: Session = Depends(get_db)) -> User:
    if cred is None or cred.scheme.lower() != "bearer" or not cred.credentials:
        raise _unauth()
    settings = request.app.state.settings
    try:
        claims = jwt.decode(cred.credentials, settings.jwt_secret, algorithms=[settings.jwt_algorithm],
                            options={"require_exp": True, "require_sub": True}, issuer="fos")
        uid = int(claims["sub"])
    except (JWTError, KeyError, ValueError):
        raise _unauth("Invalid or expired token")
    user = db.get(User, uid)
    if user is None or not user.active:
        raise _unauth("Invalid or expired token")
    request.state.user = user
    return user


def require_roles(*roles: str) -> Callable[..., User]:
    allowed = set(roles)

    def dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise APIError(403, "FORBIDDEN", f"Role '{user.role}' may not perform this action "
                                             f"(requires one of: {', '.join(sorted(allowed))})")
        return user
    dep.__name__ = f"require_{'_'.join(sorted(allowed))}"
    return dep


# Role groups (ARCHITECTURE §6)
ANY = ("admin", "engineer", "estimator", "viewer")
ADMIN = ("admin",)
ENGINEERING = ("admin", "engineer")
COMMERCIAL = ("admin", "estimator")
PROJECT_WRITERS = ("admin", "engineer", "estimator")


class LoginRateLimiter:
    """In-memory sliding-window limiter on FAILED logins per e-mail and per client IP.
    Single-process only (documented); behind multiple workers use a shared store or a reverse-proxy limit."""

    def __init__(self, max_per_email: int, max_per_ip: int, window_s: int):
        self.max_per_email, self.max_per_ip, self.window = max_per_email, max_per_ip, window_s
        self._fail: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> Deque[float]:
        q = self._fail[key]
        while q and now - q[0] > self.window:
            q.popleft()
        return q

    def check(self, email: str, ip: str) -> Optional[int]:
        """Return retry-after seconds if blocked, else None."""
        now = time.monotonic()
        with self._lock:
            qe, qi = self._prune("e:" + email, now), self._prune("i:" + ip, now)
            if len(qe) >= self.max_per_email or len(qi) >= self.max_per_ip:
                oldest = min([q[0] for q in (qe, qi) if q])
                return max(1, int(self.window - (now - oldest)) + 1)
        return None

    def fail(self, email: str, ip: str) -> None:
        now = time.monotonic()
        with self._lock:
            self._fail["e:" + email].append(now)
            self._fail["i:" + ip].append(now)

    def success(self, email: str) -> None:
        with self._lock:
            self._fail.pop("e:" + email, None)

    def reset(self) -> None:
        with self._lock:
            self._fail.clear()


def client_ip(request: Request) -> str:
    # X-Forwarded-For is only trusted when uvicorn runs with --proxy-headers behind our nginx;
    # request.client already reflects that.
    return request.client.host if request.client else "-"
