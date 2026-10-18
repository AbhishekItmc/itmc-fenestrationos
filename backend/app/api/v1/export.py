"""CAD export (ARCHITECTURE §8.4): ASCII DXF R12 in millimetres."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ...db import get_db
from ...engines.dxf_export import elevation_to_dxf
from ...engines.models import Elevation as ElevationModel
from ...errors import APIError
from ...models import Elevation, User
from ...schemas import DxfExportIn
from ...security import ANY, require_roles
from ...services.audit import audit
from ...services.catalogue import get_catalogue
from ..deps import get_or_404

router = APIRouter(tags=["export"])
DXF = "application/dxf"


def _catalogue(db: Session):
    try:
        return get_catalogue(db)
    except APIError:
        return None


def _resp(text: str, name: str) -> Response:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_") or "elevation"
    return Response(text.encode("ascii", "replace"), media_type=DXF,
                    headers={"Content-Disposition": f'attachment; filename="{safe}.dxf"'})


@router.get("/elevations/{elevation_id}/export.dxf", summary="Elevation drawing as DXF R12 (mm)")
def elevation_dxf(elevation_id: int, request: Request, db: Session = Depends(get_db),
                  user: User = Depends(require_roles(*ANY))):
    e = get_or_404(db, Elevation, elevation_id, "Elevation")
    text = elevation_to_dxf(ElevationModel.model_validate(e.data), _catalogue(db))
    audit(db, request, user, "export", "elevation", e.id, {"format": "dxf", "version": e.version,
                                                           "bytes": len(text)}, commit=True)
    return _resp(text, e.name)


@router.post("/export/dxf", summary="Stateless: Elevation JSON -> DXF R12 (mm)")
def export_dxf(body: DxfExportIn, db: Session = Depends(get_db), _: User = Depends(require_roles(*ANY))):
    return _resp(elevation_to_dxf(body.elevation, _catalogue(db)), body.elevation.name)
