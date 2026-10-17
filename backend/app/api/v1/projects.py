from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...db import get_db
from ...engines.models import Elevation as ElevationModel
from ...errors import APIError
from ...models import (CalcRun, Customer, CuttingJob, Elevation, NestingJob, Project, ProjectMember, ProjectRevision,
                       Quote, User)
from ...schemas import (CalcRunOut, ElevationCreate, ElevationOut, MemberIn, MemberOut, ProjectIn, ProjectOut,
                        ProjectUpdate, RevisionIn, RevisionOut)
from ...security import ADMIN, ANY, ENGINEERING, PROJECT_WRITERS, require_roles
from ...services.audit import audit
from ..deps import ensure_project_write, get_or_404
from .elevations import elevation_out

router = APIRouter(prefix="/projects", tags=["projects"])


def project_out(p: Project) -> ProjectOut:
    out = ProjectOut.model_validate(p)
    out.customer_name = p.customer.name if p.customer else None
    return out


def _check_customer(db: Session, customer_id: Optional[int]) -> None:
    if customer_id is not None and db.get(Customer, customer_id) is None:
        raise APIError(400, "CUSTOMER_NOT_FOUND", f"Customer {customer_id} does not exist")


@router.get("", response_model=List[ProjectOut])
def list_projects(status: Optional[str] = None, customer_id: Optional[int] = None,
                  q: Optional[str] = Query(None, max_length=100), limit: int = Query(200, ge=1, le=1000),
                  offset: int = Query(0, ge=0), db: Session = Depends(get_db),
                  _: User = Depends(require_roles(*ANY))):
    stmt = select(Project).order_by(Project.updated_at.desc(), Project.id.desc())
    if status:
        stmt = stmt.where(Project.status == status)
    if customer_id:
        stmt = stmt.where(Project.customer_id == customer_id)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(func.lower(Project.name).like(like) | func.lower(Project.code).like(like))
    return [project_out(p) for p in db.scalars(stmt.limit(limit).offset(offset)).unique().all()]


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectIn, request: Request, db: Session = Depends(get_db),
                   user: User = Depends(require_roles(*PROJECT_WRITERS))):
    _check_customer(db, body.customer_id)
    if db.scalars(select(Project.id).where(Project.code == body.code)).first():
        raise APIError(409, "DUPLICATE_CODE", f"Project code '{body.code}' already exists")
    p = Project(**body.model_dump(), owner_id=user.id)
    db.add(p)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise APIError(409, "DUPLICATE_CODE", f"Project code '{body.code}' already exists")
    audit(db, request, user, "create", "project", p.id, {"code": p.code})
    db.commit()
    db.refresh(p)
    return project_out(p)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    return project_out(get_or_404(db, Project, project_id, "Project"))


