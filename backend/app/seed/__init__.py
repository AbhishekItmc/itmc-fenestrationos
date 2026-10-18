"""Idempotent seeding: demo catalogue revision (always, when none exists), demo users (SEED_DEMO_USERS=1)
and clearly fictitious demo customers/projects/elevations/calc run/jobs (SEED_DEMO_DATA, defaults to
SEED_DEMO_USERS). Run with `python -m app.seed`."""
from __future__ import annotations

import logging
from typing import Dict, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..engines.models import Bay, Elevation as ElevationModel, FieldFill, Nesting2DRequest, Piece2D, Sheet2D
from ..models import (CalcRun, Customer, CuttingJob, Elevation, NestingJob, Part, ProductionOrder, Project,
                      PurchaseOrder, User)
from ..security import hash_password
from ..services.catalogue import ensure_design_check_params, ensure_seed_catalogue
from ..services.jobs import apply_cutting_result, cutting_requests_from_calc, run_calc, run_cutting, run_nesting

log = logging.getLogger("fos.seed")

DEMO_USERS = [("admin@demo.local", "Demo Admin", "admin"), ("engineer@demo.local", "Demo Engineer", "engineer"),
              ("estimator@demo.local", "Demo Estimator", "estimator"), ("viewer@demo.local", "Demo Viewer", "viewer"),
              ("operator@demo.local", "Demo Operator", "operator")]

DEMO_CUSTOMERS = [
    {"name": "Demo Developer Pvt Ltd (fictitious)", "contact_name": "A. Example (fictitious)",
     "email": "contact@developer.example", "phone": "+00 000 000 0000", "address": "1 Example Road, Demo City",
     "notes": "Fictitious demo customer."},
    {"name": "Demo Retail Holdings (fictitious)", "contact_name": "B. Sample (fictitious)",
     "email": "projects@retail.example", "address": "22 Sample Street, Demo Town", "notes": "Fictitious demo customer."},
]


def _lobby() -> ElevationModel:
    return ElevationModel(name="E1 Lobby 4-bay", width=6000, height=3600, mullions=[0, 1500, 3000, 4500, 6000],
                          bays=[Bay(transoms=[1100, 2400]) for _ in range(4)], system_id="ser-cw50",
                          colour_id="col-ral7016", default_glass_type_id="gl-dgu-24", anchor_levels=[0, 3600])


def _entrance() -> ElevationModel:
    return ElevationModel(name="E2 Lobby entrance", width=4500, height=3600, mullions=[0, 1500, 3000, 4500],
                          bays=[Bay(transoms=[2400]) for _ in range(3)], system_id="ser-cw50",
                          colour_id="col-ral7016", default_glass_type_id="gl-dgu-24", anchor_levels=[0, 3600],
                          fills={f"b{b}-f0": FieldFill(type="glass", glass_type_id="gl-dgu-lam-3152")
                                 for b in range(3)})


def _floor_band() -> ElevationModel:
    fills: Dict[str, FieldFill] = {}
    for b in range(6):
        fills[f"b{b}-f0"] = FieldFill(type="spandrel", glass_type_id="gl-spandrel-6", note="slab edge spandrel")
        fills[f"b{b}-f2"] = FieldFill(type="panel", panel_type_id="pnl-ins-25", note="ceiling void panel")
    return ElevationModel(name="Typical office floor band", width=9000, height=4200,
                          mullions=[0, 1500, 3000, 4500, 6000, 7500, 9000],
                          bays=[Bay(transoms=[900, 3300]) for _ in range(6)], system_id="ser-cw65",
                          colour_id="col-ano-nat", default_glass_type_id="gl-dgu-28", anchor_levels=[0, 4200],
                          fills=fills, quantity=8)


def _shopfront() -> ElevationModel:
    return ElevationModel(name="Shopfront S1", width=7500, height=3000,
                          mullions=[0, 1500, 3000, 4500, 6000, 7500], bays=[Bay(transoms=[2400]) for _ in range(5)],
                          system_id="ser-cw50", colour_id="col-ral9010", default_glass_type_id="gl-lam-1352",
                          anchor_levels=[0, 3000])


