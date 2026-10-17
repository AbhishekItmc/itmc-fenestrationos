"""Structured JSON logging with request-id correlation."""
from __future__ import annotations

import contextvars
import json
import logging
import sys
from datetime import datetime, timezone

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")

_STD = set(logging.LogRecord("x", 0, "x", 0, "x", None, None).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        d = {"ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
             "level": record.levelname, "logger": record.name, "msg": record.getMessage(),
             "request_id": getattr(record, "request_id", None) or request_id_var.get()}
        for k, v in record.__dict__.items():
            if k not in _STD and k not in d and not k.startswith("_"):
                try:
                    json.dumps(v)
                    d[k] = v
                except TypeError:
                    d[k] = str(v)
        if record.exc_info:
            d["exc"] = self.formatException(record.exc_info)
        return json.dumps(d, ensure_ascii=False)


def configure_logging(level: str = "INFO", json_logs: bool = True) -> None:
    root = logging.getLogger()
    for h in list(root.handlers):
        if getattr(h, "_fos", False):
            root.removeHandler(h)
    h = logging.StreamHandler(sys.stdout)
    h._fos = True  # type: ignore[attr-defined]
    h.setFormatter(JsonFormatter() if json_logs else logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s"))
    root.addHandler(h)
    root.setLevel(level.upper())
    # uvicorn's own access log is replaced by our structured access log
    logging.getLogger("uvicorn.access").disabled = True
