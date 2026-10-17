from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...db import get_db
from ...errors import APIError
from ...models import Customer, Project, User
from ...schemas import CustomerIn, CustomerOut, CustomerUpdate
from ...security import ANY, PROJECT_WRITERS, require_roles
from ...services.audit import audit
from ..deps import get_or_404

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("", response_model=List[CustomerOut])
def list_customers(q: Optional[str] = Query(None, max_length=100), limit: int = Query(200, ge=1, le=1000),
                   offset: int = Query(0, ge=0), db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    stmt = select(Customer).order_by(Customer.name)
    if q:
        stmt = stmt.where(func.lower(Customer.name).contains(q.lower()))
    return db.scalars(stmt.limit(limit).offset(offset)).all()


@router.post("", response_model=CustomerOut, status_code=201)
def create_customer(body: CustomerIn, request: Request, db: Session = Depends(get_db),
                    user: User = Depends(require_roles(*PROJECT_WRITERS))):
    c = Customer(**body.model_dump(), created_by=user.id)
    db.add(c)
    db.flush()
    audit(db, request, user, "create", "customer", c.id, {"name": c.name})
    db.commit()
    return c


@router.get("/{customer_id}", response_model=CustomerOut)
def get_customer(customer_id: int, db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    return get_or_404(db, Customer, customer_id, "Customer")


@router.put("/{customer_id}", response_model=CustomerOut)
def update_customer(customer_id: int, body: CustomerUpdate, request: Request, db: Session = Depends(get_db),
                    user: User = Depends(require_roles(*PROJECT_WRITERS))):
    c = get_or_404(db, Customer, customer_id, "Customer")
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(c, k, v)
    audit(db, request, user, "update", "customer", c.id, {"changes": list(changes)})
    db.commit()
    db.refresh(c)
    return c


@router.delete("/{customer_id}", status_code=204)
def delete_customer(customer_id: int, request: Request, db: Session = Depends(get_db),
                    user: User = Depends(require_roles(*PROJECT_WRITERS))):
    c = get_or_404(db, Customer, customer_id, "Customer")
    n = db.scalar(select(func.count(Project.id)).where(Project.customer_id == c.id))
    if n:
        raise APIError(409, "CUSTOMER_IN_USE", f"Customer has {n} project(s); reassign or delete them first")
    db.delete(c)
    audit(db, request, user, "delete", "customer", customer_id, {"name": c.name})
    db.commit()
    return Response(status_code=204)