DEMO_PROJECTS = [
    {"code": "DEMO-P001", "name": "Corporate Lobby — Tower A (fictitious)", "customer": 0,
     "site": "Plot 0, Demo City (fictitious)", "status": "design", "elevations": [_lobby, _entrance],
     "description": "Demo project with fictitious data for evaluation."},
    {"code": "DEMO-P002", "name": "Office Floor Band — Block B (fictitious)", "customer": 0,
     "site": "Demo Business Park (fictitious)", "status": "quoted", "elevations": [_floor_band],
     "description": "Typical floor band, 8 identical floors. Demo data."},
    {"code": "DEMO-P003", "name": "Retail Shopfront (fictitious)", "customer": 1, "site": "Demo Mall (fictitious)",
     "status": "enquiry", "elevations": [_shopfront], "description": "Demo enquiry."},
]


def seed_users(db: Session, password: str) -> Dict[str, User]:
    out = {}
    for email, name, role in DEMO_USERS:
        u = db.scalars(select(User).where(User.email == email)).first()
        if u is None:
            u = User(email=email, name=name, role=role, hashed_password=hash_password(password), active=True)
            db.add(u)
            db.flush()
            log.info("seeded demo user", extra={"email": email, "role": role})
        out[role] = u
    return out


def seed_demo_data(db: Session, owner: Optional[User]) -> None:
    customers = []
    for c in DEMO_CUSTOMERS:
        row = db.scalars(select(Customer).where(Customer.name == c["name"])).first()
        if row is None:
            row = Customer(**c, demo=True, created_by=owner.id if owner else None)
            db.add(row)
            db.flush()
        customers.append(row)
    from ..services.catalogue import get_catalogue
    cat = get_catalogue(db)
    for spec in DEMO_PROJECTS:
        p = db.scalars(select(Project).where(Project.code == spec["code"])).first()
        if p is not None:
            continue
        p = Project(code=spec["code"], name=spec["name"], customer_id=customers[spec["customer"]].id,
                    site=spec["site"], status=spec["status"], description=spec["description"],
                    owner_id=owner.id if owner else None, demo=True)
        db.add(p)
        db.flush()
        elevs = []
        for fn in spec["elevations"]:
            m = fn()
            e = Elevation(project_id=p.id, name=m.name, data=m.model_dump(mode="json"), version=1,
                          created_by=owner.id if owner else None, updated_by=owner.id if owner else None)
            db.add(e)
            db.flush()
            e.data = {**e.data, "id": str(e.id)}
            elevs.append(e)
        log.info("seeded demo project", extra={"code": p.code})
        if spec["code"] == "DEMO-P001" and owner is not None:
            _seed_jobs(db, p, elevs[0], cat, owner)


def _seed_jobs(db: Session, p: Project, e: Elevation, cat, owner: User) -> None:
    run = run_calc(db, e, cat, owner)
    if db.scalars(select(CuttingJob.id).where(CuttingJob.source_calc_run_id == run.id)).first() is None:
        for it in cutting_requests_from_calc(run, cat, {}):
            job = CuttingJob(project_id=p.id, name=f"CR{run.id} {it['profile_code']}",
                             request=it["request"].model_dump(mode="json"), source_calc_run_id=run.id,
                             profile_id=it["profile_id"], demo=True, created_by=owner.id)
            db.add(job)
            db.flush()
            apply_cutting_result(job, run_cutting(it["request"]))
    # glass nesting job from the calc run glass list on a demo stock sheet size
    res = run.result
    pieces = [Piece2D(id=g["mark"], label=g["description"], width=g["width"], height=g["height"],
                      quantity=g["quantity"], can_rotate=True) for g in res["glass_items"]]
    if pieces:
        req = Nesting2DRequest(sheets=[Sheet2D(id="DEMO-SHEET-3210x2250", label="Demo stock sheet (not supplier data)",
                                               width=3210, height=2250)], pieces=pieces, kerf=0.0,
                               min_residual_width=300, min_residual_height=300)
        job = NestingJob(project_id=p.id, name=f"CR{run.id} glass", request=req.model_dump(mode="json"),
                         source_calc_run_id=run.id, demo=True, created_by=owner.id)
        db.add(job)
        db.flush()
        apply_cutting_result(job, run_nesting(req))
    db.flush()


