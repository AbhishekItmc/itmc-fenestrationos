"""Application settings (12-factor: everything from environment / .env).

No secrets are hard-coded. In production (`ENV=prod`) `JWT_SECRET` is mandatory; in dev/test an ephemeral
random secret is generated at start-up (tokens become invalid on restart) and a warning is logged.
"""
from __future__ import annotations

import logging
import secrets
from functools import lru_cache
from typing import List, Literal, Optional

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger("fos.config")

APP_VERSION = "0.1.0"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore",
                                      case_sensitive=False)

    env: Literal["dev", "test", "prod"] = "dev"
    database_url: str = "postgresql+psycopg://fos:fos_dev@localhost:5432/fos"
    db_echo: bool = False
    # Connection pool per process. Serverless hosts (Vercel) run many small instances: keep it tiny there.
    db_pool_size: Optional[int] = None      # default: 10, or 2 when running on Vercel (VERCEL=1)
    db_max_overflow: Optional[int] = None   # default: 20, or 3 on Vercel
    # Run `alembic upgrade head` (under a PostgreSQL advisory lock) at start-up. Needed on hosts without a
    # release/entrypoint step, e.g. Vercel. Docker uses docker-entrypoint.sh instead.
    auto_migrate: bool = False
    # Direct (non-pooled) connection for start-up migrate/seed lock. Neon on Vercel injects DATABASE_URL (pooled,
    # PgBouncer transaction mode - session advisory locks are unsafe there) and DATABASE_URL_UNPOOLED (direct).
    database_url_unpooled: Optional[str] = None

    jwt_secret: Optional[str] = Field(default=None, repr=False)
    jwt_algorithm: Literal["HS256"] = "HS256"
    jwt_expire_min: int = Field(default=480, ge=1, le=60 * 24 * 7)

    # comma separated list (or JSON list) of allowed origins
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    seed_on_startup: bool = True          # ensure catalogue revision exists (+ demo users/data if enabled)
    seed_demo_users: bool = False
    seed_demo_data: Optional[bool] = None  # None -> follows seed_demo_users
    demo_password: Optional[str] = Field(default=None, repr=False)

    login_max_failures_per_email: int = 5
    login_max_failures_per_ip: int = 20
    login_window_s: int = 300

    max_upload_mb: float = 5.0
    log_level: str = "INFO"
    log_json: bool = True
    serve_frontend: bool = True
    frontend_dist: Optional[str] = None   # default ../frontend/dist relative to backend/

    @field_validator("database_url", "database_url_unpooled")
    @classmethod
    def _db(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return v
        # accept plain postgres URLs and force the psycopg 3 driver
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://"):]
        if v.startswith("postgresql://"):
            v = "postgresql+psycopg://" + v[len("postgresql://"):]
        return v

    @model_validator(mode="after")
    def _secrets(self) -> "Settings":
        if not self.jwt_secret:
            if self.env == "prod":
                raise ValueError("JWT_SECRET is required when ENV=prod")
            object.__setattr__(self, "jwt_secret", secrets.token_urlsafe(48))
            object.__setattr__(self, "_ephemeral_secret", True)
        elif self.env == "prod" and len(self.jwt_secret) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters in production")
        if self.seed_demo_users and not self.demo_password:
            if self.env == "prod":
                raise ValueError("DEMO_PASSWORD is required when SEED_DEMO_USERS=1")
            # dev/test: random password, logged once so the developer can still log in
            object.__setattr__(self, "demo_password", secrets.token_urlsafe(12))
            object.__setattr__(self, "_generated_demo_password", True)
        return self

    @property
    def startup_database_url(self) -> str:
        return self.database_url_unpooled or self.database_url

    @property
    def on_vercel(self) -> bool:
        import os
        return os.environ.get("VERCEL") == "1"

    @property
    def pool_size(self) -> int:
        return self.db_pool_size if self.db_pool_size is not None else (2 if self.on_vercel else 10)

    @property
    def max_overflow(self) -> int:
        return self.db_max_overflow if self.db_max_overflow is not None else (3 if self.on_vercel else 20)

    @property
    def cors_origin_list(self) -> List[str]:
        raw = self.cors_origins.strip()
        if raw.startswith("["):
            import json
            return [str(x) for x in json.loads(raw)]
        return [o.strip() for o in raw.split(",") if o.strip()]

    @property
    def demo_data_enabled(self) -> bool:
        return self.seed_demo_users if self.seed_demo_data is None else self.seed_demo_data

    def startup_warnings(self) -> List[str]:
        w = []
        if getattr(self, "_ephemeral_secret", False):
            w.append("JWT_SECRET not set: using an EPHEMERAL random secret (dev/test only); tokens are invalidated "
                     "on restart.")
        if getattr(self, "_generated_demo_password", False):
            w.append(f"DEMO_PASSWORD not set: generated random demo password '{self.demo_password}' (dev only).")
        if self.env == "prod" and self.seed_demo_users:
            w.append("SEED_DEMO_USERS is enabled in production - demo accounts exist.")
        return w


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
