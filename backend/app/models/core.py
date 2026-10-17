"""SQLAlchemy ORM models.

JSON columns use JSONB on PostgreSQL and JSON on SQLite (see app.db.JSONType). Engine payloads
(Elevation, CalcResult, Cutting1DRequest/Result, ...) are stored verbatim as validated JSON so that every
persisted result can be re-validated / re-rendered later with full traceability (engine & catalogue versions
are inside the payload and duplicated in indexed columns where useful).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db import Base, JSONType, utcnow

ROLES = ("admin", "engineer", "estimator", "viewer")
PROJECT_STATUSES = ("enquiry", "design", "quoted", "won", "production", "closed")


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow,
                                                 nullable=False)


class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="viewer")
    hashed_password: Mapped[str] = mapped_column(String(200), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class Customer(TimestampMixin, Base):
    __tablename__ = "customers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    contact_name: Mapped[Optional[str]] = mapped_column(String(200))
    email: Mapped[Optional[str]] = mapped_column(String(254))
    phone: Mapped[Optional[str]] = mapped_column(String(50))
    address: Mapped[Optional[str]] = mapped_column(Text)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class Project(TimestampMixin, Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id", ondelete="RESTRICT"), index=True)
    site: Mapped[Optional[str]] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="enquiry")
    description: Mapped[Optional[str]] = mapped_column(Text)
    owner_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    customer = relationship("Customer", lazy="joined")


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_member"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="viewer")  # editor|viewer
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Elevation(TimestampMixin, Base):
    __tablename__ = "elevations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    data: Mapped[dict] = mapped_column(JSONType, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class ProjectRevision(Base):
    """Immutable snapshot of a project and all its elevations. No update/delete API exists."""
    __tablename__ = "project_revisions"
    __table_args__ = (UniqueConstraint("project_id", "rev_no", name="uq_project_rev"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False)
    rev_no: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text)
    snapshot: Mapped[dict] = mapped_column(JSONType, nullable=False)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class CatalogueRevision(Base):
    __tablename__ = "catalogue_revisions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    data: Mapped[dict] = mapped_column(JSONType, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    note: Mapped[Optional[str]] = mapped_column(Text)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class CalcRun(Base):
    __tablename__ = "calc_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    elevation_id: Mapped[Optional[int]] = mapped_column(ForeignKey("elevations.id", ondelete="SET NULL"), index=True)
    elevation_version: Mapped[Optional[int]] = mapped_column(Integer)
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    result: Mapped[dict] = mapped_column(JSONType, nullable=False)
    validation_status: Mapped[str] = mapped_column(String(40), nullable=False)
    inputs_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    engine_version: Mapped[str] = mapped_column(String(50), nullable=False)
    catalogue_version: Mapped[str] = mapped_column(String(100), nullable=False)
    rule_set_id: Mapped[str] = mapped_column(String(100), nullable=False)
    rule_set_version: Mapped[str] = mapped_column(String(50), nullable=False)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class _JobMixin(TimestampMixin):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    request: Mapped[dict] = mapped_column(JSONType, nullable=False)
    result: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")  # draft|completed|invalid
    validation_status: Mapped[Optional[str]] = mapped_column(String(40))
    engine_version: Mapped[Optional[str]] = mapped_column(String(50))
    demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)  # built from demo catalogue/rules
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class CuttingJob(_JobMixin, Base):
    __tablename__ = "cutting_jobs"
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    source_calc_run_id: Mapped[Optional[int]] = mapped_column(ForeignKey("calc_runs.id", ondelete="SET NULL"))
    profile_id: Mapped[Optional[str]] = mapped_column(String(100))


class NestingJob(_JobMixin, Base):
    __tablename__ = "nesting_jobs"
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    source_calc_run_id: Mapped[Optional[int]] = mapped_column(ForeignKey("calc_runs.id", ondelete="SET NULL"))


class InventoryItem(TimestampMixin, Base):
    __tablename__ = "inventory_items"
    __table_args__ = (Index("ix_inventory_kind_material_status", "kind", "material", "status"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)          # bar|sheet
    material: Mapped[Optional[str]] = mapped_column(String(100))           # profile code (bar) / material (sheet)
    profile_code: Mapped[Optional[str]] = mapped_column(String(100))
    length: Mapped[Optional[float]] = mapped_column(Float)                 # bar
    width: Mapped[Optional[float]] = mapped_column(Float)                  # sheet
    height: Mapped[Optional[float]] = mapped_column(Float)                 # sheet
    thickness: Mapped[Optional[float]] = mapped_column(Float)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_residual: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source_kind: Mapped[Optional[str]] = mapped_column(String(20))         # cutting|nesting|manual
    source_job_id: Mapped[Optional[int]] = mapped_column(Integer)
    location: Mapped[Optional[str]] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="available")
    demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class Quote(TimestampMixin, Base):
    __tablename__ = "quotes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False)
    number: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="INR")
    calc_run_ids: Mapped[list] = mapped_column(JSONType, nullable=False, default=list)
    lines: Mapped[list] = mapped_column(JSONType, nullable=False, default=list)
    subtotal: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    margin_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    margin_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    total: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    validation_status: Mapped[str] = mapped_column(String(40), nullable=False)
    provisional: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    catalogue_version: Mapped[Optional[str]] = mapped_column(String(100))
    notes: Mapped[Optional[str]] = mapped_column(Text)
    issues: Mapped[list] = mapped_column(JSONType, nullable=False, default=list)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_entity", "entity", "entity_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    user_email: Mapped[Optional[str]] = mapped_column(String(254))
    action: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    entity: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[Optional[str]] = mapped_column(String(100))
    detail: Mapped[Optional[Any]] = mapped_column(JSONType)
    ip: Mapped[Optional[str]] = mapped_column(String(64))
    request_id: Mapped[Optional[str]] = mapped_column(String(64))
