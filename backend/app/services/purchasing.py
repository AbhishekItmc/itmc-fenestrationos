"""Purchasing (ARCHITECTURE §8.2): purchase orders from calc-run BOMs (and optionally cutting jobs) minus available
stock. Demo prices -> every PO is provisional.

Quantities
* profiles: whole **bars** per (profile code, stock length). With cutting jobs: Σ pattern.count per stock length of
  non-inventory stock (bars cut from INV-<id> stock are already in stock). Without: estimate
  ceil(total cut length / longest catalogue stock length) — note "estimate, run cutting for exact bars".
* glass / panels: m² (required = BOM area); ordered in whole m² (rounded up).
* accessories: catalogue unit (pcs / m); ordered rounded up to whole units.
* qty_in_stock = available non-residual inventory of the same code (bars: same length; m²: sheet areas + m² items;
  accessories: items in the same unit). qty_to_order = max(0, required − in stock) (rounded up as above).
Receiving adds the ordered quantities to inventory: bars (kind=bar), m² and accessory items (kind=item, unit).
"""
from __future__ import annotations

import math
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..engines.catalogue import (
    get_accessory,
    get_glass_type,
    get_panel_type,
    get_profile,
)
from ..engines.models import CalcResult, Cutting1DResult
from ..errors import APIError
from ..models import CalcRun, CuttingJob, InventoryItem, PurchaseOrder, User
from .production import next_number

DEMO_NOTE = "Demo prices — not a commercial offer"
ESTIMATE_NOTE = "estimate, run cutting for exact bars"
ACCESSORY_TYPES = {"accessory", "hardware", "gasket", "sealant", "bracket", "connector"}
CATEGORY_OF = {"profile": "profiles", "glass": "glass", "panel": "glass"}
LEN_TOL = 0.5  # mm, bar length match tolerance against inventory


def r2(x: float) -> float:
    return round(x + 0.0, 2)


def _ceil(x: float) -> int:
    return int(math.ceil(x - 1e-9)) if x > 0 else 0


def category(item_type: str) -> str:
    return CATEGORY_OF.get(item_type, "accessories")


# --------------------------------------------------------------------------- stock lookups
def _avail(db: Session, kind: str):
    return select(InventoryItem).where(InventoryItem.kind == kind, InventoryItem.status == "available",
                                       InventoryItem.is_residual.is_(False), InventoryItem.quantity > 0)


def stock_bars(db: Session, code: str, length: float) -> int:
    items = db.scalars(_avail(db, "bar").where((InventoryItem.profile_code == code) |
                                               (InventoryItem.material == code))).all()
    return sum(it.quantity for it in items if it.length and abs(it.length - length) <= LEN_TOL)


def stock_area_m2(db: Session, code: str) -> float:
    a = 0.0
    for it in db.scalars(_avail(db, "sheet").where(InventoryItem.material == code)).all():
        if it.width and it.height:
            a += it.width * it.height / 1e6 * it.quantity
    for it in db.scalars(_avail(db, "item").where(InventoryItem.material == code,
                                                  InventoryItem.unit == "m2")).all():
        a += it.quantity
    return a


def stock_items(db: Session, code: str, unit: str) -> float:
    return float(sum(it.quantity for it in db.scalars(_avail(db, "item").where(
        InventoryItem.material == code, InventoryItem.unit == unit)).all()))


# --------------------------------------------------------------------------- requirements
def _bars_from_jobs(jobs: List[CuttingJob]) -> "OrderedDict[Tuple[str, float], Dict[str, Any]]":
    out: "OrderedDict[Tuple[str, float], Dict[str, Any]]" = OrderedDict()
    for job in jobs:
        res = Cutting1DResult.model_validate(job.result)
        code = res.request.material or job.profile_id or f"job-{job.id}"
        for p in res.patterns:
            if p.is_offcut_stock or p.stock_id.startswith("INV-"):
                continue
            key = (code, float(p.stock_length))
            d = out.setdefault(key, {"bars": 0, "jobs": [], "profile_id": job.profile_id})
            d["bars"] += p.count
            if job.id not in d["jobs"]:
                d["jobs"].append(job.id)
    return out


