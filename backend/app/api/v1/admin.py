from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...db import get_db
from ...errors import APIError
from ...models import AuditLog, User
from ...schemas import AuditOut, Page, UserCreate, UserOut, UserUpdate
from ...security import ADMIN, hash_password, require_roles
from ...services.audit import audit
from ..deps import get_or_404

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=List[UserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(require_roles(*ADMIN))):
    return db.scalars(select(User).order_by(User.id)).all()


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, request: Request, db: Session = Depends(get_db),
                user: User = Depends(require_roles(*ADMIN))):
    if db.scalars(select(User.id).where(User.email == body.email)).first():
        raise APIError(409, "DUPLICATE_EMAIL", "A user with this e-mail already exists")
    u = User(email=body.email, name=body.name, role=body.role, hashed_password=hash_password(body.password),
             active=True)
    db.add(u)
    db.flush()
    audit(db, request, user, "create", "user", u.id, {"email": u.email, "role": u.role})
    db.commit()
    return u


def _guard_last_admin(db: Session, target: User, new_role: Optional[str], new_active: Optional[bool]) -> None:
    if target.role != "admin":
        return
    if (new_role is not None and new_role != "admin") or new_active is False:
        n = db.scalar(select(func.count(User.id)).where(User.role == "admin", User.active.is_(True)))
        if n <= 1:
            raise APIError(409, "LAST_ADMIN", "Cannot demote or deactivate the last active admin")


@router.put("/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdate, request: Request, db: Session = Depends(get_db),
                user: User = Depends(require_roles(*ADMIN))):
    u = get_or_404(db, User, user_id, "User")
    changes = body.model_dump(exclude_unset=True)
    _guard_last_admin(db, u, changes.get("role"), changes.get("active"))
    if "password" in changes:
        u.hashed_password = hash_password(changes.pop("password"))
        changes["password_changed"] = True
    for k in ("name", "role", "active"):
        if k in changes:
            setattr(u, k, changes[k])
    audit(db, request, user, "update", "user", u.id, changes)
    db.commit()
    return u


@router.delete("/users/{user_id}", response_model=UserOut, summary="Deactivate a user (soft delete)")
def deactivate_user(user_id: int, request: Request, db: Session = Depends(get_db),
                    user: User = Depends(require_roles(*ADMIN))):
    u = get_or_404(db, User, user_id, "User")
    _guard_last_admin(db, u, None, False)
    u.active = False
    audit(db, request, user, "deactivate", "user", u.id, {"email": u.email})
    db.commit()
    return u


@router.get("/audit", response_model=Page)
def list_audit(action: Optional[str] = None, entity: Optional[str] = None, entity_id: Optional[str] = None,
               user_id: Optional[int] = None, since: Optional[datetime] = None, until: Optional[datetime] = None,
               limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
               db: Session = Depends(get_db), _: User = Depends(require_roles(*ADMIN))):
    conds = []
    if action:
        conds.append(AuditLog.action == action)
    if entity:
        conds.append(AuditLog.entity == entity)
    if entity_id:
        conds.append(AuditLog.entity_id == entity_id)
    if user_id:
        conds.append(AuditLog.user_id == user_id)
    if since:
        conds.append(AuditLog.ts >= since)
    if until:
        conds.append(AuditLog.ts <= until)
    total = db.scalar(select(func.count(AuditLog.id)).where(*conds))
    rows = db.scalars(select(AuditLog).where(*conds).order_by(AuditLog.id.desc()).limit(limit).offset(offset)).all()
    return Page(items=[AuditOut.model_validate(r).model_dump(mode="json") for r in rows], total=total or 0,
                limit=limit, offset=offset)
