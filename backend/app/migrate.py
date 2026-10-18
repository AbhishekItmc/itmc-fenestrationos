"""Start-up database tasks: optional `alembic upgrade head` and idempotent seeding.

Serverless hosts (e.g. Vercel Functions) have no release/entrypoint step and may cold-start several instances at
once. On PostgreSQL both tasks therefore run while holding a session advisory lock, so exactly one instance
migrates/seeds at a time; the others wait, then find the schema at head and the seed data present.
"""
from __future__ import annotations

import logging
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

log = logging.getLogger("fos.migrate")
_LOCK_KEY = 7_302_026  # arbitrary, app-specific advisory lock id
_BACKEND_ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def startup_lock(engine: Engine) -> Iterator[Connection]:
    """Hold a PostgreSQL advisory lock for the duration (no-op lock on other databases)."""
    with engine.connect() as conn:
        pg = conn.dialect.name == "postgresql"
        if pg:
            conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": _LOCK_KEY})
            conn.commit()
        try:
            yield conn
        finally:
            if pg:
                conn.rollback()
                conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": _LOCK_KEY})
                conn.commit()


def migrate_to_head(conn: Connection) -> None:
    cfg = Config(str(_BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_ROOT / "alembic"))
    cfg.attributes["connection"] = conn
    cfg.attributes["database_url"] = conn.engine.url.render_as_string(hide_password=False)
    command.upgrade(cfg, "head")
    conn.commit()
    log.info("database migrated to head")