def build_lines(db: Session, runs: List[CalcRun], jobs: List[CuttingJob], cat: Dict[str, Any]) -> List[Dict[str, Any]]:
    bom: "OrderedDict[Tuple[str, str, str], Dict[str, Any]]" = OrderedDict()
    for run in runs:
        res = CalcResult.model_validate(run.result)
        for b in res.bom:
            key = (b.item_type, b.item_id, b.unit)
            d = bom.setdefault(key, {"item_type": b.item_type, "item_id": b.item_id, "code": b.code,
                                     "description": b.description.split(" (bar lower-bound")[0], "unit": b.unit,
                                     "quantity": 0.0})
            d["quantity"] += b.quantity
    lines: List[Dict[str, Any]] = []
    # profiles: exact bars from cutting jobs for the codes they cover, estimate for the rest
    job_bars = _bars_from_jobs(jobs)
    covered = {code for code, _ in job_bars}
    for (code, L), d in job_bars.items():
        prof = get_profile(cat, d["profile_id"]) if d["profile_id"] else None
        if prof is None:
            prof = next((p for p in cat.get("profiles", []) if p.get("code") == code), None)
        lines.append(_profile_line(db, prof, code, L, d["bars"],
                                   f"from cutting job(s) {', '.join(str(j) for j in d['jobs'])}"))
    for (itype, iid, unit), d in bom.items():
        if itype != "profile" or d["code"] in covered:
            continue
        prof = get_profile(cat, iid)
        lengths = [float(x) for x in (prof or {}).get("stock_lengths") or []]
        total_mm = d["quantity"] * (1000.0 if unit == "m" else 1.0)
        if not lengths:
            lines.append({"item_type": "profile", "item_id": iid, "code": d["code"], "description": d["description"],
                          "unit": "bar", "qty_required": 0, "qty_in_stock": 0, "qty_to_order": 0, "unit_price": 0.0,
                          "amount": 0.0, "stock_length": None,
                          "note": "no stock lengths in catalogue — quantity not computed"})
            continue
        L = max(lengths)
        lines.append(_profile_line(db, prof, d["code"], L, _ceil(total_mm / L),
                                   f"{ESTIMATE_NOTE} (total {total_mm / 1000:,.2f} m / {L:g} mm bars)"))
    for (itype, iid, unit), d in bom.items():
        if itype == "profile":
            continue
        req = round(d["quantity"], 4)
        if itype in ("glass", "panel"):
            item = (get_glass_type if itype == "glass" else get_panel_type)(cat, iid)
            price = (item or {}).get("price_per_m2")
            have = round(stock_area_m2(db, d["code"]), 4)
            note = "ordered in whole m² (demo)"
        else:
            item = get_accessory(cat, iid)
            price = (item or {}).get("price")
            have = stock_items(db, d["code"], unit)
            note = None
        order = _ceil(max(0.0, req - have))
        lines.append({"item_type": itype, "item_id": iid, "code": d["code"], "description": d["description"],
                      "unit": unit, "qty_required": req, "qty_in_stock": have, "qty_to_order": order,
                      "unit_price": float(price) if price is not None else 0.0,
                      "amount": r2(order * float(price or 0.0)), "stock_length": None,
                      "note": note if price is not None else ((note + "; " if note else "") + "no demo price")})
    return lines


def _profile_line(db: Session, prof: Optional[Dict[str, Any]], code: str, L: float, bars: int,
                  note: str) -> Dict[str, Any]:
    have = stock_bars(db, code, L)
    order = max(0, bars - have)
    ppm = (prof or {}).get("price_per_m")
    unit_price = r2(float(ppm) * L / 1000.0) if ppm is not None else 0.0
    return {"item_type": "profile", "item_id": (prof or {}).get("id"), "code": code,
            "description": f"{(prof or {}).get('name', code)} — bar {L:g} mm", "unit": "bar",
            "qty_required": bars, "qty_in_stock": have, "qty_to_order": order, "unit_price": unit_price,
            "amount": r2(order * unit_price), "stock_length": L,
            "note": note if ppm is not None else note + "; no demo price"}


