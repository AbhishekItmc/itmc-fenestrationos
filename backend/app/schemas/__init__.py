"""API-only Pydantic schemas (engine payloads come from app.engines.models)."""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..engines.models import (CalcResult, Cutting1DRequest, Cutting1DResult, Elevation as ElevationModel, Issue,
                              Nesting2DRequest, Nesting2DResult)

Role = Literal["admin", "engineer", "estimator", "viewer", "operator"]
ProjectStatus = Literal["enquiry", "design", "quoted", "won", "production", "closed"]
_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")


def _email(v: str) -> str:
    v = v.strip().lower()
    if not _EMAIL.match(v) or len(v) > 254:
        raise ValueError("invalid e-mail address")
    return v


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------- auth / users
class LoginIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=1, max_length=256)

    @field_validator("email")
    @classmethod
    def _e(cls, v: str) -> str:
        return v.strip().lower()


class UserOut(ORM):
    id: int
    email: str
    name: str
    role: Role
    active: bool
    created_at: datetime
    last_login_at: Optional[datetime] = None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class UserCreate(BaseModel):
    email: str
    name: str = Field(min_length=1, max_length=200)
    role: Role = "viewer"
    password: str = Field(min_length=8, max_length=72)

    @field_validator("email")
    @classmethod
    def _e(cls, v: str) -> str:
        return _email(v)


class UserUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    role: Optional[Role] = None
    active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=8, max_length=72)


# ---------------------------------------------------------------- customers / projects
class CustomerIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    contact_name: Optional[str] = Field(default=None, max_length=200)
    email: Optional[str] = Field(default=None, max_length=254)
    phone: Optional[str] = Field(default=None, max_length=50)
    address: Optional[str] = Field(default=None, max_length=2000)
    notes: Optional[str] = Field(default=None, max_length=5000)

    @field_validator("email")
    @classmethod
    def _e(cls, v: Optional[str]) -> Optional[str]:
        return _email(v) if v else None


class CustomerUpdate(CustomerIn):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)


class CustomerOut(ORM):
    id: int
    name: str
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    demo: bool = False
    created_at: datetime
    updated_at: datetime


