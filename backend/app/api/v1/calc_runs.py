from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...db import get_db
from ...models import CalcRun, User
from ...schemas import CalcRunOut
from ...security import ANY, require_roles
from ..deps import get_or_404

router = APIRouter(prefix="/calc-runs", tags=["calc"])


@router.get("/{run_id}", response_model=CalcRunOut, summary="Persisted calc run with full CalcResult")
def get_calc_run(run_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    return get_or_404(db, CalcRun, run_id, "Calc run")
