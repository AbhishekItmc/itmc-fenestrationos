"""Elevation calculation: cut list, glass/fill sizes and BOM from a stick curtain-wall elevation.

ALL RULES ARE PROVISIONAL DEMO RULES. Every derived number is driven by documented rule-set params
(catalogue `rule_sets[].params`), recorded in each item's `formula` and `rule_ids`. Nothing here is
manufacturer data or an approved fabrication rule.
"""
from __future__ import annotations

import hashlib
import json
import math
from collections import OrderedDict, defaultdict
from typing import Any, Dict, List, Optional, Tuple

from .catalogue import (find_accessory, get_glass_type, get_panel_type, get_profile, get_rule_set,
                        get_series)
from .elevation import (effective_mullion_profile_id, effective_transom_profile_id, field_rects,
                        resolve_fill, resolve_rule_set, validate_elevation)
from .models import BomLine, CalcResult, Elevation, GlassItem, Issue, ProfileCut, ValidationReport
from .units import EPS, round_to
from .validators import validate_calc

ENGINE_VERSION = "calc/0.1.0-demo"


def _hash_inputs(elev: Elevation, rule_set_id: str, catalogue_version: str) -> str:
    payload = {"elevation": elev.model_dump(mode="json"), "rule_set_id": rule_set_id,
               "catalogue_version": catalogue_version}
    s = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _fmt(v: float) -> str:
    return f"{v:g}"


