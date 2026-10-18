from __future__ import annotations

import os

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
    db_status, catalogue_version, db_error = "ok", None, None
    try:
        with request.app.state.SessionLocal() as db:
            db.execute(text("SELECT 1"))
            try:
                catalogue_version = db.scalars(select(CatalogueRevision.version)
                                               .where(CatalogueRevision.active.is_(True))).first()
            except Exception:  # noqa: BLE001 - schema not migrated yet
                catalogue_version = None
                db_status = "not_migrated"
    except Exception as exc:  # noqa: BLE001 - never leak connection details: exception class name only
        db_status = "error"
        db_error = type(exc).__name__
    body = {"status": "ok" if db_status == "ok" else "degraded", "version": APP_VERSION, "db": db_status,
            "env": request.app.state.settings.env, "engines": ENGINE_VERSIONS,
            "catalogue_version": catalogue_version,
            # deployment diagnostics (no values, only whether settings are present)
            "config": {"database_url_set": bool(os.environ.get("DATABASE_URL")),
                       "database_url_unpooled_set": bool(os.environ.get("DATABASE_URL_UNPOOLED")),
                       "jwt_secret_set": bool(os.environ.get("JWT_SECRET")),
                       "auto_migrate": request.app.state.settings.auto_migrate,
                       "on_vercel": os.environ.get("VERCEL") == "1"}}
    if db_error:
        body["db_error"] = db_error
    return JSONResponse(body, status_code=200 if db_status == "ok" else 503)
