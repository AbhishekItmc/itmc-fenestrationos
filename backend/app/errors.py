"""Standard error shape: {"detail": {"code", "message", "issues": [Issue]}} and global handlers.

Internals (tracebacks, SQL, exception text) are never returned to clients; they are logged with the request id.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("fos.errors")

_DEFAULT_CODES = {400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND",
                  405: "METHOD_NOT_ALLOWED", 409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE", 415: "UNSUPPORTED_MEDIA_TYPE",
                  422: "VALIDATION_ERROR", 429: "RATE_LIMITED", 500: "INTERNAL_ERROR"}


class APIError(Exception):
    def __init__(self, status_code: int, code: str, message: str, issues: Optional[List[Any]] = None,
                 headers: Optional[Dict[str, str]] = None):
        self.status_code = status_code
        self.code = code
        self.message = message
        self.issues = [i.model_dump() if hasattr(i, "model_dump") else i for i in (issues or [])]
        self.headers = headers


def not_found(entity: str, entity_id: Any = None) -> APIError:
    return APIError(404, "NOT_FOUND", f"{entity} not found" if entity_id is None else f"{entity} {entity_id} not found")


def body(code: str, message: str, issues: Optional[List[Any]] = None) -> Dict[str, Any]:
    return {"detail": {"code": code, "message": message, "issues": issues or []}}


def _rid(request: Request) -> Optional[str]:
    return getattr(request.state, "request_id", None)


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(APIError)
    async def _api_error(request: Request, exc: APIError):
        return JSONResponse(status_code=exc.status_code, content=body(exc.code, exc.message, exc.issues),
                            headers=exc.headers)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException):
        d = exc.detail
        if isinstance(d, dict) and "code" in d:
            content = {"detail": {"code": d["code"], "message": d.get("message", ""), "issues": d.get("issues", [])}}
        else:
            msg = d if isinstance(d, str) else _DEFAULT_CODES.get(exc.status_code, "ERROR").replace("_", " ").lower()
            content = body(_DEFAULT_CODES.get(exc.status_code, "HTTP_ERROR"), msg)
        return JSONResponse(status_code=exc.status_code, content=content, headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError):
        issues = []
        for e in exc.errors():
            loc = [str(x) for x in e.get("loc", ())]
            issue = {"code": str(e.get("type", "invalid")).upper(), "severity": "error",
                     "message": str(e.get("msg", "invalid value")), "ref": ".".join(loc) or None,
                     "loc": loc, "type": e.get("type")}
            if "ctx" in e:
                issue["ctx"] = {k: (v if isinstance(v, (int, float, str, bool, type(None))) else str(v))
                                for k, v in e["ctx"].items()}
            issues.append(issue)
        return JSONResponse(status_code=422, content=body("VALIDATION_ERROR", "Request validation failed", issues))

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        log.exception("unhandled error", extra={"request_id": _rid(request), "path": request.url.path})
        return JSONResponse(status_code=500,
                            content=body("INTERNAL_ERROR", f"Internal server error (request id {_rid(request)})"))
