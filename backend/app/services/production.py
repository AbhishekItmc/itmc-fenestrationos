"""Production tracking (ARCHITECTURE §8.1): work orders, part explosion, unique scan codes, station events.

Routes are code constants for now (documented as configurable later). Transition rules:
  start     pending      -> in_progress           (at the part's current station)
  complete  pending|in_progress -> next station pending, or done after the last station
            (completing a pending part is an implicit start: one scan per station on the shop floor)
  block     pending|in_progress -> blocked        (note required; previous status remembered)
  unblock   blocked      -> previous status
  note      any status (station = current station, or any station of the route once done)
Anything else -> 409 INVALID_TRANSITION. Every event is stored as a PartEvent and audited.
"""
from __future__ import annotations

import secrets
from collections import Counter, OrderedDict
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..engines.catalogue import get_glass_type, get_panel_type
from ..engines.models import CalcResult
from ..errors import APIError
from ..models import CalcRun, Elevation, Part, PartEvent, ProductionOrder, User

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # A-Z 2-9 without 0/O/1/I
CODE_LEN = 8
MAX_PARTS_PER_ORDER = 20000

STATIONS: "OrderedDict[str, str]" = OrderedDict([
    ("cutting", "Cutting"), ("machining", "Machining"), ("assembly", "Assembly"), ("receiving", "Glass receiving"),
    ("glazing", "Glazing"), ("qc", "Quality check"), ("dispatch", "Dispatch")])
ROUTES: Dict[str, List[str]] = {
    "profile": ["cutting", "machining", "assembly", "qc", "dispatch"],
    "glass": ["receiving", "glazing", "qc", "dispatch"],
    "panel": ["receiving", "glazing", "qc", "dispatch"],
}
PART_STATUSES = ("pending", "in_progress", "done", "blocked")


def _invalid(msg: str) -> APIError:
    return APIError(409, "INVALID_TRANSITION", msg)


# --------------------------------------------------------------------------- numbering / codes
def next_number(db: Session, model, prefix: str, year: Optional[int] = None) -> str:
    """WO-YYYY-NNNN / PO-YYYY-NNNN (same scheme as quotes Q-YYYY-NNNN)."""
    year = year or datetime.now(timezone.utc).year
    pre = f"{prefix}-{year}-"
    nums = db.scalars(select(model.number).where(model.number.like(pre + "%"))).all()
    n = max([int(x[len(pre):]) for x in nums if x[len(pre):].isdigit()] or [0]) + 1
    return f"{pre}{n:04d}"


def random_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))


def is_valid_code(code: str) -> bool:
    return len(code) == CODE_LEN and all(c in CODE_ALPHABET for c in code)


def new_codes(db: Session, n: int, gen=None) -> List[str]:
    """n distinct codes not yet in the database (cryptographically random; collisions re-drawn)."""
    gen = gen or random_code
    out: List[str] = []
    seen: set = set()
    attempts = 0
    while len(out) < n:
        attempts += 1
        if attempts > 50:
            raise APIError(503, "CODE_SPACE_EXHAUSTED", "Could not allocate unique part codes; retry")
        batch = []
        for _ in range(n - len(out)):
            c = gen()
            if c not in seen:
                seen.add(c)
                batch.append(c)
        taken: set = set()
        for i in range(0, len(batch), 500):
            chunk = batch[i:i + 500]
            taken |= set(db.scalars(select(Part.code).where(Part.code.in_(chunk))).all())
        out += [c for c in batch if c not in taken]
    return out


