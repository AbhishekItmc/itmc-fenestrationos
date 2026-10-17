"""Quotation from calc-run BOMs x DEMO catalogue prices. Always provisional (demo prices/rules)."""
from __future__ import annotations

from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..engines.catalogue import get_accessory, get_colour, get_glass_type, get_panel_type, get_profile
from ..engines.models import CalcResult, Issue
from ..errors import APIError
from ..models import CalcRun, Quote

DEMO_NOTE = "Demo prices — not a commercial offer"
ACCESSORY_TYPES = {"accessory", "hardware", "gasket", "sealant", "bracket", "connector"}


def r2(x: float) -> float:
    return round(x + 0.0, 2)


def _unit_price(cat: Dict[str, Any], item_type: str, item_id: str, unit: str) -> Optional[float]:
    if item_type == "profile":
        p = get_profile(cat, item_id)
        if p is None or p.get("price_per_m") is None:
            return None
        return float(p["price_per_m"]) * (0.001 if unit == "mm" else 1.0)
    if item_type == "glass":
        g = get_glass_type(cat, item_id)
        return None if g is None or g.get("price_per_m2") is None else float(g["price_per_m2"])
    if item_type == "panel":
        p = get_panel_type(cat, item_id)
        return None if p is None or p.get("price_per_m2") is None else float(p["price_per_m2"])
    if item_type in ACCESSORY_TYPES:
        a = get_accessory(cat, item_id)
        return None if a is None or a.get("price") is None else float(a["price"])
    return None


def price_calc_runs(runs: List[CalcRun], cat: Dict[str, Any], margin_pct: float) -> Dict[str, Any]:
    issues: List[Issue] = []
    agg: "OrderedDict[tuple, Dict[str, Any]]" = OrderedDict()
    surcharge: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
    for run in runs:
        res = CalcResult.model_validate(run.result)
        colour = get_colour(cat, res.elevation.colour_id) if res.elevation.colour_id else None
        pct = float(colour.get("surcharge_pct") or 0) if colour else 0.0
        run_profile_amount = 0.0
        for b in res.bom:
            price = _unit_price(cat, b.item_type, b.item_id, b.unit)
            key = (b.item_type, b.item_id, b.unit)
            line = agg.get(key)
            if line is None:
                line = agg[key] = {"item_type": b.item_type, "item_id": b.item_id, "code": b.code,
                                   "description": b.description, "unit": b.unit, "quantity": 0.0,
                                   "unit_price": price if price is not None else 0.0, "price_missing": price is None,
                                   "calc_run_ids": [], "demo_data": True}
                if price is None:
                    issues.append(Issue(code="PRICE_MISSING", severity="warning",
                                        message=f"No demo price for {b.item_type} {b.code}; priced at 0",
                                        ref=f"bom:{b.item_id}"))
            line["quantity"] += b.quantity
            if run.id not in line["calc_run_ids"]:
                line["calc_run_ids"].append(run.id)
            if b.item_type == "profile" and price is not None:
                run_profile_amount += b.quantity * price
        if pct and colour:
            s = surcharge.setdefault(colour["id"], {"base": 0.0, "pct": pct, "colour": colour, "runs": []})
            s["base"] += run_profile_amount
            s["runs"].append(run.id)
    lines = []
    for line in agg.values():
        line["quantity"] = round(line["quantity"], 4)
        line["amount"] = r2(line["quantity"] * line["unit_price"])
        lines.append(line)
    for cid, s in surcharge.items():
        c = s["colour"]
        base = r2(s["base"])
        lines.append({"item_type": "colour_surcharge", "item_id": cid, "code": c.get("code", cid),
                      "description": f"Colour surcharge {c.get('name', cid)} ({s['pct']:g}% on profiles)",
                      "unit": "%", "quantity": s["pct"], "unit_price": base,
                      "amount": r2(base * s["pct"] / 100.0), "calc_run_ids": s["runs"], "demo_data": True,
                      "price_missing": False})
    for i, line in enumerate(lines, 1):
        line["line_no"] = i
    subtotal = r2(sum(line["amount"] for line in lines))
    margin_amount = r2(subtotal * margin_pct / 100.0)
    return {"lines": lines, "subtotal": subtotal, "margin_pct": margin_pct, "margin_amount": margin_amount,
            "total": r2(subtotal + margin_amount), "issues": [i.model_dump() for i in issues]}


def next_quote_number(db: Session, year: Optional[int] = None) -> str:
    year = year or datetime.now(timezone.utc).year
    prefix = f"Q-{year}-"
    nums = db.scalars(select(Quote.number).where(Quote.number.like(prefix + "%"))).all()
    n = max([int(x[len(prefix):]) for x in nums if x[len(prefix):].isdigit()] or [0]) + 1
    return f"{prefix}{n:04d}"


def check_runs(runs: List[CalcRun], project_id: int, requested: List[int]) -> None:
    found = {r.id for r in runs}
    missing = [i for i in requested if i not in found]
    if missing:
        raise APIError(404, "CALC_RUN_NOT_FOUND", f"Calc run(s) {missing} not found in project {project_id}")
    bad = [r.id for r in runs if r.validation_status == "INVALID"]
    if bad:
        raise APIError(400, "CALC_RUN_INVALID", f"Calc run(s) {bad} are INVALID and cannot be quoted")
