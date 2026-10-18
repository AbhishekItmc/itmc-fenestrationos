from __future__ import annotations

from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from ...db import get_db
from ...errors import APIError
from ...models import CuttingJob, InventoryItem, NestingJob, User
from ...schemas import ConsumeIn, InventoryIn, InventoryOut, InventoryUpdate, ResidualIn
from ...security import ANY, ENGINEERING, require_roles
from ...services import inventory as inv
from ...services.audit import audit
from ..deps import get_or_404

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.get("", response_model=List[InventoryOut])
def list_inventory(kind: Optional[Literal["bar", "sheet", "item"]] = None, material: Optional[str] = None,
                   status: Optional[Literal["available", "reserved", "consumed"]] = None,
                   residual: Optional[bool] = None, limit: int = Query(500, ge=1, le=5000),
                   offset: int = Query(0, ge=0), db: Session = Depends(get_db),
                   _: User = Depends(require_roles(*ANY))):
    q = inv.query_items(db, kind, material, status, residual).order_by(InventoryItem.id.desc())
    return db.scalars(q.limit(limit).offset(offset)).all()


@router.get("/as-stock", summary="Available inventory as optimiser stock (Stock1D[] or Sheet2D[])")
def inventory_as_stock(kind: Literal["bar", "sheet"], material: Optional[str] = None,
                       thickness: Optional[float] = None, db: Session = Depends(get_db),
                       _: User = Depends(require_roles(*ANY))):
    return [s.model_dump() for s in inv.as_stock(db, kind, material, thickness)]


@router.post("", response_model=InventoryOut, status_code=201)
def create_inventory(body: InventoryIn, request: Request, db: Session = Depends(get_db),
                     user: User = Depends(require_roles(*ENGINEERING))):
    if body.kind == "bar" and not body.length:
        raise APIError(422, "VALIDATION_ERROR", "Bar inventory requires 'length'")
    if body.kind == "sheet" and not (body.width and body.height):
        raise APIError(422, "VALIDATION_ERROR", "Sheet inventory requires 'width' and 'height'")
    if body.kind == "item" and not (body.material and body.unit):
        raise APIError(422, "VALIDATION_ERROR", "Item inventory requires 'material' (item code) and 'unit'")
    it =InventoryItem(**body.model_dump(), source_kind="manual", created_by=user.id)
    if it.kind == "bar" and not it.profile_code:
        it.profile_code = it.material
    db.add(it)
    db.flush()
    audit(db, request, user, "create", "inventory", it.id, body.model_dump())
    db.commit()
    return it


@router.get("/{item_id}", response_model=InventoryOut)
def get_inventory(item_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    return get_or_404(db, InventoryItem, item_id, "Inventory item")


@router.put("/{item_id}", response_model=InventoryOut)
def update_inventory(item_id: int, body: InventoryUpdate, request: Request, db: Session = Depends(get_db),
                     user: User = Depends(require_roles(*ENGINEERING))):
    it = get_or_404(db, InventoryItem, item_id, "Inventory item")
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(it, k, v)
    audit(db, request, user, "update", "inventory", it.id, changes)
    db.commit()
    return it


@router.delete("/{item_id}", status_code=204)
def delete_inventory(item_id: int, request: Request, db: Session = Depends(get_db),
                     user: User = Depends(require_roles(*ENGINEERING))):
    it = get_or_404(db, InventoryItem, item_id, "Inventory item")
    db.delete(it)
    audit(db, request, user, "delete", "inventory", item_id, {"kind": it.kind, "material": it.material})
    db.commit()
    return Response(status_code=204)


@router.post("/{item_id}/consume", response_model=InventoryOut)
def consume_inventory(item_id: int, request: Request, body: ConsumeIn | None = None, db: Session = Depends(get_db),
                      user: User = Depends(require_roles(*ENGINEERING))):
    body = body or ConsumeIn()
    it = get_or_404(db, InventoryItem, item_id, "Inventory item")
    inv.consume(db, it, body.quantity)
    audit(db, request, user, "consume", "inventory", it.id, body.model_dump())
    db.commit()
    return it


@router.post("/residuals/from-cutting/{job_id}", response_model=List[InventoryOut], status_code=201)
def residuals_from_cutting(job_id: int, request: Request, body: ResidualIn | None = None,
                           db: Session = Depends(get_db), user: User = Depends(require_roles(*ENGINEERING))):
    job = get_or_404(db, CuttingJob, job_id, "Cutting job")
    items = inv.residuals_from_cutting(db, job, user, (body or ResidualIn()).location)
    audit(db, request, user, "create", "inventory_residuals", job.id,
          {"source": "cutting", "items": [i.id for i in items], "bars": sum(i.quantity for i in items)})
    db.commit()
    return items


@router.post("/residuals/from-nesting/{job_id}", response_model=List[InventoryOut], status_code=201)
def residuals_from_nesting(job_id: int, request: Request, body: ResidualIn | None = None,
                           db: Session = Depends(get_db), user: User = Depends(require_roles(*ENGINEERING))):
    job = get_or_404(db, NestingJob, job_id, "Nesting job")
    items = inv.residuals_from_nesting(db, job, user, (body or ResidualIn()).location)
    audit(db, request, user, "create", "inventory_residuals", job.id,
          {"source": "nesting", "items": [i.id for i in items], "sheets": sum(i.quantity for i in items)})
    db.commit()
    return items