# --------------------------------------------------------------------------- explosion
def explode_runs(runs: Sequence[CalcRun], cat: Dict[str, Any], elev_names: Dict[int, str]) -> List[Dict[str, Any]]:
    """One dict per physical piece. ProfileCut/GlassItem quantities already include the elevation quantity."""
    parts: List[Dict[str, Any]] = []
    for run in runs:
        res = CalcResult.model_validate(run.result)
        ename = elev_names.get(run.elevation_id or -1) or res.elevation.name
        base = {"calc_run_id": run.id, "elevation_id": run.elevation_id, "elevation_name": ename}
        for c in res.profile_cuts:
            for s in range(1, c.quantity + 1):
                parts.append({**base, "kind": "profile", "mark": c.mark, "seq": s,
                              "description": f"{c.description} — {c.role}"[:300], "item_code": c.profile_code,
                              "length": c.length, "angle_start": c.angle_start, "angle_end": c.angle_end})
        for g in res.glass_items:
            kind = "panel" if g.fill_type == "panel" else "glass"
            if kind == "panel":
                item = get_panel_type(cat, g.panel_type_id) if g.panel_type_id else None
                code = (item or {}).get("code") or g.panel_type_id
            else:
                item = get_glass_type(cat, g.glass_type_id) if g.glass_type_id else None
                code = (item or {}).get("code") or g.glass_type_id or "UNSPECIFIED"
            for s in range(1, g.quantity + 1):
                parts.append({**base, "kind": kind, "mark": g.mark, "seq": s, "description": g.description[:300],
                              "item_code": code, "width": g.width, "height": g.height, "field_key": g.field_key})
    return parts


def load_runs(db: Session, project_id: int, ids: List[int]) -> List[CalcRun]:
    runs = db.scalars(select(CalcRun).where(CalcRun.id.in_(ids), CalcRun.project_id == project_id)).all()
    found = {r.id for r in runs}
    missing = [i for i in ids if i not in found]
    if missing:
        raise APIError(404, "CALC_RUN_NOT_FOUND", f"Calc run(s) {missing} not found in project {project_id}")
    bad = [r.id for r in runs if r.validation_status == "INVALID"]
    if bad:
        raise APIError(400, "CALC_RUN_INVALID", f"Calc run(s) {bad} are INVALID and cannot be used")
    return sorted(runs, key=lambda r: ids.index(r.id))


def create_order(db: Session, project_id: int, name: str, ids: List[int], cat: Dict[str, Any], user: User,
                 due_date=None, notes: Optional[str] = None, status: str = "planned") -> ProductionOrder:
    runs = load_runs(db, project_id, ids)
    elev_ids = [r.elevation_id for r in runs if r.elevation_id]
    names = dict(db.execute(select(Elevation.id, Elevation.name).where(Elevation.id.in_(elev_ids))).all()) \
        if elev_ids else {}
    specs = explode_runs(runs, cat, names)
    if not specs:
        raise APIError(400, "NO_PARTS", "The calc runs contain no profile cuts or fills to produce")
    if len(specs) > MAX_PARTS_PER_ORDER:
        raise APIError(400, "TOO_MANY_PARTS", f"{len(specs)} parts exceed the limit of {MAX_PARTS_PER_ORDER} per "
                                              f"work order; split the calc runs over several orders")
    order = ProductionOrder(number=next_number(db, ProductionOrder, "WO"), project_id=project_id, name=name,
                            status=status, calc_run_ids=ids, due_date=due_date, notes=notes,
                            provisional=any(r.validation_status != "VALIDATED" for r in runs), created_by=user.id)
    db.add(order)
    db.flush()
    codes = new_codes(db, len(specs))
    for spec, code in zip(specs, codes):
        route = ROUTES[spec["kind"]]
        db.add(Part(production_order_id=order.id, code=code, route=list(route), station_index=0,
                    current_station=route[0], status="pending", **spec))
    db.flush()
    return order


# --------------------------------------------------------------------------- counts / board
def counts_for(db: Session, order_ids: Iterable[int]) -> Dict[int, Dict[str, int]]:
    ids = list(order_ids)
    out = {i: {"total": 0, **{s: 0 for s in PART_STATUSES}} for i in ids}
    if not ids:
        return out
    rows = db.execute(select(Part.production_order_id, Part.status, func.count(Part.id))
                      .where(Part.production_order_id.in_(ids)).group_by(Part.production_order_id, Part.status)).all()
    for oid, st, n in rows:
        out[oid][st] = out[oid].get(st, 0) + n
        out[oid]["total"] += n
    return out