class ProjectIn(BaseModel):
    code: str = Field(min_length=1, max_length=50, pattern=r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")
    name: str = Field(min_length=1, max_length=200)
    customer_id: Optional[int] = None
    site: Optional[str] = Field(default=None, max_length=300)
    status: ProjectStatus = "enquiry"
    description: Optional[str] = Field(default=None, max_length=5000)


class ProjectUpdate(BaseModel):
    code: Optional[str] = Field(default=None, min_length=1, max_length=50, pattern=r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    customer_id: Optional[int] = None
    site: Optional[str] = Field(default=None, max_length=300)
    status: Optional[ProjectStatus] = None
    description: Optional[str] = Field(default=None, max_length=5000)


class ProjectOut(ORM):
    id: int
    code: str
    name: str
    customer_id: Optional[int] = None
    customer_name: Optional[str] = None
    site: Optional[str] = None
    status: ProjectStatus
    description: Optional[str] = None
    owner_id: Optional[int] = None
    demo: bool = False
    created_at: datetime
    updated_at: datetime


class MemberIn(BaseModel):
    user_id: int
    role: Literal["editor", "viewer"] = "editor"


class MemberOut(ORM):
    id: int
    project_id: int
    user_id: int
    email: Optional[str] = None
    name: Optional[str] = None
    role: str
    created_at: datetime


class RevisionIn(BaseModel):
    label: Optional[str] = Field(default=None, max_length=100)
    note: Optional[str] = Field(default=None, max_length=5000)


class RevisionOut(ORM):
    id: int
    project_id: int
    rev_no: int
    label: str
    note: Optional[str] = None
    created_by: Optional[int] = None
    created_at: datetime
    snapshot: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------- elevations / calc
class ElevationCreate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    data: ElevationModel


class ElevationUpdate(BaseModel):
    version: int = Field(ge=1, description="Current version (optimistic lock); 409 on mismatch")
    name: Optional[str] = Field(default=None, max_length=200)
    data: Optional[ElevationModel] = None


class ElevationOut(ORM):
    id: int
    project_id: int
    name: str
    data: Dict[str, Any]
    version: int
    updated_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    issues: List[Issue] = []


class CalculateIn(BaseModel):
    rule_set_id: Optional[str] = None


class CalcRunOut(ORM):
    id: int
    elevation_id: Optional[int] = None
    elevation_version: Optional[int] = None
    project_id: Optional[int] = None
    validation_status: str
    inputs_hash: str
    engine_version: str
    catalogue_version: str
    rule_set_id: str
    rule_set_version: str
    created_by: Optional[int] = None
    created_at: datetime
    result: Optional[CalcResult] = None


# ---------------------------------------------------------------- jobs
class CuttingJobCreate(BaseModel):
    project_id: Optional[int] = None
    name: str = Field(min_length=1, max_length=200)
    request: Cutting1DRequest
    optimize: bool = True
    consume_inventory: bool = Field(default=False, description="Consume INV-<id> stocks used by the result")


class NestingJobCreate(BaseModel):
    project_id: Optional[int] = None
    name: str = Field(min_length=1, max_length=200)
    request: Nesting2DRequest
    optimize: bool = True
    consume_inventory: bool = False


class JobSummaryOut(ORM):
    id: int
    project_id: Optional[int] = None
    name: str
    status: str
    validation_status: Optional[str] = None
    engine_version: Optional[str] = None
    demo: bool = False
    source_calc_run_id: Optional[int] = None
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    summary: Optional[Dict[str, Any]] = None


class CuttingJobOut(JobSummaryOut):
    profile_id: Optional[str] = None
    request: Cutting1DRequest
    result: Optional[Cutting1DResult] = None
    inventory_consumed: Dict[int, int] = {}


class NestingJobOut(JobSummaryOut):
    request: Nesting2DRequest
    result: Optional[Nesting2DResult] = None
    inventory_consumed: Dict[int, int] = {}


class FromCalcIn(BaseModel):
    kerf: Optional[float] = Field(default=None, ge=0)
    trim_start: Optional[float] = Field(default=None, ge=0)
    trim_end: Optional[float] = Field(default=None, ge=0)
    min_reusable_offcut: Optional[float] = Field(default=None, ge=0)
    use_inventory: bool = Field(default=False, description="Prepend available inventory bars/offcuts of the "
                                                           "same profile code as stock (consumed first)")


class FromCalcItem(BaseModel):
    profile_id: str
    profile_code: str
    request: Cutting1DRequest
    job_id: Optional[int] = None
    validation_status: Optional[str] = None
    summary: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------- inventory
class InventoryIn(BaseModel):
    kind: Literal["bar", "sheet", "item"]
    material: Optional[str] = Field(default=None, max_length=100)
    profile_code: Optional[str] = Field(default=None, max_length=100)
    length: Optional[float] = Field(default=None, gt=0)
    width: Optional[float] = Field(default=None, gt=0)
    height: Optional[float] = Field(default=None, gt=0)
    thickness: Optional[float] = Field(default=None, gt=0)
    quantity: int = Field(default=1, ge=0)
    is_residual: bool = False
    location: Optional[str] = Field(default=None, max_length=100)
    status: Literal["available", "reserved", "consumed"] = "available"
    notes: Optional[str] = Field(default=None, max_length=2000)
    unit: Optional[Literal["pcs", "m", "m2"]] = Field(default=None, description="kind=item only")


class InventoryUpdate(BaseModel):
    material: Optional[str] = Field(default=None, max_length=100)
    quantity: Optional[int] = Field(default=None, ge=0)
    location: Optional[str] = Field(default=None, max_length=100)
    status: Optional[Literal["available", "reserved", "consumed"]] = None
    notes: Optional[str] = Field(default=None, max_length=2000)


class InventoryOut(ORM):
    id: int
    kind: str
    material: Optional[str] = None
    profile_code: Optional[str] = None
    length: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    thickness: Optional[float] = None
    quantity: int
    is_residual: bool
    source_kind: Optional[str] = None
    source_job_id: Optional[int] = None
    location: Optional[str] = None
    status: str
    demo: bool
    notes: Optional[str] = None
    unit: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ConsumeIn(BaseModel):
    quantity: int = Field(default=1, ge=1)
    job_id: Optional[int] = None
    note: Optional[str] = Field(default=None, max_length=500)


class ResidualIn(BaseModel):
    location: Optional[str] = Field(default=None, max_length=100)


# ---------------------------------------------------------------- quotes
class QuoteCreate(BaseModel):
    calc_run_ids: List[int] = Field(min_length=1, max_length=200)
    margin_pct: float = Field(default=0.0, ge=0, le=500)
    notes: Optional[str] = Field(default=None, max_length=5000)


class QuoteUpdate(BaseModel):
    status: Optional[Literal["draft", "sent", "accepted", "rejected", "cancelled"]] = None
    notes: Optional[str] = Field(default=None, max_length=5000)


class QuoteOut(ORM):
    id: int
    project_id: int
    number: str
    status: str
    currency: str
    calc_run_ids: List[int]
    lines: List[Dict[str, Any]]
    subtotal: float
    margin_pct: float
    margin_amount: float
    total: float
    validation_status: str
    provisional: bool
    catalogue_version: Optional[str] = None
    notes: Optional[str] = None
    issues: List[Dict[str, Any]] = []
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------- audit
class AuditOut(ORM):
    id: int
    ts: datetime
    user_id: Optional[int] = None
    user_email: Optional[str] = None
    action: str
    entity: str
    entity_id: Optional[str] = None
    detail: Optional[Any] = None
    ip: Optional[str] = None
    request_id: Optional[str] = None


class Page(BaseModel):
    items: List[Any]
    total: int
    limit: int
    offset: int


class ImportOut(BaseModel):
    pieces: List[Any]
    sheets: List[Any] = []
    stocks: List[Any] = []
    settings: Dict[str, Any] = {}
    issues: List[Issue] = []


# ---------------------------------------------------------------- production (§8.1)
OrderStatus = Literal["planned", "released", "in_progress", "done", "cancelled"]
PartStatus = Literal["pending", "in_progress", "done", "blocked"]
PartAction = Literal["start", "complete", "block", "unblock", "note"]


class ProductionOrderCreate(BaseModel):
    project_id: int
    name: str = Field(min_length=1, max_length=200)
    calc_run_ids: List[int] = Field(min_length=1, max_length=200)
    due_date: Optional[date] = None
    notes: Optional[str] = Field(default=None, max_length=5000)


class ProductionOrderUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    status: Optional[OrderStatus] = None
    due_date: Optional[date] = None
    notes: Optional[str] = Field(default=None, max_length=5000)


class PartCounts(BaseModel):
    total: int = 0
    pending: int = 0
    in_progress: int = 0
    done: int = 0
    blocked: int = 0


class ProductionOrderOut(ORM):
    id: int
    number: str
    project_id: int
    name: str
    status: OrderStatus
    calc_run_ids: List[int]
    due_date: Optional[date] = None
    notes: Optional[str] = None
    provisional: bool = True
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    counts: PartCounts = PartCounts()


class PartOut(ORM):
    id: int
    production_order_id: int
    code: str
    kind: Literal["profile", "glass", "panel"]
    mark: str
    description: str
    item_code: Optional[str] = None
    length: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    angle_start: Optional[float] = None
    angle_end: Optional[float] = None
    calc_run_id: Optional[int] = None
    elevation_id: Optional[int] = None
    elevation_name: Optional[str] = None
    field_key: Optional[str] = None
    seq: int
    route: List[str]
    station_index: int
    current_station: Optional[str] = None
    status: PartStatus
    updated_at: datetime


class PartEventIn(BaseModel):
    station: str = Field(min_length=1, max_length=20)
    action: PartAction
    note: Optional[str] = Field(default=None, max_length=2000)


class PartEventOut(ORM):
    id: int
    part_id: int
    station: str
    action: PartAction
    note: Optional[str] = None
    user_id: Optional[int] = None
    user_name: Optional[str] = None
    ts: datetime


class PartDetailOut(BaseModel):
    part: PartOut
    order: Dict[str, Any]
    project: Dict[str, Any]
    events: List[PartEventOut]


class BoardStation(BaseModel):
    id: str
    label: str
    pending: int = 0
    in_progress: int = 0
    done_here: int = 0
    blocked: int = 0


class BoardOut(BaseModel):
    stations: List[BoardStation]
    counts: PartCounts


# ---------------------------------------------------------------- purchasing (§8.2)
POStatus = Literal["draft", "sent", "received", "cancelled"]
POCategory = Literal["profiles", "glass", "accessories", "mixed"]


class PurchaseFromCalcIn(BaseModel):
    calc_run_ids: List[int] = Field(min_length=1, max_length=200)
    cutting_job_ids: Optional[List[int]] = Field(default=None, max_length=500)
    split_by_category: bool = True


class POLine(BaseModel):
    item_type: str = Field(min_length=1, max_length=30)
    item_id: Optional[str] = Field(default=None, max_length=100)
    code: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    unit: str = Field(min_length=1, max_length=10)
    qty_required: float = Field(default=0.0, ge=0)
    qty_in_stock: float = Field(default=0.0, ge=0)
    qty_to_order: float = Field(ge=0)
    unit_price: float = Field(default=0.0, ge=0)
    amount: float = 0.0
    stock_length: Optional[float] = Field(default=None, gt=0, description="profiles: bar length (mm)")
    note: Optional[str] = Field(default=None, max_length=500)


class PurchaseOrderUpdate(BaseModel):
    supplier: Optional[str] = Field(default=None, min_length=1, max_length=200)
    status: Optional[POStatus] = None
    notes: Optional[str] = Field(default=None, max_length=5000)
    lines: Optional[List[POLine]] = Field(default=None, max_length=1000)


class PurchaseOrderOut(ORM):
    id: int
    number: str
    project_id: int
    supplier: str
    category: POCategory
    status: POStatus
    currency: str
    lines: List[Dict[str, Any]]
    total: float
    provisional: bool
    calc_run_ids: List[int] = []
    cutting_job_ids: List[int] = []
    catalogue_version: Optional[str] = None
    notes: Optional[str] = None
    received_at: Optional[datetime] = None
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime


class DxfExportIn(BaseModel):
    elevation: ElevationModel


# ---------------------------------------------------------------- website leads (demo requests)
SOLUTION_KEYS = ("design-calculation", "cutting-nesting", "production-tracking", "purchasing-quotes")
LeadStatus = Literal["new", "contacted", "closed"]


class LeadIn(BaseModel):
    """Public demo-request form. `website` is a honeypot (must be empty); `elapsed_ms` = time the form was open."""
    model_config = ConfigDict(extra="ignore")
    name: str = Field(min_length=1, max_length=200)
    company: str = Field(min_length=1, max_length=200)
    email: str = Field(max_length=254)
    phone: Optional[str] = Field(default=None, max_length=50)
    country: Optional[str] = Field(default=None, max_length=100)
    message: str = Field(min_length=1, max_length=5000)
    interest: List[Literal["design-calculation", "cutting-nesting", "production-tracking",
                           "purchasing-quotes"]] = Field(default_factory=list, max_length=4)
    source_page: Optional[str] = Field(default=None, max_length=200)
    website: Optional[str] = Field(default=None, max_length=500)
    elapsed_ms: Optional[int] = Field(default=None, ge=0)

    @field_validator("name", "company", "message")
    @classmethod
    def _strip_required(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v

    @field_validator("phone", "country", "source_page")
    @classmethod
    def _strip_optional(cls, v: Optional[str]) -> Optional[str]:
        v = (v or "").strip()
        return v or None

    @field_validator("email")
    @classmethod
    def _e(cls, v: str) -> str:
        return _email(v)

    @field_validator("interest")
    @classmethod
    def _dedupe(cls, v: List[str]) -> List[str]:
        return list(dict.fromkeys(v))


class LeadOut(ORM):
    id: int
    name: str
    company: str
    email: str
    phone: Optional[str] = None
    country: Optional[str] = None
    message: str
    interest: List[str]
    source_page: Optional[str] = None
    status: LeadStatus
    created_at: datetime
    user_agent: Optional[str] = None


class LeadUpdate(BaseModel):
    status: LeadStatus
