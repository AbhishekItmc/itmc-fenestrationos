"""Request-ID, structured access logging and security headers (pure ASGI middleware)."""
from __future__ import annotations

import logging
import re
import time
import uuid

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .logging_conf import request_id_var

log = logging.getLogger("fos.access")
_RID_OK = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
DOCS_CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://fastapi.tiangolo.com; "
            "frame-ancestors 'none'")
SPA_CSP = ("default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
           "connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'")


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp, hsts: bool = False):
        self.app = app
        self.hsts = hsts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = None
        for k, v in scope.get("headers", []):
            if k == b"x-request-id":
                incoming = v.decode("latin-1")
                break
        rid = incoming if incoming and _RID_OK.match(incoming) else uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = rid
        token = request_id_var.set(rid)
        path = scope.get("path", "")
        t0 = time.perf_counter()
        status = {"code": 500}

        async def _send(message: Message) -> None:
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
                h = MutableHeaders(scope=message)
                h["X-Request-ID"] = rid
                h.setdefault("X-Content-Type-Options", "nosniff")
                h.setdefault("X-Frame-Options", "DENY")
                h.setdefault("Referrer-Policy", "no-referrer")
                h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
                h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
                if path.startswith("/docs") or path.startswith("/redoc"):
                    h.setdefault("Content-Security-Policy", DOCS_CSP)
                elif path.startswith("/api/"):
                    h.setdefault("Content-Security-Policy", API_CSP)
                    h.setdefault("Cache-Control", "no-store")
                else:
                    h.setdefault("Content-Security-Policy", SPA_CSP)
                if self.hsts:
                    h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
            await send(message)

        try:
            await self.app(scope, receive, _send)
        finally:
            client = scope.get("client") or ("-", 0)
            log.info("request", extra={"method": scope.get("method"), "path": path, "status": status["code"],
                                       "duration_ms": round((time.perf_counter() - t0) * 1000, 1),
                                       "client_ip": client[0]})
            request_id_var.reset(token)