def calculate(elev: Elevation, catalogue: Dict[str, Any], rule_set_id: Optional[str] = None) -> CalcResult:
    cat_version = str(catalogue.get("catalogue_version", "UNKNOWN"))
    issues: List[Issue] = list(validate_elevation(elev, catalogue, rule_set_id))
    rs = resolve_rule_set(elev, catalogue, rule_set_id)
    if rs is None and not any(i.code in ("RULE_SET_NOT_FOUND", "SYSTEM_NOT_SET", "SYSTEM_NOT_FOUND") for i in issues):
        issues.append(Issue(code="RULE_SET_NOT_FOUND", severity="error",
                            message="No rule set available for this elevation", ref="rule_set"))
    if rs is not None:
        missing = [p for p in ("mullion_ext_top", "mullion_ext_bottom", "transom_clearance", "glass_deduction_x",
                               "glass_deduction_y", "gasket_runs_per_field_edge", "connectors_per_transom",
                               "brackets_per_anchor", "max_bar_length") if p not in (rs.get("params") or {})]
        if missing:
            issues.append(Issue(code="RULE_PARAM_MISSING", severity="error",
                                message=f"Rule set '{rs.get('id')}' lacks params: {', '.join(missing)}",
                                ref="rule_set"))
    rs_id = (rs or {}).get("id") or rule_set_id or "UNKNOWN"
    rs_ver = str((rs or {}).get("version", "UNKNOWN"))
    approved = bool((rs or {}).get("approved", False))
    inputs_hash = _hash_inputs(elev, rs_id, cat_version)

    def result(cuts, glass, bom, totals, status) -> CalcResult:
        r = CalcResult(engine_version=ENGINE_VERSION, catalogue_version=cat_version, rule_set_id=rs_id,
                       rule_set_version=rs_ver, rule_set_approved=approved, inputs_hash=inputs_hash,
                       elevation=elev, profile_cuts=cuts, glass_items=glass, bom=bom, issues=issues,
                       validation_status=status,
                       validation=ValidationReport(passed=True, validator="pending"), totals=totals)
        r.validation = validate_calc(r)
        if not r.validation.passed:
            r.validation_status = "INVALID"
        return r

    if any(i.severity == "error" for i in issues):
        return result([], [], [], {}, "INVALID")

    P = rs["params"]
    RS = rs["id"]
    series = get_series(catalogue, elev.system_id)
    q = elev.quantity
    W, H = elev.width, elev.height
    m = list(elev.mullions)
    n_m = len(m)

    mull = get_profile(catalogue, effective_mullion_profile_id(elev, catalogue))
    mfw = float(mull["face_width"])

    # grouped cuts: key -> dict
    groups: "OrderedDict[Tuple, Dict[str, Any]]" = OrderedDict()

    def add_cut(role: str, prof: Dict[str, Any], length: float, n: int, position: str, formula: str,
                rule_ids: List[str], desc: str) -> None:
        length = round_to(length, 6)
        key = (role, prof["id"], length)
        g = groups.get(key)
        if g is None:
            groups[key] = dict(role=role, prof=prof, length=length, n=n, positions=[position], formula=formula,
                               rule_ids=rule_ids, desc=desc)
        else:
            g["n"] += n
            g["positions"].append(position)

    # --- mullions ---
    ml = H + P["mullion_ext_top"] + P["mullion_ext_bottom"]
    for i, x in enumerate(m):
        add_cut("mullion", mull, ml, 1, f"x={_fmt(x)}",
                f"H + mullion_ext_top + mullion_ext_bottom = {_fmt(H)} + {_fmt(P['mullion_ext_top'])} + "
                f"{_fmt(P['mullion_ext_bottom'])} = {_fmt(ml)}",
                [f"{RS}:mullion_ext_top", f"{RS}:mullion_ext_bottom"], f"Mullion {mull['code']}")

    # --- horizontals (sill / transoms / head) ---
    n_horizontal = 0
    h_runs: List[Tuple[Dict[str, Any], float, str]] = []  # (transom profile, axis run width, position)
    for b, bay in enumerate(elev.bays):
        tp = get_profile(catalogue, effective_transom_profile_id(elev, b, catalogue))
        aw = m[b + 1] - m[b]
        cl = P["transom_clearance"]
        tl = aw - mfw / 2 - mfw / 2 - 2 * cl
        formula = (f"bay axis width - mullion face/2 (left) - mullion face/2 (right) - 2 x transom_clearance = "
                   f"{_fmt(aw)} - {_fmt(mfw / 2)} - {_fmt(mfw / 2)} - 2 x {_fmt(cl)} = {_fmt(tl)}")
        rids = [f"{RS}:transom_clearance", f"profile:{mull['id']}:face_width"]
        levels = [(0.0, "sill")] + [(y, "transom") for y in bay.transoms] + [(H, "head")]
        for y, role in levels:
            add_cut(role, tp, tl, 1, f"bay {b + 1}, y={_fmt(y)}", formula, rids, f"{role.capitalize()} {tp['code']}")
            h_runs.append((tp, aw, f"bay {b + 1}, y={_fmt(y)}"))
            n_horizontal += 1

    # --- pressure plates / cover caps (DEMO rule: length == axis run, no joint deductions) ---
    for role, key in (("pressure_plate", "pressure_plate_profile_id"), ("cover_cap", "cover_cap_profile_id")):
        pid = (series or {}).get(key)
        prof = get_profile(catalogue, pid) if pid else None
        if prof is None:
            continue
        label = "Pressure plate" if role == "pressure_plate" else "Cover cap"
        for x in m:
            add_cut(role, prof, H, 1, f"vertical x={_fmt(x)}",
                    f"DEMO rule: vertical {role} length = mullion axis run H = {_fmt(H)}",
                    [f"demo:{role}_axis_run"], f"{label} (vertical) {prof['code']}")
        for _tp, aw, pos in h_runs:
            add_cut(role, prof, aw, 1, f"horizontal {pos}",
                    f"DEMO rule: horizontal {role} length = bay axis width = {_fmt(aw)}",
                    [f"demo:{role}_axis_run"], f"{label} (horizontal) {prof['code']}")

    prefix = {"mullion": "M", "transom": "T", "sill": "S", "head": "H", "pressure_plate": "PP", "cover_cap": "CC"}
    counters: Dict[str, int] = defaultdict(int)
    cuts: List[ProfileCut] = []
    for g in groups.values():
        counters[g["role"]] += 1
        pos = ", ".join(g["positions"][:12]) + (" ..." if len(g["positions"]) > 12 else "")
        cuts.append(ProfileCut(mark=f"{prefix[g['role']]}{counters[g['role']]}", role=g["role"],
                               profile_id=g["prof"]["id"], profile_code=g["prof"]["code"], description=g["desc"],
                               length=g["length"], quantity=g["n"] * q, position=pos, formula=g["formula"],
                               rule_ids=g["rule_ids"]))
        if g["length"] > P["max_bar_length"] + EPS:
            issues.append(Issue(code="SPLICE_REQUIRED", severity="warning",
                                message=f"{g['desc']} cut length {_fmt(g['length'])} mm exceeds max_bar_length "
                                        f"{_fmt(P['max_bar_length'])} mm: a splice is required (splice positions "
                                        f"are NOT computed - engineering input required)",
                                ref=f"cut:{cuts[-1].mark}"))

    # --- glass / fills ---
    gdx, gdy = P["glass_deduction_x"], P["glass_deduction_y"]
    glass: List[GlassItem] = []
    fill_perimeter_mm = 0.0
    pane_count = 0
    for r in field_rects(elev):
        f = resolve_fill(elev, r["key"])
        if f.type in ("none", "opening"):
            continue
        aw, ah = r["x1"] - r["x0"], r["y1"] - r["y0"]
        gw, gh = aw - gdx, ah - gdy
        ref = f"bay:{r['bay']}/field:{r['field']}"
        if gw <= EPS or gh <= EPS:
            issues.append(Issue(code="GLASS_SIZE_NONPOSITIVE", severity="error",
                                message=f"Computed fill size {gw}x{gh} is not positive", ref=ref))
            continue
        if f.type == "panel":
            pt = get_panel_type(catalogue, f.panel_type_id)
            desc, gid, pid, mk = f"Panel {pt['code']} - {pt['name']}", None, pt["id"], "P"
        else:
            gt = get_glass_type(catalogue, f.glass_type_id) if f.glass_type_id else None
            desc = f"{'Spandrel' if f.type == 'spandrel' else 'Glass'} " + (
                f"{gt['code']} - {gt['name']}" if gt else "(type not specified)")
            gid, pid, mk = f.glass_type_id, None, ("SP" if f.type == "spandrel" else "G")
        glass.append(GlassItem(
            mark=f"{mk}{r['bay'] + 1}.{r['field'] + 1}", field_key=r["key"], fill_type=f.type,
            glass_type_id=gid, panel_type_id=pid, description=desc, width=round_to(gw, 6), height=round_to(gh, 6),
            area_m2=round_to(gw, 6) * round_to(gh, 6) / 1e6, quantity=q,
            formula=(f"W = axis width - glass_deduction_x = {_fmt(aw)} - {_fmt(gdx)} = {_fmt(gw)}; "
                     f"H = axis height - glass_deduction_y = {_fmt(ah)} - {_fmt(gdy)} = {_fmt(gh)}"),
            rule_ids=[f"{RS}:glass_deduction_x", f"{RS}:glass_deduction_y"]))
        fill_perimeter_mm += 2 * (gw + gh)
        pane_count += 1

    if any(i.severity == "error" for i in issues):
        return result([], [], [], {}, "INVALID")

    # --- BOM ---
    bom: List[BomLine] = []
    prof_len: "OrderedDict[str, float]" = OrderedDict()
    prof_obj: Dict[str, Dict[str, Any]] = {}
    for c in cuts:
        prof_len[c.profile_id] = prof_len.get(c.profile_id, 0.0) + c.length * c.quantity
        prof_obj[c.profile_id] = get_profile(catalogue, c.profile_id)
    totals: Dict[str, float] = {}
    weight = 0.0
    for pid, total_mm in prof_len.items():
        p = prof_obj[pid]
        stock = max(p.get("stock_lengths") or [0]) or None
        est = ""
        if stock:
            fits = [c.length for c in cuts if c.profile_id == pid for _ in range(c.quantity) if c.length <= stock]
            bars_lb = math.ceil(sum(fits) / stock - 1e-9) if fits else 0
            totals[f"bars_lower_bound.{pid}"] = float(bars_lb)
            est = f" (bar lower-bound estimate: {bars_lb} x {_fmt(stock)} mm; run 1D optimisation for actual)"
        bom.append(BomLine(item_type="profile", item_id=pid, code=p["code"], description=p["name"] + est, unit="m",
                           quantity=total_mm / 1000, rule_ids=["sum(cut length x qty)"]))
        weight += total_mm / 1000 * float(p.get("weight_kg_m") or 0)

    g_area: "OrderedDict[str, float]" = OrderedDict()
    p_area: "OrderedDict[str, float]" = OrderedDict()
    for gi in glass:
        if gi.fill_type == "panel":
            p_area[gi.panel_type_id] = p_area.get(gi.panel_type_id, 0.0) + gi.area_m2 * gi.quantity
        else:
            k = gi.glass_type_id or "unspecified"
            g_area[k] = g_area.get(k, 0.0) + gi.area_m2 * gi.quantity
    glass_weight = 0.0
    for gid, a in g_area.items():
        gt = get_glass_type(catalogue, gid) if gid != "unspecified" else None
        bom.append(BomLine(item_type="glass", item_id=gid, code=gt["code"] if gt else "UNSPECIFIED",
                           description=gt["name"] if gt else "Glass type not specified", unit="m2", quantity=a,
                           rule_ids=["sum(glass area x qty)"]))
        if gt and gt.get("weight_kg_m2"):
            glass_weight += a * gt["weight_kg_m2"]
    for pid, a in p_area.items():
        pt = get_panel_type(catalogue, pid)
        bom.append(BomLine(item_type="panel", item_id=pid, code=pt["code"], description=pt["name"], unit="m2",
                           quantity=a, rule_ids=["sum(panel area x qty)"]))

    sid = (series or {}).get("id")

    def acc_line(kind: str, item_type: str, quantity: float, rule: str, fallback_unit: str) -> None:
        if quantity <= 0:
            return
        a = find_accessory(catalogue, kind, sid)
        if a is None:
            issues.append(Issue(code="ACCESSORY_NOT_IN_CATALOGUE", severity="warning",
                                message=f"No '{kind}' accessory for series {sid}; quantity {quantity:g} not costed",
                                ref=f"bom:{kind}"))
            return
        bom.append(BomLine(item_type=item_type, item_id=a["id"], code=a["code"], description=a["name"],
                           unit=a.get("unit", fallback_unit), quantity=quantity, rule_ids=[rule]))

    acc_line("gasket", "gasket", fill_perimeter_mm / 1000 * P["gasket_runs_per_field_edge"] * q,
             f"{RS}:gasket_runs_per_field_edge (x fill perimeter)", "m")
    acc_line("connector", "connector", P["connectors_per_transom"] * n_horizontal * q,
             f"{RS}:connectors_per_transom (x horizontal members incl. sill & head)", "pcs")
    acc_line("bracket", "bracket", P["brackets_per_anchor"] * len(elev.anchor_levels) * n_m * q,
             f"{RS}:brackets_per_anchor (x anchor levels x mullions)", "pcs")
    acc_line("end_cap", "accessory", P.get("end_caps_per_mullion", 0) * n_m * q, f"{RS}:end_caps_per_mullion", "pcs")
    acc_line("sealant", "sealant", 2 * (W + H) / 1000 * P.get("sealant_runs_per_perimeter", 0) * q,
             f"{RS}:sealant_runs_per_perimeter (x framework perimeter)", "m")
    splices = 0
    for c in cuts:
        if c.length > P["max_bar_length"] + EPS:
            splices += (math.ceil(c.length / P["max_bar_length"]) - 1) * c.quantity
    acc_line("splice", "accessory", splices * P.get("splice_sleeves_per_splice", 1),
             f"{RS}:max_bar_length / splice_sleeves_per_splice (count only, positions not computed)", "pcs")

    totals.update({
        "glass_area_m2": sum(g_area.values()),
        "panel_area_m2": sum(p_area.values()),
        "profile_length_m": sum(prof_len.values()) / 1000,
        "field_count": float(len(field_rects(elev))),
        "fill_count": float(pane_count),
        "mullion_count": float(n_m * q),
        "transom_count": float(sum(len(b.transoms) for b in elev.bays) * q),
        "horizontal_member_count": float(n_horizontal * q),
        "elevation_area_m2": W * H / 1e6 * q,
        "profile_weight_kg_demo": weight,
        "glass_weight_kg_demo": glass_weight,
        "quantity": float(q),
    })
    if approved and rs.get("golden_cases_passed") is True:
        status = "VALIDATED"
    else:
        status = "PROVISIONAL_DEMO_RULES"
        issues.append(Issue(code="PROVISIONAL_DEMO_RULES", severity="info",
                            message="Calculated with DEMO rule set (not approved). Not for production/fabrication.",
                            ref=f"rule_set:{RS}"))
    return result(cuts, glass, bom, totals, status)
