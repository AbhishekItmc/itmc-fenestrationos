"""1D cutting and 2D nesting: stateless optimisation, persisted jobs, Excel import/templates, from-calc."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...db import get_db
from ...engines import excel_io
from ...engines.models import Cutting1DRequest, Cutting1DResult, Nesting2DRequest, Nesting2DResult
from ...errors import APIError
from ...models import CalcRun, CuttingJob, NestingJob, Project, User
from ...schemas import (CuttingJobCreate, CuttingJobOut, FromCalcIn, FromCalcItem, ImportOut, JobSummaryOut,
                        NestingJobCreate, NestingJobOut)
from ...security import ANY, ENGINEERING, require_roles
from ...services import inventory as inv
from ...services.audit import audit
from ...services.catalogue import get_catalogue
from ...services.jobs import apply_cutting_result, cutting_requests_from_calc, run_cutting, run_nesting
from ..deps import ensure_project_write, get_or_404

cutting = APIRouter(prefix="/cutting", tags=["cutting"])
nesting = APIRouter(prefix="/nesting", tags=["nesting"])

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _summary(job) -> Optional[dict]:
    if not job.result:
        return None
    s = dict(job.result.get("summary") or {})
    s["status"] = job.result.get("status")
    s["method"] = job.result.get("method")
    s["unplaced"] = sum(int(p.get("quantity", 1)) for p in job.result.get("unplaced", []))
    return s


def _summary_out(job) -> JobSummaryOut:
    out = JobSummaryOut.model_validate(job)
    out.summary = _summary(job)
    return out


def _check_project(db: Session, project_id: Optional[int], user: User) -> None:
    if project_id is not None:
        p = db.get(Project, project_id)
        if p is None:
            raise APIError(400, "PROJECT_NOT_FOUND", f"Project {project_id} does not exist")
        ensure_project_write(db, p, user)


async def _read_upload(request: Request, file: UploadFile) -> bytes:
    limit = int(request.app.state.settings.max_upload_mb * 1024 * 1024)
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise APIError(413, "FILE_TOO_LARGE", f"Upload exceeds {request.app.state.settings.max_upload_mb:g} MB")
    if not data:
        raise APIError(400, "EMPTY_FILE", "Uploaded file is empty")
    name = (file.filename or "").lower()
    if not (name.endswith(".xlsx") or name.endswith(".xlsm")) and data[:2] != b"PK":
        raise APIError(415, "UNSUPPORTED_FILE", "Upload an .xlsx workbook")
    return data


def _consume(db: Session, job, kind: str) -> dict:
    if job.result is None or job.validation_status == "INVALID":
        return {}
    return inv.consume_for_result(db, job.result, kind)


# =========================================================================== 1D cutting
@cutting.post("/1d/optimize", response_model=Cutting1DResult, summary="Stateless 1D cutting optimisation")
def optimize_cutting(body: Cutting1DRequest, request: Request, db: Session = Depends(get_db),
                     user: User = Depends(require_roles(*ANY))):
    result = run_cutting(body)
    audit(db, request, user, "optimize", "cutting_stateless", None,
          {"validation_status": result["validation_status"], "bars_used": result["summary"]["bars_used"],
           "pieces": sum(p.quantity for p in body.pieces)}, commit=True)
    return result


@cutting.get("/template.xlsx", summary="Cutting import template workbook")
def cutting_template(_: User = Depends(require_roles(*ANY))):
    return Response(excel_io.build_cutting_template(), media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="cutting_template.xlsx"'})


@cutting.post("/import-excel", response_model=ImportOut, summary="Parse a cutting workbook → pieces/stocks")
async def cutting_import(request: Request, file: UploadFile = File(...), db: Session = Depends(get_db),
                         user: User = Depends(require_roles(*ANY))):
    data = await _read_upload(request, file)
    pieces, stocks, settings, issues = excel_io.parse_cutting_workbook(data)
    audit(db, request, user, "import", "cutting_excel", None,
          {"filename": file.filename, "pieces": len(pieces), "stocks": len(stocks),
           "errors": sum(1 for i in issues if i.severity == "error")}, commit=True)
    return ImportOut(pieces=[p.model_dump() for p in pieces], stocks=[s.model_dump() for s in stocks],
                     settings=settings, issues=issues)


@cutting.get("/jobs", response_model=List[JobSummaryOut])
def list_cutting_jobs(project_id: Optional[int] = None, limit: int = Query(200, ge=1, le=1000),
                      offset: int = Query(0, ge=0), db: Session = Depends(get_db),
                      _: User = Depends(require_roles(*ANY))):
    stmt = select(CuttingJob).order_by(CuttingJob.id.desc())
    if project_id is not None:
        stmt = stmt.where(CuttingJob.project_id == project_id)
    return [_summary_out(j) for j in db.scalars(stmt.limit(limit).offset(offset)).all()]


@cutting.post("/jobs", response_model=CuttingJobOut, status_code=201)
def create_cutting_job(body: CuttingJobCreate, request: Request, db: Session = Depends(get_db),
                       user: User = Depends(require_roles(*ENGINEERING))):
    _check_project(db, body.project_id, user)
    job = CuttingJob(project_id=body.project_id, name=body.name, request=body.request.model_dump(mode="json"),
                     status="draft", created_by=user.id)
    db.add(job)
    db.flush()
    consumed = {}
    if body.optimize:
        apply_cutting_result(job, run_cutting(body.request))
        if body.consume_inventory:
            consumed = _consume(db, job, "bar")
    audit(db, request, user, "create", "cutting_job", job.id,
          {"optimized": body.optimize, "validation_status": job.validation_status, "inventory_consumed": consumed})
    db.commit()
    out = CuttingJobOut.model_validate(job)
    out.summary, out.inventory_consumed = _summary(job), consumed
    return out


@cutting.get("/jobs/{job_id}", response_model=CuttingJobOut)
def get_cutting_job(job_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    job = get_or_404(db, CuttingJob, job_id, "Cutting job")
    out = CuttingJobOut.model_validate(job)
    out.summary = _summary(job)
    return out


@cutting.post("/jobs/{job_id}/optimize", response_model=CuttingJobOut, summary="(Re)run optimisation of a job")
def rerun_cutting_job(job_id: int, request: Request, db: Session = Depends(get_db),
                      user: User = Depends(require_roles(*ENGINEERING))):
    job = get_or_404(db, CuttingJob, job_id, "Cutting job")
    _check_project(db, job.project_id, user)
    apply_cutting_result(job, run_cutting(Cutting1DRequest.model_validate(job.request)))
    audit(db, request, user, "optimize", "cutting_job", job.id, {"validation_status": job.validation_status})
    db.commit()
    out = CuttingJobOut.model_validate(job)
    out.summary = _summary(job)
    return out


@cutting.delete("/jobs/{job_id}", status_code=204)
def delete_cutting_job(job_id: int, request: Request, db: Session = Depends(get_db),
                       user: User = Depends(require_roles(*ENGINEERING))):
    job = get_or_404(db, CuttingJob, job_id, "Cutting job")
    _check_project(db, job.project_id, user)
    db.delete(job)
    audit(db, request, user, "delete", "cutting_job", job_id, {"name": job.name})
    db.commit()
    return Response(status_code=204)


@cutting.post("/from-calc/{calc_run_id}", response_model=List[FromCalcItem],
              summary="Build one Cutting1DRequest per profile from a calc run (optionally optimise & persist)")
def cutting_from_calc(calc_run_id: int, request: Request, body: FromCalcIn | None = None,
                      optimize: bool = Query(False, description="Run optimisation and persist one job per profile"),
                      db: Session = Depends(get_db), user: User = Depends(require_roles(*ENGINEERING))):
    body = body or FromCalcIn()
    run = get_or_404(db, CalcRun, calc_run_id, "Calc run")
    cat = get_catalogue(db, run.catalogue_version)
    extra = None
    if body.use_inventory:
        extra = {}
        for p in cat.get("profiles", []):
            st = inv.as_stock(db, "bar", p.get("code"))
            if st:
                extra[p["code"]] = st
    overrides = body.model_dump(exclude={"use_inventory"})
    items = cutting_requests_from_calc(run, cat, overrides, extra)
    out = []
    for it in items:
        row = FromCalcItem(**it)
        if optimize:
            if run.project_id is not None:
                _check_project(db, run.project_id, user)
            job = CuttingJob(project_id=run.project_id, name=f"CR{run.id} {it['profile_code']}",
                             request=it["request"].model_dump(mode="json"), source_calc_run_id=run.id,
                             profile_id=it["profile_id"], demo=run.validation_status != "VALIDATED",
                             created_by=user.id)
            db.add(job)
            db.flush()
            apply_cutting_result(job, run_cutting(it["request"]))
            row.job_id, row.validation_status, row.summary = job.id, job.validation_status, _summary(job)
        out.append(row)
    audit(db, request, user, "optimize" if optimize else "build", "cutting_from_calc", run.id,
          {"profiles": [i.profile_code for i in out], "jobs": [i.job_id for i in out if i.job_id]})
    db.commit()
    return out


# =========================================================================== 2D nesting
@nesting.post("/2d/optimize", response_model=Nesting2DResult, summary="Stateless 2D nesting")
def optimize_nesting(body: Nesting2DRequest, request: Request, db: Session = Depends(get_db),
                     user: User = Depends(require_roles(*ANY))):
    result = run_nesting(body)
    audit(db, request, user, "optimize", "nesting_stateless", None,
          {"validation_status": result["validation_status"], "sheets_used": result["summary"]["sheets_used"],
           "pieces": sum(p.quantity for p in body.pieces)}, commit=True)
    return result


@nesting.get("/template.xlsx", summary="Nesting import template workbook")
def nesting_template(_: User = Depends(require_roles(*ANY))):
    return Response(excel_io.build_nesting_template(), media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="nesting_template.xlsx"'})


@nesting.post("/import-excel", response_model=ImportOut, summary="Parse a nesting workbook → pieces/sheets")
async def nesting_import(request: Request, file: UploadFile = File(...), db: Session = Depends(get_db),
                         user: User = Depends(require_roles(*ANY))):
    data = await _read_upload(request, file)
    pieces, sheets, settings, issues = excel_io.parse_nesting_workbook(data)
    audit(db, request, user, "import", "nesting_excel", None,
          {"filename": file.filename, "pieces": len(pieces), "sheets": len(sheets),
           "errors": sum(1 for i in issues if i.severity == "error")}, commit=True)
    return ImportOut(pieces=[p.model_dump() for p in pieces], sheets=[s.model_dump() for s in sheets],
                     settings=settings, issues=issues)


@nesting.get("/jobs", response_model=List[JobSummaryOut])
def list_nesting_jobs(project_id: Optional[int] = None, limit: int = Query(200, ge=1, le=1000),
                      offset: int = Query(0, ge=0), db: Session = Depends(get_db),
                      _: User = Depends(require_roles(*ANY))):
    stmt = select(NestingJob).order_by(NestingJob.id.desc())
    if project_id is not None:
        stmt = stmt.where(NestingJob.project_id == project_id)
    out = []
    for j in db.scalars(stmt.limit(limit).offset(offset)).all():
        out.append(_summary_out(j))
    return out


@nesting.post("/jobs", response_model=NestingJobOut, status_code=201)
def create_nesting_job(body: NestingJobCreate, request: Request, db: Session = Depends(get_db),
                       user: User = Depends(require_roles(*ENGINEERING))):
    _check_project(db, body.project_id, user)
    job = NestingJob(project_id=body.project_id, name=body.name, request=body.request.model_dump(mode="json"),
                     status="draft", created_by=user.id)
    db.add(job)
    db.flush()
    consumed = {}
    if body.optimize:
        apply_cutting_result(job, run_nesting(body.request))
        if body.consume_inventory:
            consumed = _consume(db, job, "sheet")
    audit(db, request, user, "create", "nesting_job", job.id,
          {"optimized": body.optimize, "validation_status": job.validation_status, "inventory_consumed": consumed})
    db.commit()
    out = NestingJobOut.model_validate(job)
    out.summary, out.inventory_consumed = _summary(job), consumed
    return out


@nesting.get("/jobs/{job_id}", response_model=NestingJobOut)
def get_nesting_job(job_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    job = get_or_404(db, NestingJob, job_id, "Nesting job")
    out = NestingJobOut.model_validate(job)
    out.summary = _summary(job)
    return out


@nesting.post("/jobs/{job_id}/optimize", response_model=NestingJobOut)
def rerun_nesting_job(job_id: int, request: Request, db: Session = Depends(get_db),
                      user: User = Depends(require_roles(*ENGINEERING))):
    job = get_or_404(db, NestingJob, job_id, "Nesting job")
    _check_project(db, job.project_id, user)
    apply_cutting_result(job, run_nesting(Nesting2DRequest.model_validate(job.request)))
    audit(db, request, user, "optimize", "nesting_job", job.id, {"validation_status": job.validation_status})
    db.commit()
    out = NestingJobOut.model_validate(job)
    out.summary = _summary(job)
    return out


@nesting.delete("/jobs/{job_id}", status_code=204)
def delete_nesting_job(job_id: int, request: Request, db: Session = Depends(get_db),
                       user: User = Depends(require_roles(*ENGINEERING))):
    job = get_or_404(db, NestingJob, job_id, "Nesting job")
    _check_project(db, job.project_id, user)
    db.delete(job)
    audit(db, request, user, "delete", "nesting_job", job_id, {"name": job.name})
    db.commit()
    return Response(status_code=204)
