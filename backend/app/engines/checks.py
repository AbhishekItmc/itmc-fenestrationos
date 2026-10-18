"""Design checks (ARCHITECTURE §8.3) — DEMO plausibility warnings, NOT structural verification.

`run_design_checks(elev, catalogue, rule_set_id=None) -> list[Issue]` returns warnings only. Every threshold is
a rule-set param (DEMO, `approved: false`, documented in `param_docs`). Every message ends with
"(demo threshold — requires engineering approval)". When the elevation geometry itself is invalid the checks are
skipped (the elevation validator already reports errors); missing threshold params are reported once as an
info issue instead of being silently ignored.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .catalogue import get_glass_type
from .elevation import field_rects, resolve_fill, resolve_rule_set
from .models import Elevation, Issue
from .units import EPS

SUFFIX = " (demo threshold — requires engineering approval)"
CHECK_PARAMS = ("max_glass_weight_kg", "max_field_area_m2", "max_field_aspect_ratio",
                "max_unsupported_mullion_span", "min_anchor_levels")


def _g(v: float) -> str:
    return f"{v:,.1f}".rstrip("0").rstrip(".") if abs(v - round(v)) > 1e-9 else f"{v:,.0f}"


def _geometry_ok(elev: Elevation) -> bool:
    m = list(elev.mullions)
    if len(m) < 2 or len(elev.bays) != len(m) - 1:
        return False
    if abs(m[0]) > EPS or abs(m[-1] - elev.width) > EPS or any(b - a <= EPS for a, b in zip(m, m[1:])):
        return False
    for bay in elev.bays:
        ys = [0.0] + list(bay.transoms) + [float(elev.height)]
        if any(b - a <= EPS for a, b in zip(ys, ys[1:])):
            return False
    return True


def mullion_spans(elev: Elevation) -> List[float]:
    """Unsupported vertical spans: between consecutive anchor levels, plus the cantilevers from the framework
    bottom (y=0) to the first anchor and from the last anchor to the head (y=H). No anchors -> [H]."""
    H = float(elev.height)
    levels = sorted({min(max(float(a), 0.0), H) for a in elev.anchor_levels})
    if not levels:
        return [H]
    pts = [0.0] + levels + [H]
    return [b - a for a, b in zip(pts, pts[1:]) if b - a > EPS]


def run_design_checks(elev: Elevation, catalogue: Dict[str, Any], rule_set_id: Optional[str] = None) -> List[Issue]:
    issues: List[Issue] = []
    if not _geometry_ok(elev):
        return issues

    def warn(code: str, msg: str, ref: Optional[str]) -> None:
        issues.append(Issue(code=code, severity="warning", message=msg + SUFFIX, ref=ref))

    if not elev.colour_id:
        warn("NO_COLOUR_SELECTED", "No colour/finish selected for the elevation; colour surcharge and finish "
                                   "are not costed", "elevation:colour_id")

    rs = resolve_rule_set(elev, catalogue or {}, rule_set_id) if catalogue else None
    P = (rs or {}).get("params") or {}
    missing = [p for p in CHECK_PARAMS if P.get(p) is None]
    if rs is not None and missing:
        issues.append(Issue(code="DESIGN_CHECK_PARAM_MISSING", severity="info",
                            message=f"Rule set '{rs.get('id')}' lacks design-check params: {', '.join(missing)}; "
                                    f"those checks were not run", ref=f"rule_set:{rs.get('id')}"))
    if rs is None:
        return issues

    gdx = float(P.get("glass_deduction_x") or 0.0)
    gdy = float(P.get("glass_deduction_y") or 0.0)
    max_w = P.get("max_glass_weight_kg")
    max_a = P.get("max_field_area_m2")
    max_r = P.get("max_field_aspect_ratio")
    for r in field_rects(elev):
        ref = f"bay:{r['bay']}/field:{r['field']}"
        aw, ah = r["x1"] - r["x0"], r["y1"] - r["y0"]
        label = f"Field b{r['bay'] + 1}.f{r['field'] + 1} ({_g(aw)} x {_g(ah)} mm axis)"
        area = aw * ah / 1e6
        if max_a is not None and area > float(max_a) + 1e-9:
            warn("FIELD_AREA_HIGH", f"{label}: area {area:.2f} m² exceeds max_field_area_m2 {float(max_a):g} m²", ref)
        ratio = max(aw, ah) / min(aw, ah)
        if max_r is not None and ratio > float(max_r) + 1e-9:
            warn("FIELD_ASPECT_HIGH", f"{label}: aspect ratio {ratio:.2f} exceeds max_field_aspect_ratio "
                                      f"{float(max_r):g}", ref)
        f = resolve_fill(elev, r["key"])
        if max_w is not None and f.type in ("glass", "spandrel") and f.glass_type_id:
            gt = get_glass_type(catalogue, f.glass_type_id)
            kg_m2 = (gt or {}).get("weight_kg_m2")
            if kg_m2:
                gw, gh = max(aw - gdx, 0.0), max(ah - gdy, 0.0)
                kg = gw * gh / 1e6 * float(kg_m2)
                if kg > float(max_w) + 1e-9:
                    warn("GLASS_WEIGHT_HIGH", f"{label}: pane {gt['code']} {_g(gw)} x {_g(gh)} mm weighs about "
                                              f"{kg:.0f} kg (demo {float(kg_m2):g} kg/m²), exceeds "
                                              f"max_glass_weight_kg {float(max_w):g} kg", ref)

    min_anchors = P.get("min_anchor_levels")
    n_anchor = len({float(a) for a in elev.anchor_levels})
    if min_anchors is not None and n_anchor < int(min_anchors):
        warn("ANCHORS_MISSING", f"{n_anchor} anchor level(s) defined, min_anchor_levels is {int(min_anchors)}; "
                                f"bracket quantities and mullion spans are unreliable", "elevation:anchor_levels")
    max_span = P.get("max_unsupported_mullion_span")
    if max_span is not None:
        spans = mullion_spans(elev)
        worst = max(spans)
        if worst > float(max_span) + EPS:
            warn("MULLION_SPAN_HIGH", f"Largest unsupported mullion span {_g(worst)} mm (between anchor levels / "
                                      f"framework ends) exceeds max_unsupported_mullion_span {_g(float(max_span))} mm",
                 "elevation:anchor_levels")
    return issues
