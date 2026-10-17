from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ...db import get_db, utcnow
from ...engines.elevation import validate_elevation
from ...engines.models import Elevation as ElevationModel
from ...errors import APIError
from ...models import CalcRun, Elevation, Project, User
from ...schemas import CalcRunOut, CalculateIn, ElevationOut, ElevationUpdate
from ...security import ANY, ENGINEERING, require_roles
from ...services.audit import audit
from ...services.catalogue import get_catalogue
from ...services.jobs import run_calc
from ..deps import ensure_project_write, get_or_404

router = APIRouter(prefix="/elevations", tags=["elevations"])


def elevation_out(db: Session, e: Elevation) -> ElevationOut:
    out = ElevationOut.model_validate(e)
    try:
        out.issues = validate_elevation(ElevationModel.model_validate(e.data), get_catalogue(db))
    except APIError:
        out.issues = validate_elevation(ElevationModel.model_validate(e.data))
    return out


@router.get("/{elevation_id}", response_model=ElevationOut)
def get_elevation(elevation_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    return elevation_out(db, get_or_404(db, Elevation, elevation_id, "Elevation"))


@router.put("/{elevation_id}", response_model=ElevationOut,
            responses={409: {"description": "Version conflict (optimistic lock)"}})
def update_elevation(elevation_id: int, body: ElevationUpdate, request: Request, db: Session = Depends(get_db),
                     user: User = Depends(require_roles(*ENGINEERING))):
    e = get_or_404(db, Elevation, elevation_id, "Elevation")
    ensure_project_write(db, db.get(Project, e.project_id), user)
    if body.version != e.version:
        raise APIError(409, "VERSION_CONFLICT", f"Elevation was modified by someone else (current version "
                                                f"{e.version}, yours {body.version}). Reload and re-apply.")
    data = body.data.model_dump(mode="json") if body.data is not None else dict(e.data)
    name = body.name or (body.data.name if body.data is not None else e.name)
    data["name"] = name
    data["id"] = str(e.id)
    # atomic compare-and-swap on version (safe against concurrent writers)
    res = db.execute(update(Elevation).where(Elevation.id == e.id, Elevation.version == body.version)
                     .values(data=data, name=name, version=body.version + 1, updated_by=user.id,
                             updated_at=utcnow()))
    if res.rowcount != 1:
        db.rollback()
        raise APIError(409, "VERSION_CONFLICT", "Elevation was modified concurrently. Reload and re-apply.")
    audit(db, request, user, "update", "elevation", e.id, {"from_version": body.version, "to_version": body.version + 1})
    db.commit()
    db.expire_all()
    return elevation_out(db, db.get(Elevation, elevation_id))


@router.delete("/{elevation_id}", status_code=204)
def delete_elevation(elevation_id: int, request: Request, db: Session = Depends(get_db),
                     user: User = Depends(require_roles(*ENGINEERING))):
    e = get_or_404(db, Elevation, elevation_id, "Elevation")
    ensure_project_write(db, db.get(Project, e.project_id), user)
    db.execute(update(CalcRun).where(CalcRun.elevation_id == e.id).values(elevation_id=None))
    db.delete(e)
    audit(db, request, user, "delete", "elevation", elevation_id, {"project_id": e.project_id, "name": e.name})
    db.commit()
    return Response(status_code=204)


@router.post("/{elevation_id}/calculate", response_model=CalcRunOut, status_code=201,
             summary="Persisted calculation run (PROVISIONAL demo rules)")
def calculate_elevation(elevation_id: int, request: Request, body: CalculateIn | None = None,
                        db: Session = Depends(get_db), user: User = Depends(require_roles(*ENGINEERING))):
    e = get_or_404(db, Elevation, elevation_id, "Elevation")
    cat = get_catalogue(db)
    run = run_calc(db, e, cat, user, body.rule_set_id if body else None)
    audit(db, request, user, "calculate", "calc_run", run.id,
          {"elevation_id": e.id, "elevation_version": e.version, "validation_status": run.validation_status,
           "catalogue_version": run.catalogue_version, "rule_set": f"{run.rule_set_id}@{run.rule_set_version}"})
    db.commit()
    return run


@router.get("/{elevation_id}/calc-runs", response_model=List[CalcRunOut])
def list_calc_runs(elevation_id: int, include_result: bool = Query(False, description="Embed full CalcResult"),
                   limit: int = Query(50, ge=1, le=500), db: Session = Depends(get_db),
                   _: User = Depends(require_roles(*ANY))):
    get_or_404(db, Elevation, elevation_id, "Elevation")
    runs = db.scalars(select(CalcRun).where(CalcRun.elevation_id == elevation_id).order_by(CalcRun.id.desc())
                      .limit(limit)).all()
    out = [CalcRunOut.model_validate(r) for r in runs]
    return out if include_result else [o.model_copy(update={"result": None}) for o in out]
