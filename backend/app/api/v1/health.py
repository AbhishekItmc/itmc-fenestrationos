from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, text

from ...config import APP_VERSION
from ...engines import calc, cutting1d, nesting2d, validators
from ...models import CatalogueRevision

router = APIRouter(tags=["health"])

ENGINE_VERSIONS = {"calc": calc.ENGINE_VERSION, "cutting1d": cutting1d.ENGINE_VERSION,
                   "nesting2d": nesting2d.ENGINE_VERSION, "validate_calc": validators.VALIDATOR_CALC}


@router.get("/health", summary="Liveness/readiness: DB connectivity and engine versions (public)")
def health(request: Request):
    db_status, catalogue_version = "ok", None
    try:
        with request.app.state.SessionLocal() as db:
            db.execute(text("SELECT 1"))
            try:
                catalogue_version = db.scalars(select(CatalogueRevision.version)
                                               .where(CatalogueRevision.active.is_(True))).first()
            except Exception:  # noqa: BLE001 - schema not migrated yet
                catalogue_version = None
                db_status = "not_migrated"
    except Exception:  # noqa: BLE001 - never leak connection details
        db_status = "error"
    body = {"status": "ok" if db_status == "ok" else "degraded", "version": APP_VERSION, "db": db_status,
            "env": request.app.state.settings.env, "engines": ENGINE_VERSIONS,
            "catalogue_version": catalogue_version}
    return JSONResponse(body, status_code=200 if db_status == "ok" else 503)
