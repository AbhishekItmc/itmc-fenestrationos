"""Production tracking endpoints (ARCHITECTURE §8.1)."""
from __future__ import annotations

from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...db import get_db
from ...errors import APIError, not_found
from ...models import Part, PartEvent, ProductionOrder, Project, User
from ...schemas import (
    BoardOut,
    PartDetailOut,
    PartEventIn,
    PartOut,
    ProductionOrderCreate,
    ProductionOrderOut,
    ProductionOrderUpdate,
)
from ...security import ANY, ENGINEERING, SHOP_FLOOR, require_roles
from ...services import production as svc
from ...services.audit import audit
from ...services.catalogue import get_catalogue
from ..deps import ensure_project_write, get_or_404

router = APIRouter(tags=["production"])


def order_out(db: Session, o: ProductionOrder, counts=None) -> ProductionOrderOut:
    out = ProductionOrderOut.model_validate(o)
    out.counts = (counts or svc.counts_for(db, [o.id]))[o.id]
    return out


@router.get("/production-orders", response_model=List[ProductionOrderOut])
def list_orders(project_id: Optional[int] = None, db: Session = Depends(get_db),
                _: User = Depends(require_roles(*ANY))):
    q = select(ProductionOrder).order_by(ProductionOrder.id.desc())
    if project_id is not None:
        q = q.where(ProductionOrder.project_id == project_id)
    orders = db.scalars(q).all()
    counts = svc.counts_for(db, [o.id for o in orders])
    return [order_out(db, o, counts) for o in orders]


@router.post("/production-orders", response_model=ProductionOrderOut, status_code=201,
             summary="Create a work order from calc runs (one tracked part per physical piece)")
def create_order(body: ProductionOrderCreate, request: Request, db: Session = Depends(get_db),
                 user: User = Depends(require_roles(*ENGINEERING))):
    p = get_or_404(db, Project, body.project_id, "Project")
    ensure_project_write(db, p, user)
    ids = list(dict.fromkeys(body.calc_run_ids))
    cat = get_catalogue(db)
    for attempt in range(5):   # number / code races -> unique constraint -> retry whole allocation
        try:
            o = svc.create_order(db, p.id, body.name, ids, cat, user, body.due_date, body.notes)
            n = svc.counts_for(db, [o.id])[o.id]["total"]
            audit(db, request, user, "create", "production_order", o.id,
                  {"number": o.number, "project_id": p.id, "calc_run_ids": ids, "parts": n})
            db.commit()
            return order_out(db, o)
        except IntegrityError:
            db.rollback()
    raise APIError(409, "NUMBER_CONFLICT", "Could not allocate a work order number / part codes; retry")


@router.get("/production-orders/{order_id}", response_model=ProductionOrderOut)
def get_order(order_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    return order_out(db, get_or_404(db, ProductionOrder, order_id, "Production order"))


@router.put("/production-orders/{order_id}", response_model=ProductionOrderOut)
def update_order(order_id: int, body: ProductionOrderUpdate, request: Request, db: Session = Depends(get_db),
                 user: User = Depends(require_roles(*ENGINEERING))):
    o = get_or_404(db, ProductionOrder, order_id, "Production order")
    ensure_project_write(db, db.get(Project, o.project_id), user)
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is None:
        changes.pop("name")
    if "status" in changes and changes["status"] is None:
        changes.pop("status")
    for k, v in changes.items():
        setattr(o, k, v)
    audit(db, request, user, "update", "production_order", o.id,
          {k: (str(v) if k == "due_date" and v is not None else v) for k, v in changes.items()})
    db.commit()
    return order_out(db, o)


@router.get("/production-orders/{order_id}/parts", response_model=List[PartOut])
def list_parts(order_id: int, status: Optional[Literal["pending", "in_progress", "done", "blocked"]] = None,
               station: Optional[str] = None, kind: Optional[Literal["profile", "glass", "panel"]] = None,
               limit: int = Query(20000, ge=1, le=50000), offset: int = Query(0, ge=0),
               db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    get_or_404(db, ProductionOrder, order_id, "Production order")
    q = select(Part).where(Part.production_order_id == order_id)
    if status:
        q = q.where(Part.status == status)
    if station:
        q = q.where(Part.current_station == station)
    if kind:
        q = q.where(Part.kind == kind)
    return db.scalars(q.order_by(Part.id).limit(limit).offset(offset)).all()


@router.get("/production-orders/{order_id}/board", response_model=BoardOut,
            summary="Per-station counts: pending / in progress / blocked at the station, done_here = passed it")
def order_board(order_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    get_or_404(db, ProductionOrder, order_id, "Production order")
    return svc.board(db, order_id)


def _part_by_code(db: Session, code: str) -> Part:
    code = code.strip().upper()
    part = db.scalars(select(Part).where(Part.code == code)).first() if svc.is_valid_code(code) else None
    if part is None:
        raise not_found("Part", code)
    return part


def part_detail(db: Session, part: Part) -> dict:
    o = db.get(ProductionOrder, part.production_order_id)
    p = db.get(Project, o.project_id)
    events = db.scalars(select(PartEvent).where(PartEvent.part_id == part.id)
                        .order_by(PartEvent.ts, PartEvent.id)).all()
    return {"part": PartOut.model_validate(part), "order": {"id": o.id, "number": o.number, "name": o.name},
            "project": {"id": p.id, "code": p.code, "name": p.name}, "events": events}


@router.get("/parts/{code}", response_model=PartDetailOut, summary="Part by scan code (with order, project, events)")
def get_part(code: str, db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    return part_detail(db, _part_by_code(db, code))


@router.post("/parts/{code}/events", response_model=PartOut,
             summary="Station scan event: start | complete | block (note) | unblock | note",
             responses={409: {"description": "INVALID_TRANSITION"}})
def post_event(code: str, body: PartEventIn, request: Request, db: Session = Depends(get_db),
               user: User = Depends(require_roles(*SHOP_FLOOR))):
    part = _part_by_code(db, code)
    order = db.get(ProductionOrder, part.production_order_id)
    ev, change = svc.apply_event(db, part, order, body.station, body.action, body.note, user)
    audit(db, request, user, f"part_{body.action}", "part", part.code,
          {"station": body.station, "note": ev.note, "production_order_id": order.id, "order_number": order.number,
           "event_id": ev.id, **change, "order_status": order.status})
    db.commit()
    return part