@router.put("/{project_id}", response_model=ProjectOut)
def update_project(project_id: int, body: ProjectUpdate, request: Request, db: Session = Depends(get_db),
                   user: User = Depends(require_roles(*PROJECT_WRITERS))):
    p = get_or_404(db, Project, project_id, "Project")
    ensure_project_write(db, p, user)
    changes = body.model_dump(exclude_unset=True)
    if "customer_id" in changes:
        _check_customer(db, changes["customer_id"])
    if "code" in changes and changes["code"] != p.code:
        if db.scalars(select(Project.id).where(Project.code == changes["code"])).first():
            raise APIError(409, "DUPLICATE_CODE", f"Project code '{changes['code']}' already exists")
    before = {k: getattr(p, k) for k in changes}
    for k, v in changes.items():
        setattr(p, k, v)
    audit(db, request, user, "update", "project", p.id,
          {"changes": {k: {"from": before[k], "to": v} for k, v in changes.items() if before[k] != v}})
    db.commit()
    db.refresh(p)
    return project_out(p)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, request: Request, db: Session = Depends(get_db),
                   user: User = Depends(require_roles(*PROJECT_WRITERS))):
    p = get_or_404(db, Project, project_id, "Project")
    ensure_project_write(db, p, user)
    for model in (Quote, CuttingJob, NestingJob, CalcRun, ProjectRevision, Elevation, ProjectMember):
        db.execute(delete(model).where(model.project_id == p.id))
    db.delete(p)
    audit(db, request, user, "delete", "project", project_id, {"code": p.code})
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ members (optional per-project permission)
@router.get("/{project_id}/members", response_model=List[MemberOut])
def list_members(project_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    get_or_404(db, Project, project_id, "Project")
    return [_member_out(db, m) for m in
            db.scalars(select(ProjectMember).where(ProjectMember.project_id == project_id)).all()]


def _member_out(db: Session, m: ProjectMember) -> MemberOut:
    out = MemberOut.model_validate(m)
    u = db.get(User, m.user_id)
    if u:
        out.email, out.name = u.email, u.name
    return out


@router.post("/{project_id}/members", response_model=MemberOut, status_code=201)
def add_member(project_id: int, body: MemberIn, request: Request, db: Session = Depends(get_db),
               user: User = Depends(require_roles(*ADMIN))):
    get_or_404(db, Project, project_id, "Project")
    get_or_404(db, User, body.user_id, "User")
    m = db.scalars(select(ProjectMember).where(ProjectMember.project_id == project_id,
                                               ProjectMember.user_id == body.user_id)).first()
    if m:
        m.role = body.role
    else:
        m = ProjectMember(project_id=project_id, user_id=body.user_id, role=body.role)
        db.add(m)
    db.flush()
    audit(db, request, user, "update", "project_member", m.id, {"project_id": project_id, **body.model_dump()})
    db.commit()
    return _member_out(db, m)


@router.delete("/{project_id}/members/{user_id}", status_code=204)
def remove_member(project_id: int, user_id: int, request: Request, db: Session = Depends(get_db),
                  user: User = Depends(require_roles(*ADMIN))):
    m = db.scalars(select(ProjectMember).where(ProjectMember.project_id == project_id,
                                               ProjectMember.user_id == user_id)).first()
    if m is None:
        raise APIError(404, "NOT_FOUND", "Membership not found")
    db.delete(m)
    audit(db, request, user, "delete", "project_member", m.id, {"project_id": project_id, "user_id": user_id})
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ elevations (collection)
@router.get("/{project_id}/elevations", response_model=List[ElevationOut])
def list_elevations(project_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    get_or_404(db, Project, project_id, "Project")
    return db.scalars(select(Elevation).where(Elevation.project_id == project_id).order_by(Elevation.id)).all()


@router.post("/{project_id}/elevations", response_model=ElevationOut, status_code=201)
def create_elevation(project_id: int, body: ElevationCreate, request: Request, db: Session = Depends(get_db),
                     user: User = Depends(require_roles(*ENGINEERING))):
    p = get_or_404(db, Project, project_id, "Project")
    ensure_project_write(db, p, user)
    data: ElevationModel = body.data
    if body.name:
        data.name = body.name
    e = Elevation(project_id=p.id, name=data.name, data=data.model_dump(mode="json"), version=1,
                  created_by=user.id, updated_by=user.id)
    db.add(e)
    db.flush()
    e.data = {**e.data, "id": str(e.id)}
    audit(db, request, user, "create", "elevation", e.id, {"project_id": p.id, "name": e.name})
    db.commit()
    db.refresh(e)
    return elevation_out(db, e)


# ------------------------------------------------------------------ calc runs of a project
@router.get("/{project_id}/calc-runs", response_model=List[CalcRunOut])
def list_project_calc_runs(project_id: int, include_result: bool = Query(True, description="Embed full CalcResult"),
                           limit: int = Query(50, ge=1, le=500), db: Session = Depends(get_db),
                           _: User = Depends(require_roles(*ANY))):
    get_or_404(db, Project, project_id, "Project")
    runs = db.scalars(select(CalcRun).where(CalcRun.project_id == project_id).order_by(CalcRun.id.desc())
                      .limit(limit)).all()
    out = [CalcRunOut.model_validate(r) for r in runs]
    return out if include_result else [o.model_copy(update={"result": None}) for o in out]


# ------------------------------------------------------------------ revisions (immutable)
def _snapshot(db: Session, p: Project) -> dict:
    elevs = db.scalars(select(Elevation).where(Elevation.project_id == p.id).order_by(Elevation.id)).all()
    return {"project": {"id": p.id, "code": p.code, "name": p.name, "customer_id": p.customer_id, "site": p.site,
                        "status": p.status, "description": p.description},
            "elevations": [{"id": e.id, "name": e.name, "version": e.version, "data": e.data} for e in elevs]}


@router.get("/{project_id}/revisions", response_model=List[RevisionOut])
def list_revisions(project_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    get_or_404(db, Project, project_id, "Project")
    revs = db.scalars(select(ProjectRevision).where(ProjectRevision.project_id == project_id)
                      .order_by(ProjectRevision.rev_no)).all()
    return [RevisionOut.model_validate(r).model_copy(update={"snapshot": None}) for r in revs]


@router.post("/{project_id}/revisions", response_model=RevisionOut, status_code=201)
def create_revision(project_id: int, body: RevisionIn, request: Request, db: Session = Depends(get_db),
                    user: User = Depends(require_roles(*ENGINEERING))):
    p = get_or_404(db, Project, project_id, "Project")
    ensure_project_write(db, p, user)
    last = db.scalar(select(func.max(ProjectRevision.rev_no)).where(ProjectRevision.project_id == p.id)) or 0
    rev = ProjectRevision(project_id=p.id, rev_no=last + 1, label=body.label or f"R{last + 1}", note=body.note,
                          snapshot=_snapshot(db, p), created_by=user.id)
    db.add(rev)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise APIError(409, "REVISION_CONFLICT", "Concurrent revision creation; retry")
    audit(db, request, user, "create", "project_revision", rev.id, {"project_id": p.id, "rev_no": rev.rev_no,
                                                                   "elevations": len(rev.snapshot["elevations"])})
    db.commit()
    return rev


@router.get("/{project_id}/revisions/{revision_id}", response_model=RevisionOut)
def get_revision(project_id: int, revision_id: int, db: Session = Depends(get_db),
                 _: User = Depends(require_roles(*ANY))):
    rev = db.get(ProjectRevision, revision_id)
    if rev is None or rev.project_id != project_id:
        raise APIError(404, "NOT_FOUND", f"Revision {revision_id} not found in project {project_id}")
    return rev
