from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ...db import get_db
from ...errors import APIError
from ...models import CalcRun, CuttingJob, Elevation, NestingJob, Project, Quote, User
from ...reports import pdf as rpdf
from ...reports import xlsx as rxlsx
from ...reports.common import ReportMeta
from ...security import ANY, require_roles
from ...services.audit import audit
from ..deps import get_or_404

router = APIRouter(prefix="/reports", tags=["reports"])

PDF = "application/pdf"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
Fmt = Literal["pdf", "xlsx"]


def _project_label(db: Session, project_id) -> str | None:
    if project_id is None:
        return None
    p = db.get(Project, project_id)
    return f"{p.code} — {p.name}" if p else None


def _send(db, request, user, kind: str, obj_id: int, fmt: str, data: bytes, filename: str, meta: ReportMeta):
    audit(db, request, user, "report", kind, obj_id, {"format": fmt, "validation_status": meta.validation_status,
                                                      "provisional": meta.provisional, "bytes": len(data)},
          commit=True)
    return Response(data, media_type=PDF if fmt == "pdf" else XLSX,
                    headers={"Content-Disposition": f'attachment; filename="{filename}.{fmt}"',
                             "X-Validation-Status": meta.validation_status,
                             "X-Provisional": "true" if meta.provisional else "false"})


def _job_meta(db, job, kind: str, user: User) -> ReportMeta:
    if job.result is None:
        raise APIError(400, "JOB_NOT_OPTIMISED", f"{kind} job {job.id} has not been optimised yet")
    res = job.result
    cat_ver, rule = "-", "-"
    if job.source_calc_run_id:
        run = db.get(CalcRun, job.source_calc_run_id)
        if run:
            cat_ver, rule = run.catalogue_version, f"{run.rule_set_id}@{run.rule_set_version} (calc run {run.id})"
    return ReportMeta(title=f"{'Cutting' if kind == 'cutting' else 'Nesting'} report — {job.name}",
                      reference=f"{kind.capitalize()} job #{job.id}", validation_status=res["validation_status"],
                      engine_version=res["engine_version"], catalogue_version=cat_ver, rule_set=rule,
                      validator=res["validation"]["validator"], provisional=bool(job.demo),
                      project=_project_label(db, job.project_id), generated_by=user.email,
                      extra=[("Optimiser method", res.get("method", "-"))])


@router.get("/cutting/{job_id:int}.{fmt}", summary="Cutting job report (PDF bar diagrams / Excel workshop list)")
def cutting_report(job_id: int, fmt: Fmt, request: Request, db: Session = Depends(get_db),
                   user: User = Depends(require_roles(*ANY))):
    job = get_or_404(db, CuttingJob, job_id, "Cutting job")
    meta = _job_meta(db, job, "cutting", user)
    data = (rpdf.cutting_pdf if fmt == "pdf" else rxlsx.cutting_xlsx)(job.result, meta, job.name)
    return _send(db, request, user, "cutting_job", job.id, fmt, data, f"cutting_job_{job.id}", meta)


@router.get("/nesting/{job_id:int}.{fmt}", summary="Nesting job report (sheet layouts)")
def nesting_report(job_id: int, fmt: Fmt, request: Request, db: Session = Depends(get_db),
                   user: User = Depends(require_roles(*ANY))):
    job = get_or_404(db, NestingJob, job_id, "Nesting job")
    meta = _job_meta(db, job, "nesting", user)
    data = (rpdf.nesting_pdf if fmt == "pdf" else rxlsx.nesting_xlsx)(job.result, meta, job.name)
    return _send(db, request, user, "nesting_job", job.id, fmt, data, f"nesting_job_{job.id}", meta)


@router.get("/calc/{run_id:int}.{fmt}", summary="Calc run report (cut list, glass list, BOM, issues)")
def calc_report(run_id: int, fmt: Fmt, request: Request, db: Session = Depends(get_db),
                user: User = Depends(require_roles(*ANY))):
    run = get_or_404(db, CalcRun, run_id, "Calc run")
    res = run.result
    elev = db.get(Elevation, run.elevation_id) if run.elevation_id else None
    name = elev.name if elev else res["elevation"].get("name", "Elevation")
    meta = ReportMeta(title=f"Calculation report — {name}", reference=f"Calc run #{run.id}",
                      validation_status=run.validation_status, engine_version=run.engine_version,
                      catalogue_version=run.catalogue_version,
                      rule_set=f"{run.rule_set_id}@{run.rule_set_version} (approved={res.get('rule_set_approved')})",
                      validator=res["validation"]["validator"], provisional=run.validation_status != "VALIDATED",
                      project=_project_label(db, run.project_id), generated_by=user.email,
                      extra=[("Elevation version", str(run.elevation_version)), ("Inputs hash", run.inputs_hash)])
    data = (rpdf.calc_pdf if fmt == "pdf" else rxlsx.calc_xlsx)(res, meta, name)
    return _send(db, request, user, "calc_run", run.id, fmt, data, f"calc_run_{run.id}", meta)


@router.get("/quote/{quote_id:int}.{fmt}", summary="Quotation (always provisional: demo prices)")
def quote_report(quote_id: int, fmt: Fmt, request: Request, db: Session = Depends(get_db),
                 user: User = Depends(require_roles(*ANY))):
    q = get_or_404(db, Quote, quote_id, "Quote")
    p = db.get(Project, q.project_id)
    qd = {c: getattr(q, c) for c in ("number", "status", "currency", "calc_run_ids", "lines", "subtotal",
                                     "margin_pct", "margin_amount", "total", "notes", "issues")}
    runs = [db.get(CalcRun, i) for i in q.calc_run_ids]
    rules = sorted({f"{r.rule_set_id}@{r.rule_set_version}" for r in runs if r})
    engines = sorted({r.engine_version for r in runs if r})
    meta = ReportMeta(title=f"Quotation {q.number}", reference=f"Quote #{q.id}", validation_status=q.validation_status,
                      units="mm", engine_version=", ".join(engines) or "-",
                      catalogue_version=q.catalogue_version or "-", rule_set=", ".join(rules) or "-",
                      validator="n/a (pricing)", provisional=q.provisional,
                      project=f"{p.code} — {p.name}" if p else None, generated_by=user.email,
                      extra=[("Currency", q.currency), ("Price basis", "Demo prices — not a commercial offer")])
    proj = {"code": p.code, "name": p.name, "site": p.site,
            "customer_name": p.customer.name if p and p.customer else None} if p else {}
    data = rpdf.quote_pdf(qd, meta, proj) if fmt == "pdf" else rxlsx.quote_xlsx(qd, meta)
    return _send(db, request, user, "quote", q.id, fmt, data, f"quote_{q.number}", meta)
