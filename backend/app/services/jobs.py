"""Orchestration of calc runs and optimisation jobs (engines are pure; persistence lives here)."""
from __future__ import annotations

from collections import OrderedDict
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ..engines.calc import calculate
from ..engines.catalogue import get_profile
from ..engines.cutting1d import optimize_1d
from ..engines.models import (CalcResult, Cutting1DRequest, Elevation as ElevationModel, Nesting2DRequest, Piece1D,
                              Stock1D)
from ..engines.nesting2d import optimize_2d
from ..errors import APIError
from ..models import CalcRun, CuttingJob, Elevation, NestingJob, User

DEFAULT_CUT_SETTINGS = {"kerf": 4.0, "trim_start": 10.0, "trim_end": 0.0, "min_reusable_offcut": 500.0}


def run_calc(db: Session, elev_row: Elevation, catalogue: Dict[str, Any], user: User,
             rule_set_id: Optional[str] = None) -> CalcRun:
    elev = ElevationModel.model_validate(elev_row.data)
    if not elev.id:
        elev.id = str(elev_row.id)
    result = calculate(elev, catalogue, rule_set_id)
    run = CalcRun(elevation_id=elev_row.id, elevation_version=elev_row.version, project_id=elev_row.project_id,
                  result=result.model_dump(mode="json"), validation_status=result.validation_status,
                  inputs_hash=result.inputs_hash, engine_version=result.engine_version,
                  catalogue_version=result.catalogue_version, rule_set_id=result.rule_set_id,
                  rule_set_version=result.rule_set_version, created_by=user.id)
    db.add(run)
    db.flush()
    return run


def job_status(validation_status: str) -> str:
    return "invalid" if validation_status == "INVALID" else "completed"


def run_cutting(req: Cutting1DRequest) -> Dict[str, Any]:
    return optimize_1d(req).model_dump(mode="json")


def run_nesting(req: Nesting2DRequest) -> Dict[str, Any]:
    return optimize_2d(req).model_dump(mode="json")


def apply_cutting_result(job: CuttingJob | NestingJob, result: Dict[str, Any]) -> None:
    job.result = result
    job.validation_status = result["validation_status"]
    job.engine_version = result["engine_version"]
    job.status = job_status(result["validation_status"])


def cutting_requests_from_calc(run: CalcRun, catalogue: Dict[str, Any], overrides: Dict[str, Any],
                               extra_stocks: Optional[Dict[str, List[Stock1D]]] = None) -> List[Dict[str, Any]]:
    """Group the calc run's ProfileCuts by profile_id -> one Cutting1DRequest per profile.
    Stock = the profile's catalogue stock_lengths, quantity unlimited (+ optional inventory offcuts)."""
    result = CalcResult.model_validate(run.result)
    if result.validation_status == "INVALID" or not result.profile_cuts:
        raise APIError(400, "CALC_RUN_INVALID", "Calc run has no valid profile cuts (status "
                                                f"{result.validation_status}); fix the elevation and recalculate",
                       [i for i in result.issues if i.severity == "error"])
    groups: "OrderedDict[str, List]" = OrderedDict()
    for c in result.profile_cuts:
        groups.setdefault(c.profile_id, []).append(c)
    settings = {**DEFAULT_CUT_SETTINGS, **{k: v for k, v in overrides.items() if v is not None}}
    out = []
    for pid, cuts in groups.items():
        prof = get_profile(catalogue, pid) or {}
        code = prof.get("code") or cuts[0].profile_code
        lengths = prof.get("stock_lengths") or []
        if not lengths:
            raise APIError(400, "NO_STOCK_LENGTHS", f"Profile {code} has no stock_lengths in catalogue "
                                                    f"{result.catalogue_version}")
        stocks = [Stock1D(id=f"{code}-{int(L) if float(L).is_integer() else L}", label=f"{code} {L:g} mm bar",
                          length=float(L), quantity=None) for L in lengths]
        stocks = list((extra_stocks or {}).get(code, [])) + stocks
        pieces: "OrderedDict[str, Piece1D]" = OrderedDict()
        for c in cuts:
            if c.mark in pieces:  # same mark repeated -> merge quantities (same length by construction)
                pieces[c.mark].quantity += c.quantity
                continue
            pieces[c.mark] = Piece1D(id=c.mark, label=f"{c.mark} {c.role}" + (f" ({c.position})" if c.position else ""),
                                     length=c.length, quantity=c.quantity, angle_start=c.angle_start,
                                     angle_end=c.angle_end)
        req = Cutting1DRequest(material=code, stocks=stocks, pieces=list(pieces.values()), **settings)
        out.append({"profile_id": pid, "profile_code": code, "request": req})
    return out
