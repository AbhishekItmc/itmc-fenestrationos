"""FastAPI application factory for ITMC FenestrationOS."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api.v1 import api_router
from .config import APP_VERSION, Settings, get_settings
from .db import make_engine, make_sessionmaker
from .errors import body, install_handlers
from .logging_conf import configure_logging
from .middleware import RequestContextMiddleware
from .security import LoginRateLimiter

log = logging.getLogger("fos.app")

DESCRIPTION = """
**ITMC FenestrationOS API** — curtain-wall design, calculation, cutting/nesting optimisation, inventory of
reusable residuals, quotations and documents.

* All lengths in **mm**, areas in m², angles in degrees.
* Authentication: `POST /api/v1/auth/login` → bearer JWT; click *Authorize* and paste the token.
* Roles: `admin`, `engineer`, `estimator`, `viewer` (read-only).
* Errors: `{"detail": {"code", "message", "issues": [Issue]}}`.
* **All catalogue data and calculation rules are DEMO / PROVISIONAL** — not manufacturer data, not for production.
"""

TAGS = [
    {"name": "health", "description": "Liveness / readiness (public)."},
    {"name": "auth", "description": "Login (rate-limited, generic errors) and current user."},
    {"name": "customers", "description": "Customer master data."},
    {"name": "projects", "description": "Projects, members, elevations collection, immutable revisions."},
    {"name": "elevations", "description": "Elevation CRUD with optimistic locking (`version`), persisted calc runs."},
    {"name": "catalogue", "description": "Versioned catalogue (DEMO data). Edits create a new revision (admin)."},
    {"name": "calc", "description": "Calculation engine (PROVISIONAL demo rules)."},
    {"name": "cutting", "description": "1D bar cutting optimisation, jobs, Excel import, build from calc runs."},
    {"name": "nesting", "description": "2D sheet nesting (guillotine) optimisation, jobs, Excel import."},
    {"name": "inventory", "description": "Stock and reusable residuals (offcuts / sheet remnants)."},
    {"name": "quotes", "description": "Quotations from calc-run BOMs × demo prices (always provisional)."},
    {"name": "reports", "description": "PDF / Excel documents with versions, status and DEMO banner."},
    {"name": "admin", "description": "User administration and audit trail (admin only)."},
]


def create_app(settings: Optional[Settings] = None, engine=None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_json)
    engine = engine or make_engine(settings.database_url, settings.db_echo)
    SessionLocal = make_sessionmaker(engine)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        for w in settings.startup_warnings():
            log.warning(w)
        if settings.seed_on_startup:
            try:
                from .seed import run_seed
                with SessionLocal() as db:
                    log.info("seed complete", extra={"seed": run_seed(db, settings)})
            except Exception:  # noqa: BLE001
                log.exception("seed failed - is the database migrated? run `alembic upgrade head`")
        yield
        engine.dispose()

    app = FastAPI(title="ITMC FenestrationOS API", version=APP_VERSION, description=DESCRIPTION,
                  openapi_tags=TAGS, lifespan=lifespan, docs_url="/docs", redoc_url="/redoc",
                  openapi_url="/api/v1/openapi.json")
    app.state.settings = settings
    app.state.engine = engine
    app.state.SessionLocal = SessionLocal
    app.state.login_limiter = LoginRateLimiter(settings.login_max_failures_per_email,
                                               settings.login_max_failures_per_ip, settings.login_window_s)
    install_handlers(app)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=False,
                       allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                       allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
                       expose_headers=["X-Request-ID", "Content-Disposition", "X-Validation-Status",
                                       "X-Provisional"])
    app.add_middleware(RequestContextMiddleware, hsts=settings.env == "prod")
    app.include_router(api_router)

    _mount_frontend(app, settings)
    return app


def _mount_frontend(app: FastAPI, settings: Settings) -> None:
    """Serve the built SPA (single-container deployment) when ../frontend/dist exists."""
    if not settings.serve_frontend:
        return
    dist = Path(settings.frontend_dist) if settings.frontend_dist else \
        Path(__file__).resolve().parents[2] / "frontend" / "dist"
    index = dist / "index.html"
    if not index.is_file():
        return
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
    root = dist.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path.startswith("api/") or path == "api":
            return JSONResponse(status_code=404, content=body("NOT_FOUND", f"No API route /{path}"))
        candidate = (root / path).resolve()
        if path and candidate.is_file() and root in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(index)


app = create_app()