def recompute(lines: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], float]:
    for i, ln in enumerate(lines, 1):
        ln["line_no"] = i
        ln["amount"] = r2(float(ln.get("qty_to_order") or 0) * float(ln.get("unit_price") or 0))
    return lines, r2(sum(ln["amount"] for ln in lines))


def load_jobs(db: Session, project_id: int, ids: List[int]) -> List[CuttingJob]:
    jobs = db.scalars(select(CuttingJob).where(CuttingJob.id.in_(ids), CuttingJob.project_id == project_id)).all()
    found = {j.id for j in jobs}
    missing = [i for i in ids if i not in found]
    if missing:
        raise APIError(404, "CUTTING_JOB_NOT_FOUND", f"Cutting job(s) {missing} not found in project {project_id}")
    for j in jobs:
        if j.result is None:
            raise APIError(400, "JOB_NOT_OPTIMISED", f"Cutting job {j.id} has no result yet")
        if j.validation_status == "INVALID":
            raise APIError(400, "JOB_INVALID", f"Cutting job {j.id} failed independent validation")
    return sorted(jobs, key=lambda j: ids.index(j.id))


def create_from_calc(db: Session, project_id: int, runs: List[CalcRun], jobs: List[CuttingJob], cat: Dict[str, Any],
                     split: bool, user: User) -> List[PurchaseOrder]:
    lines = build_lines(db, runs, jobs, cat)
    groups: "OrderedDict[str, List[Dict[str, Any]]]" = OrderedDict()
    for cat_name in ("profiles", "glass", "accessories"):
        sel = [ln for ln in lines if category(ln["item_type"]) == cat_name]
        if sel:
            groups.setdefault(cat_name if split else "mixed", []).extend(sel)
    if not groups:
        raise APIError(400, "NOTHING_TO_ORDER", "The calc runs have no BOM lines")
    pos = []
    for cat_name, ls in groups.items():
        ls, total = recompute(ls)
        po = PurchaseOrder(number=next_number(db, PurchaseOrder, "PO"), project_id=project_id,
                           supplier="To be assigned", category=cat_name, status="draft",
                           currency=str(cat.get("currency", "INR")), lines=ls, total=total, provisional=True,
                           calc_run_ids=[r.id for r in runs], cutting_job_ids=[j.id for j in jobs],
                           catalogue_version=str(cat.get("catalogue_version")), notes=DEMO_NOTE, created_by=user.id)
        db.add(po)
        db.flush()
        pos.append(po)
    return pos


def receive(db: Session, po: PurchaseOrder, user: User) -> List[InventoryItem]:
    if po.status not in ("draft", "sent"):
        raise APIError(409, "INVALID_TRANSITION", f"Purchase order {po.number} is {po.status}; only draft/sent "
                                                  f"orders can be received")
    items = []
    for ln in po.lines:
        q = ln.get("qty_to_order") or 0
        qi = _ceil(float(q))
        if qi <= 0:
            continue
        note = f"Received on {po.number} line {ln.get('line_no')}"
        if ln.get("item_type") == "profile":
            if not ln.get("stock_length"):
                continue
            it = InventoryItem(kind="bar", material=ln["code"], profile_code=ln["code"],
                               length=float(ln["stock_length"]), quantity=qi)
        else:
            it = InventoryItem(kind="item", material=ln["code"], unit=ln.get("unit"), quantity=qi)
        it.is_residual = False
        it.status = "available"
        it.source_kind = "purchase"
        it.source_job_id = po.id
        it.demo = True
        it.notes = note
        it.created_by = user.id
        db.add(it)
        items.append(it)
    po.status = "received"
    po.received_at = datetime.now(timezone.utc)
    db.flush()
    return items
