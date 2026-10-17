"""Stock & reusable residual inventory: residuals from optimisation jobs, export as optimiser stock, consumption."""
from __future__ import annotations

from typing import Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..engines.models import Cutting1DResult, Nesting2DResult, Sheet2D, Stock1D
from ..errors import APIError
from ..models import CuttingJob, InventoryItem, NestingJob, User

INV_PREFIX = "INV-"


def _guard(db: Session, kind: str, job_id: int) -> None:
    exists = db.scalars(select(InventoryItem.id).where(InventoryItem.source_kind == kind,
                                                       InventoryItem.source_job_id == job_id)).first()
    if exists is not None:
        raise APIError(409, "RESIDUALS_ALREADY_ADDED", f"Residuals of {kind} job {job_id} are already in inventory")


def _usable_job(job, kind: str) -> None:
    if job.result is None:
        raise APIError(400, "JOB_NOT_OPTIMISED", f"{kind} job {job.id} has no result yet")
    if job.validation_status == "INVALID":
        raise APIError(400, "JOB_INVALID", f"{kind} job {job.id} failed independent validation; residuals blocked")


def residuals_from_cutting(db: Session, job: CuttingJob, user: User, location: Optional[str]) -> List[InventoryItem]:
    _usable_job(job, "cutting")
    _guard(db, "cutting", job.id)
    res = Cutting1DResult.model_validate(job.result)
    material = res.request.material
    agg: Dict[float, int] = {}
    for p in res.patterns:
        if p.offcut_reusable and p.remainder > 0:
            L = round(p.remainder, 1)
            agg[L] = agg.get(L, 0) + p.count
    items = []
    for L, q in sorted(agg.items(), reverse=True):
        it = InventoryItem(kind="bar", material=material, profile_code=material, length=L, quantity=q,
                           is_residual=True, source_kind="cutting", source_job_id=job.id, location=location,
                           status="available", demo=job.demo, created_by=user.id,
                           notes=f"Reusable offcut from cutting job {job.id}")
        db.add(it)
        items.append(it)
    db.flush()
    return items


def residuals_from_nesting(db: Session, job: NestingJob, user: User, location: Optional[str]) -> List[InventoryItem]:
    _usable_job(job, "nesting")
    _guard(db, "nesting", job.id)
    res = Nesting2DResult.model_validate(job.result)
    sheets = {s.id: s for s in res.request.sheets}
    agg: Dict[tuple, int] = {}
    for lay in res.layouts:
        s = sheets.get(lay.sheet_id)
        for r in lay.residuals:
            if not r.reusable:
                continue
            key = (round(r.width, 1), round(r.height, 1), s.material if s else None, s.thickness if s else None)
            agg[key] = agg.get(key, 0) + lay.count
    items = []
    for (w, h, mat, t), q in agg.items():
        it = InventoryItem(kind="sheet", material=mat, width=w, height=h, thickness=t, quantity=q, is_residual=True,
                           source_kind="nesting", source_job_id=job.id, location=location, status="available",
                           demo=job.demo, created_by=user.id, notes=f"Reusable residual from nesting job {job.id}")
        db.add(it)
        items.append(it)
    db.flush()
    return items


def query_items(db: Session, kind: Optional[str] = None, material: Optional[str] = None,
                status: Optional[str] = None, residual: Optional[bool] = None):
    q = select(InventoryItem)
    if kind:
        q = q.where(InventoryItem.kind == kind)
    if material:
        q = q.where(InventoryItem.material == material)
    if status:
        q = q.where(InventoryItem.status == status)
    if residual is not None:
        q = q.where(InventoryItem.is_residual.is_(residual))
    return q


def as_stock(db: Session, kind: str, material: Optional[str], thickness: Optional[float] = None):
    items = db.scalars(query_items(db, kind, material, "available").where(InventoryItem.quantity > 0)
                       .order_by(InventoryItem.id)).all()
    if kind == "bar":
        return [Stock1D(id=f"{INV_PREFIX}{it.id}", label=f"{'Offcut' if it.is_residual else 'Stock bar'} "
                        f"{it.length:g} mm" + (f" @ {it.location}" if it.location else ""),
                        length=it.length, quantity=it.quantity, is_offcut=it.is_residual,
                        priority=1 if it.is_residual else 0)
                for it in items if it.length]
    out = []
    for it in items:
        if not (it.width and it.height):
            continue
        if thickness is not None and it.thickness is not None and abs(it.thickness - thickness) > 1e-6:
            continue
        out.append(Sheet2D(id=f"{INV_PREFIX}{it.id}", label=f"{'Residual' if it.is_residual else 'Sheet'} "
                           f"{it.width:g}x{it.height:g}", width=it.width, height=it.height, quantity=it.quantity,
                           material=it.material, thickness=it.thickness, is_residual=it.is_residual))
    return out


def consume(db: Session, item: InventoryItem, quantity: int) -> InventoryItem:
    if item.status == "consumed" or item.quantity <= 0:
        raise APIError(409, "ALREADY_CONSUMED", f"Inventory item {item.id} is already consumed")
    if quantity > item.quantity:
        raise APIError(409, "INSUFFICIENT_QUANTITY", f"Only {item.quantity} available for inventory item {item.id}")
    item.quantity -= quantity
    if item.quantity == 0:
        item.status = "consumed"
    db.flush()
    return item


def used_inventory_counts(result: dict, kind: str) -> Dict[int, int]:
    """Count how many INV-<id> stock units an optimisation result consumed."""
    used: Dict[int, int] = {}
    entries = result.get("patterns", []) if kind == "bar" else result.get("layouts", [])
    for e in entries:
        sid = str(e.get("stock_id") if kind == "bar" else e.get("sheet_id"))
        if sid.startswith(INV_PREFIX) and sid[len(INV_PREFIX):].isdigit():
            used[int(sid[len(INV_PREFIX):])] = used.get(int(sid[len(INV_PREFIX):]), 0) + int(e.get("count", 1))
    return used


def consume_for_result(db: Session, result: dict, kind: str) -> Dict[int, int]:
    used = used_inventory_counts(result, kind)
    for inv_id, n in used.items():
        it = db.get(InventoryItem, inv_id)
        if it is None or it.kind != kind:
            raise APIError(400, "INVENTORY_ITEM_NOT_FOUND", f"Stock INV-{inv_id} is not a {kind} inventory item")
        consume(db, it, n)
    return used
