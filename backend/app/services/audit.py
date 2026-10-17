"""Audit trail helper. Call inside the request transaction (committed with the change) or with commit=True."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import Request
from sqlalchemy.orm import Session

from ..models import AuditLog, User


def audit(db: Session, request: Optional[Request], user: Optional[User], action: str, entity: str,
          entity_id: Any = None, detail: Optional[dict] = None, commit: bool = False,
          user_email: Optional[str] = None) -> AuditLog:
    ip = None
    rid = None
    if request is not None:
        ip = request.client.host if request.client else None
        rid = getattr(request.state, "request_id", None)
    entry = AuditLog(user_id=user.id if user else None, user_email=(user.email if user else user_email),
                     action=action, entity=entity, entity_id=None if entity_id is None else str(entity_id),
                     detail=detail or {}, ip=ip, request_id=rid)
    db.add(entry)
    if commit:
        db.commit()
    return entry
