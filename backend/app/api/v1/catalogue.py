from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...db import get_db
from ...engines.calc import calculate
from ...engines.models import CalcRequest, CalcResult
from ...models import CatalogueRevision, User
from ...security import ADMIN, ANY, require_roles
from ...services.audit import audit
from ...services.catalogue import active_revision, edit_item, get_catalogue

router = APIRouter(tags=["catalogue"])
calc_router = APIRouter(prefix="/calc", tags=["calc"])


@router.get("/catalogue", summary="Full active catalogue JSON (DEMO data)")
def get_active_catalogue(version: Optional[str] = Query(None, description="Specific catalogue version"),
                         db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))) -> Dict[str, Any]:
    return get_catalogue(db, version)


@router.get("/catalogue/revisions", summary="Catalogue revision history")
def list_catalogue_revisions(db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    revs = db.scalars(select(CatalogueRevision).order_by(CatalogueRevision.id.desc())).all()
    return [{"id": r.id, "version": r.version, "active": r.active, "demo": r.demo, "note": r.note,
             "created_by": r.created_by, "created_at": r.created_at} for r in revs]


@router.put("/catalogue/{collection}/{item_id}", summary="Create/update one catalogue item (new revision)")
def put_catalogue_item(collection: str, item_id: str, request: Request,
                       item: Dict[str, Any] = Body(..., examples=[{"id": "col-ral9010", "code": "DEMO-C-WHT",
                                                                    "name": "Demo white (powder)", "finish": "powder",
                                                                    "hex": "#F1EFE6", "surcharge_pct": 2,
                                                                    "demo": True}]),
                       db: Session = Depends(get_db), user: User = Depends(require_roles(*ADMIN))):
    prev = active_revision(db).version
    rev, saved, created, before = edit_item(db, collection, item_id, item, user)
    audit(db, request, user, "create" if created else "update", "catalogue_item", f"{collection}/{item_id}",
          {"from_version": prev, "to_version": rev.version, "before": before, "after": saved})
    db.commit()
    return {"catalogue_version": rev.version, "previous_version": prev, "collection": collection, "item": saved,
            "created": created}


@calc_router.post("/elevation", response_model=CalcResult, summary="Stateless calculation (not persisted)")
def calc_elevation(body: CalcRequest, request: Request, db: Session = Depends(get_db),
                   user: User = Depends(require_roles(*ANY))):
    cat = get_catalogue(db, body.catalogue_version)
    result = calculate(body.elevation, cat, body.rule_set_id)
    audit(db, request, user, "calculate", "calc_stateless", None,
          {"inputs_hash": result.inputs_hash, "validation_status": result.validation_status,
           "catalogue_version": result.catalogue_version}, commit=True)
    return result
