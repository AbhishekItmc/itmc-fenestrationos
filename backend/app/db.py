"""Database engine/session helpers (SQLAlchemy 2). Works with PostgreSQL (prod) and SQLite (tests)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterator

from fastapi import Request
from sqlalchemy import JSON, create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

# JSONB on PostgreSQL, JSON elsewhere (SQLite)
JSONType = JSON().with_variant(JSONB(), "postgresql")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


def make_engine(url: str, echo: bool = False) -> Engine:
    if url.startswith("sqlite"):
        kw = {"connect_args": {"check_same_thread": False}}
        if ":memory:" in url or url in ("sqlite://", "sqlite+pysqlite://"):
            kw["poolclass"] = StaticPool
        return create_engine(url, echo=echo, future=True, **kw)
    return create_engine(url, echo=echo, future=True, pool_pre_ping=True, pool_size=10, max_overflow=20)


def make_sessionmaker(engine: Engine) -> sessionmaker:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def get_db(request: Request) -> Iterator[Session]:
    """FastAPI dependency: one session per request, rolled back on error."""
    db: Session = request.app.state.SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
