"""Shared router helpers."""
from __future__ import annotations

from typing import Type, TypeVar

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import APIError, not_found
from ..models import Project, ProjectMember, User

T = TypeVar("T")


def get_or_404(db: Session, model: Type[T], obj_id: int, label: str | None = None) -> T:
    obj = db.get(model, obj_id)
    if obj is None:
        raise not_found(label or model.__name__, obj_id)
    return obj


def ensure_project_write(db: Session, project: Project, user: User) -> None:
    """Optional per-project permission: if a project has explicit members, non-admin users must be an
    'editor' member to change it (global role checks still apply first)."""
    if user.role == "admin":
        return
    members = db.scalars(select(ProjectMember).where(ProjectMember.project_id == project.id)).all()
    if not members:
        return
    if any(m.user_id == user.id and m.role == "editor" for m in members):
        return
    raise APIError(403, "PROJECT_FORBIDDEN", f"You are not an editor member of project {project.code}")
