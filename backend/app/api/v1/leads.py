"""Website demo requests ("leads").

Public:  POST /api/v1/leads            - no auth; honeypot, time-on-form check, in-memory per-IP rate limit.
Admin:   GET  /api/v1/admin/leads      - paged, filter by status.
         PUT  /api/v1/admin/leads/{id} - {status}.
The public endpoint never echoes submitted data back.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...db import get_db
from ...errors import APIError
from ...models import Lead, User
from ...schemas import LeadIn, LeadOut, LeadUpdate, LeadStatus, Page
from ...security import ADMIN, client_ip, require_roles
from ...services.audit import audit
from ..deps import get_or_404

router = APIRouter(tags=["website"])
admin_router = APIRouter(prefix="/admin/leads", tags=["admin"])

MIN_FORM_MS = 2000          # faster than this is treated as automated (silently accepted, not stored)
RATE_MAX = 5                # submissions per IP ...
RATE_WINDOW_S = 3600        # ... per hour


class LeadRateLimiter:
    """Sliding-window counter per IP hash. Single-process only (serverless instances each keep their own)."""

    def __init__(self, max_hits: int = RATE_MAX, window_s: int = RATE_WINDOW_S):
        self.max_hits, self.window = max_hits, window_s
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str) -> Optional[int]:
        """Record an attempt; return retry-after seconds when the key is over the limit, else None."""
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.max_hits:
                return max(1, int(self.window - (now - q[0])) + 1)
            q.append(now)
            return None

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


def _ip(request: Request) -> str:
    # On Vercel the platform proxy sets these headers (clients cannot spoof x-vercel-forwarded-for there).
    if os.environ.get("VERCEL"):
        for h in ("x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"):
            v = request.headers.get(h)
            if v:
                return v.split(",")[0].strip()
    return client_ip(request)


def _ip_hash(request: Request, ip: str) -> str:
    key = (request.app.state.settings.jwt_secret or "fos").encode()
    return hmac.new(key, ip.encode(), hashlib.sha256).hexdigest()


def _accepted_silently() -> JSONResponse:
    return JSONResponse({"ok": True}, status_code=202)


@router.post("/leads", status_code=201, summary="Website demo request (public)")
def create_lead(body: LeadIn, request: Request, db: Session = Depends(get_db)):
    ip_hash = _ip_hash(request, _ip(request))
    retry = request.app.state.lead_limiter.hit(ip_hash)
    if retry is not None:
        raise APIError(429, "RATE_LIMITED", "Too many requests - please try again later or e-mail us.",
                       headers={"Retry-After": str(retry)})
    if body.website or body.elapsed_ms is None or body.elapsed_ms < MIN_FORM_MS:
        return _accepted_silently()          # honeypot filled / submitted too fast: drop without telling
    lead = Lead(name=body.name, company=body.company, email=body.email, phone=body.phone, country=body.country,
                message=body.message, interest=body.interest, source_page=body.source_page, status="new",
                ip_hash=ip_hash, user_agent=(request.headers.get("user-agent") or "")[:300] or None)
    db.add(lead)
    db.flush()
    audit(db, request, None, "create", "lead", lead.id, {"interest": body.interest, "source_page": body.source_page},
          user_email="(public website)")
    db.commit()
    return {"ok": True}


@admin_router.get("", response_model=Page)
def list_leads(status: Optional[LeadStatus] = None, limit: int = Query(50, ge=1, le=500),
               offset: int = Query(0, ge=0), db: Session = Depends(get_db),
               _: User = Depends(require_roles(*ADMIN))):
    conds = [Lead.status == status] if status else []
    total = db.scalar(select(func.count(Lead.id)).where(*conds))
    rows = db.scalars(select(Lead).where(*conds).order_by(Lead.id.desc()).limit(limit).offset(offset)).all()
    return Page(items=[LeadOut.model_validate(r).model_dump(mode="json") for r in rows], total=total or 0,
                limit=limit, offset=offset)


@admin_router.put("/{lead_id}", response_model=LeadOut)
def update_lead(lead_id: int, body: LeadUpdate, request: Request, db: Session = Depends(get_db),
                user: User = Depends(require_roles(*ADMIN))):
    lead = get_or_404(db, Lead, lead_id, "Lead")
    if lead.status != body.status:
        audit(db, request, user, "update", "lead", lead.id, {"status": {"from": lead.status, "to": body.status}})
        lead.status = body.status
    db.commit()
    return lead