def seed_v02(db: Session, owner: Optional[User], operator: Optional[User]) -> None:
    """Demo work order (parts partly advanced through stations) + one demo purchase order for DEMO-P001's
    seeded calc run. Idempotent: skipped when the project already has a work order / purchase order."""
    from ..services import production as prod
    from ..services import purchasing as purch
    from ..services.catalogue import get_catalogue
    if owner is None:
        return
    p = db.scalars(select(Project).where(Project.code == "DEMO-P001")).first()
    if p is None:
        return
    run = db.scalars(select(CalcRun).where(CalcRun.project_id == p.id, CalcRun.validation_status != "INVALID")
                     .order_by(CalcRun.id)).first()
    if run is None:
        return
    cat = get_catalogue(db)
    if db.scalars(select(ProductionOrder.id).where(ProductionOrder.project_id == p.id)).first() is None:
        order = prod.create_order(db, p.id, "Lobby E1 — fabrication (demo)", [run.id], cat, owner,
                                  notes="Demo work order (fictitious). Parts partly advanced for the board.",
                                  status="released")
        parts = db.scalars(select(Part).where(Part.production_order_id == order.id).order_by(Part.id)).all()
        who = operator or owner
        profiles = [x for x in parts if x.kind == "profile"]
        fills = [x for x in parts if x.kind != "profile"]

        def walk(part: Part, steps: int, finish_with_start: bool = False) -> None:
            for _ in range(steps):
                prod.apply_event(db, part, order, part.current_station, "complete", None, who)
            if finish_with_start and part.status == "pending":
                prod.apply_event(db, part, order, part.current_station, "start", None, who)

        n = len(profiles)
        for i, part in enumerate(profiles):
            if i < n * 0.10:
                walk(part, len(part.route))                       # dispatched
            elif i < n * 0.25:
                walk(part, 3)                                     # cut, machined, assembled -> at QC
            elif i < n * 0.45:
                walk(part, 1, finish_with_start=i % 2 == 0)       # cut; machining pending / in progress
            elif i < n * 0.60:
                prod.apply_event(db, part, order, "cutting", "start", None, who)
        if profiles:
            blk = profiles[-1]
            prod.apply_event(db, blk, order, blk.current_station, "block",
                             "Demo: profile bar damaged in transport — awaiting replacement (fictitious)", who)
        for i, part in enumerate(fills):
            if i < len(fills) * 0.5:
                walk(part, 1, finish_with_start=i % 3 == 0)       # glass received; glazing pending / started
        db.flush()
        log.info("seeded demo production order", extra={"number": order.number, "parts": len(parts)})
    if db.scalars(select(PurchaseOrder.id).where(PurchaseOrder.project_id == p.id)).first() is None:
        jobs = db.scalars(select(CuttingJob).where(CuttingJob.source_calc_run_id == run.id)
                          .order_by(CuttingJob.id)).all()
        jobs = [j for j in jobs if j.result is not None and j.validation_status != "INVALID"]
        pos = purch.create_from_calc(db, p.id, [run], jobs, cat, False, owner)
        for po in pos:
            po.notes = purch.DEMO_NOTE + "\nDemo purchase order (fictitious supplier not assigned)."
        db.flush()
        log.info("seeded demo purchase order", extra={"numbers": [po.number for po in pos]})


def run_seed(db: Session, settings) -> dict:
    rev, created = ensure_seed_catalogue(db)
    out = {"catalogue_version": rev.version, "catalogue_created": created, "users": 0, "demo_data": False}
    upgraded = ensure_design_check_params(db)
    if upgraded is not None:
        from ..services.audit import audit
        out["catalogue_version"] = upgraded.version
        out["catalogue_upgraded"] = True
        audit(db, None, None, "upgrade", "catalogue", upgraded.version, {"note": upgraded.note},
              user_email="system")
    users = {}
    if settings.seed_demo_users:
        users = seed_users(db, settings.demo_password)
        out["users"] = len(users)
    if settings.demo_data_enabled:
        seed_demo_data(db, users.get("admin") or users.get("engineer"))
        seed_v02(db, users.get("admin") or users.get("engineer"), users.get("operator"))
        out["demo_data"] = True
    if created:  # first seed of this database
        from ..services.audit import audit
        audit(db, None, None, "seed", "system", None, out, user_email="system")
    db.commit()
    return out