def board(db: Session, order_id: int) -> Dict[str, Any]:
    rows = db.execute(select(Part.route, Part.station_index, Part.status, Part.current_station)
                      .where(Part.production_order_id == order_id)).all()
    present: set = set()
    acc: Dict[str, Counter] = {s: Counter() for s in STATIONS}
    for route, idx, status, cur in rows:
        present.update(route)
        done_upto = len(route) if status == "done" else idx
        for s in route[:done_upto]:
            acc.setdefault(s, Counter())["done_here"] += 1
        if status != "done" and cur:
            acc.setdefault(cur, Counter())[status] += 1
    stations = []
    for sid in [s for s in STATIONS if s in present] + sorted(s for s in present if s not in STATIONS):
        c = acc.get(sid, Counter())
        stations.append({"id": sid, "label": STATIONS.get(sid, sid), "pending": c["pending"],
                         "in_progress": c["in_progress"], "done_here": c["done_here"], "blocked": c["blocked"]})
    return {"stations": stations, "counts": counts_for(db, [order_id])[order_id]}


# --------------------------------------------------------------------------- events
def apply_event(db: Session, part: Part, order: ProductionOrder, station: str, action: str, note: Optional[str],
                user: User) -> Tuple[PartEvent, Dict[str, Any]]:
    note = (note or "").strip() or None
    if order.status == "cancelled":
        raise _invalid(f"Work order {order.number} is cancelled")
    if action in ("block", "note") and not note:
        raise APIError(422, "NOTE_REQUIRED", f"A note is required for '{action}'")
    before = {"status": part.status, "station": part.current_station, "station_index": part.station_index}
    if action == "note":
        if not (station == part.current_station or (part.status == "done" and station in part.route)):
            raise _invalid(f"Part {part.code} is at station '{part.current_station}', not '{station}'")
    else:
        if part.status == "done":
            raise _invalid(f"Part {part.code} is already done")
        if station != part.current_station:
            raise _invalid(f"Part {part.code} is at station '{part.current_station}', not '{station}'")
        if action == "start":
            if part.status != "pending":
                raise _invalid(f"'start' needs a pending part; {part.code} is {part.status}")
            part.status = "in_progress"
        elif action == "complete":
            if part.status not in ("pending", "in_progress"):
                raise _invalid(f"'complete' needs a pending or in-progress part; {part.code} is {part.status}")
            part.station_index += 1
            if part.station_index >= len(part.route):
                part.station_index = len(part.route)
                part.current_station = None
                part.status = "done"
            else:
                part.current_station = part.route[part.station_index]
                part.status = "pending"
        elif action == "block":
            if part.status not in ("pending", "in_progress"):
                raise _invalid(f"'block' needs a pending or in-progress part; {part.code} is {part.status}")
            part.prev_status = part.status
            part.status = "blocked"
        elif action == "unblock":
            if part.status != "blocked":
                raise _invalid(f"'unblock' needs a blocked part; {part.code} is {part.status}")
            part.status = part.prev_status if part.prev_status in ("pending", "in_progress") else "pending"
            part.prev_status = None
        else:  # pragma: no cover - schema restricts actions
            raise _invalid(f"Unknown action '{action}'")
    part.updated_at = datetime.now(timezone.utc)
    ev = PartEvent(part_id=part.id, station=station, action=action, note=note, user_id=user.id,
                   user_name=user.name or user.email)
    db.add(ev)
    db.flush()
    # order status automation
    if action in ("start", "complete") and order.status in ("planned", "released"):
        order.status = "in_progress"
    if action == "complete" and part.status == "done":
        open_parts = db.scalar(select(func.count(Part.id)).where(Part.production_order_id == order.id,
                                                                 Part.status != "done"))
        if open_parts == 0:
            order.status = "done"
    after = {"status": part.status, "station": part.current_station, "station_index": part.station_index}
    return ev, {"before": before, "after": after}
