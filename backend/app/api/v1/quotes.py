from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...db import get_db
from ...errors import APIError
from ...models import CalcRun, Project, Quote, User
from ...schemas import QuoteCreate, QuoteOut, QuoteUpdate
from ...security import ANY, COMMERCIAL, require_roles
from ...services.audit import audit
from ...services.catalogue import get_catalogue
from ...services.quotes import DEMO_NOTE, check_runs, next_quote_number, price_calc_runs
from ..deps import ensure_project_write, get_or_404

router = APIRouter(tags=["quotes"])


@router.get("/projects/{project_id}/quotes", response_model=List[QuoteOut])
def list_quotes(project_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    get_or_404(db, Project, project_id, "Project")
    return db.scalars(select(Quote).where(Quote.project_id == project_id).order_by(Quote.id.desc())).all()


@router.post("/projects/{project_id}/quotes", response_model=QuoteOut, status_code=201,
             summary="Quotation from calc-run BOMs × DEMO prices (always provisional)")
def create_quote(project_id: int, body: QuoteCreate, request: Request, db: Session = Depends(get_db),
                 user: User = Depends(require_roles(*COMMERCIAL))):
    p = get_or_404(db, Project, project_id, "Project")
    ensure_project_write(db, p, user)
    ids = list(dict.fromkeys(body.calc_run_ids))
    runs = db.scalars(select(CalcRun).where(CalcRun.id.in_(ids), CalcRun.project_id == p.id)).all()
    check_runs(runs, p.id, ids)
    runs = sorted(runs, key=lambda r: ids.index(r.id))
    cat = get_catalogue(db)
    priced = price_calc_runs(runs, cat, body.margin_pct)
    notes = DEMO_NOTE + (f"\n{body.notes}" if body.notes else "")
    for attempt in range(5):
        q = Quote(project_id=p.id, number=next_quote_number(db), status="draft", currency=cat.get("currency", "INR"),
                  calc_run_ids=ids, lines=priced["lines"], subtotal=priced["subtotal"],
                  margin_pct=body.margin_pct, margin_amount=priced["margin_amount"], total=priced["total"],
                  validation_status="PROVISIONAL_DEMO_RULES", provisional=True,
                  catalogue_version=str(cat.get("catalogue_version")), notes=notes, issues=priced["issues"],
                  created_by=user.id)
        db.add(q)
        try:
            db.flush()
            break
        except IntegrityError:
            db.rollback()
    else:
        raise APIError(409, "QUOTE_NUMBER_CONFLICT", "Could not allocate a quote number; retry")
    audit(db, request, user, "create", "quote", q.id, {"number": q.number, "total": q.total,
                                                       "calc_run_ids": ids, "margin_pct": body.margin_pct})
    db.commit()
    return q


@router.get("/quotes/{quote_id}", response_model=QuoteOut)
def get_quote(quote_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    return get_or_404(db, Quote, quote_id, "Quote")


@router.put("/quotes/{quote_id}", response_model=QuoteOut)
def update_quote(quote_id: int, body: QuoteUpdate, request: Request, db: Session = Depends(get_db),
                 user: User = Depends(require_roles(*COMMERCIAL))):
    q = get_or_404(db, Quote, quote_id, "Quote")
    changes = body.model_dump(exclude_unset=True)
    if changes.get("notes") is not None and DEMO_NOTE not in changes["notes"]:
        changes["notes"] = DEMO_NOTE + "\n" + changes["notes"]
    for k, v in changes.items():
        setattr(q, k, v)
    audit(db, request, user, "update", "quote", q.id, changes)
    db.commit()
    return q
