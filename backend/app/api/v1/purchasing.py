"""Purchasing endpoints (ARCHITECTURE §8.2). Demo prices: every purchase order is provisional."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...db import get_db
from ...errors import APIError
from ...models import Project, PurchaseOrder, User
from ...schemas import PurchaseFromCalcIn, PurchaseOrderOut, PurchaseOrderUpdate
from ...security import ANY, PURCHASING, require_roles
from ...services import purchasing as svc
from ...services.audit import audit
from ...services.catalogue import get_catalogue
from ...services.production import load_runs
from ..deps import ensure_project_write, get_or_404

router = APIRouter(tags=["purchasing"])


@router.post("/projects/{project_id}/purchase-orders/from-calc", response_model=List[PurchaseOrderOut],
             status_code=201, summary="Purchase orders from calc runs (+ cutting jobs) minus available stock")
def from_calc(project_id: int, body: PurchaseFromCalcIn, request: Request, db: Session = Depends(get_db),
              user: User = Depends(require_roles(*PURCHASING))):
    p = get_or_404(db, Project, project_id, "Project")
    ensure_project_write(db, p, user)
    run_ids = list(dict.fromkeys(body.calc_run_ids))
    job_ids = list(dict.fromkeys(body.cutting_job_ids or []))
    cat = get_catalogue(db)
    for attempt in range(5):
        try:
            runs = load_runs(db, p.id, run_ids)
            jobs = svc.load_jobs(db, p.id, job_ids) if job_ids else []
            pos = svc.create_from_calc(db, p.id, runs, jobs, cat, body.split_by_category, user)
            for po in pos:
                audit(db, request, user, "create", "purchase_order", po.id,
                      {"number": po.number, "category": po.category, "total": po.total, "calc_run_ids": run_ids,
                       "cutting_job_ids": job_ids, "lines": len(po.lines)})
            db.commit()
            return pos
        except IntegrityError:
            db.rollback()
    raise APIError(409, "NUMBER_CONFLICT", "Could not allocate a purchase order number; retry")


@router.get("/purchase-orders", response_model=List[PurchaseOrderOut])
def list_pos(project_id: Optional[int] = None, db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    q = select(PurchaseOrder).order_by(PurchaseOrder.id.desc())
    if project_id is not None:
        q = q.where(PurchaseOrder.project_id == project_id)
    return db.scalars(q).all()


@router.get("/purchase-orders/{po_id}", response_model=PurchaseOrderOut)
def get_po(po_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    return get_or_404(db, PurchaseOrder, po_id, "Purchase order")


@router.put("/purchase-orders/{po_id}", response_model=PurchaseOrderOut)
def update_po(po_id: int, body: PurchaseOrderUpdate, request: Request, db: Session = Depends(get_db),
              user: User = Depends(require_roles(*PURCHASING))):
    po = get_or_404(db, PurchaseOrder, po_id, "Purchase order")
    ensure_project_write(db, db.get(Project, po.project_id), user)
    changes = body.model_dump(exclude_unset=True)
    changes = {k: v for k, v in changes.items() if v is not None}
    if changes.get("status") == "received":
        raise APIError(409, "INVALID_TRANSITION", "Use POST /purchase-orders/{id}/receive to receive an order "
                                                  "(adds the quantities to inventory)")
    if po.status in ("received", "cancelled") and set(changes) - {"notes"}:
        raise APIError(409, "INVALID_TRANSITION", f"Purchase order {po.number} is {po.status}; only notes can change")
    detail = {k: v for k, v in changes.items() if k != "lines"}
    if "lines" in changes:
        lines, total = svc.recompute([dict(ln) for ln in changes.pop("lines")])
        po.lines, po.total = lines, total
        detail.update({"lines": len(lines), "total": total})
    if "notes" in changes and svc.DEMO_NOTE not in changes["notes"]:
        changes["notes"] = svc.DEMO_NOTE + "\n" + changes["notes"]
    for k, v in changes.items():
        setattr(po, k, v)
    audit(db, request, user, "update", "purchase_order", po.id, detail)
    db.commit()
    return po


@router.post("/purchase-orders/{po_id}/receive", response_model=PurchaseOrderOut,
             summary="Mark received and add the ordered quantities to inventory")
def receive_po(po_id: int, request: Request, db: Session = Depends(get_db),
               user: User = Depends(require_roles(*PURCHASING))):
    po = get_or_404(db, PurchaseOrder, po_id, "Purchase order")
    ensure_project_write(db, db.get(Project, po.project_id), user)
    items = svc.receive(db, po, user)
    audit(db, request, user, "receive", "purchase_order", po.id,
          {"number": po.number, "inventory_item_ids": [i.id for i in items]})
    db.commit()
    return po
