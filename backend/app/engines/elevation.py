"""Elevation (curtain-wall framework) geometry: validation, field geometry and pure editing helpers.

Coordinates: origin bottom-left of the framework, x right, y up, millimetres.
All editing helpers are pure: they return a NEW Elevation and never mutate the input.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .catalogue import (compatibility_rules, get_colour, get_glass_type, get_panel_type, get_profile,
                        get_rule_set, get_series)
from .models import Bay, Elevation, FieldFill, Issue
from .units import EPS

FILL_KEY_RE = re.compile(r"^b(\d+)-f(\d+)$")


def fill_key(bay: int, field: int) -> str:
    return f"b{bay}-f{field}"


def parse_fill_key(key: str) -> Optional[tuple]:
    m = FILL_KEY_RE.match(key)
    return (int(m.group(1)), int(m.group(2))) if m else None


def resolve_fill(elev: Elevation, key: str) -> FieldFill:
    """Fill for a field; missing key => glass with the elevation default glass type."""
    f = elev.fills.get(key)
    if f is None:
        return FieldFill(type="glass", glass_type_id=elev.default_glass_type_id)
    if f.type == "glass" and not f.glass_type_id:
        return f.model_copy(update={"glass_type_id": elev.default_glass_type_id})
    return f


def bay_levels(elev: Elevation, bay: int) -> List[float]:
    return [0.0] + list(elev.bays[bay].transoms) + [float(elev.height)]


def field_rects(elev: Elevation) -> List[Dict[str, Any]]:
    """Axis (centre-line) rectangles of every field: {key, bay, field, x0, x1, y0, y1}."""
    out: List[Dict[str, Any]] = []
    n = min(len(elev.bays), max(0, len(elev.mullions) - 1))
    for b in range(n):
        x0, x1 = float(elev.mullions[b]), float(elev.mullions[b + 1])
        ys = bay_levels(elev, b)
        for f in range(len(ys) - 1):
            out.append(dict(key=fill_key(b, f), bay=b, field=f, x0=x0, x1=x1, y0=ys[f], y1=ys[f + 1]))
    return out


def resolve_rule_set(elev: Elevation, catalogue: Dict[str, Any], rule_set_id: Optional[str] = None):
    if rule_set_id:
        return get_rule_set(catalogue, rule_set_id)
    series = get_series(catalogue, elev.system_id)
    if series:
        return get_rule_set(catalogue, series.get("default_rule_set_id"))
    return None


def effective_mullion_profile_id(elev: Elevation, catalogue: Optional[Dict[str, Any]]) -> Optional[str]:
    if elev.mullion_profile_id:
        return elev.mullion_profile_id
    if catalogue:
        s = get_series(catalogue, elev.system_id)
        if s:
            return s.get("default_mullion_profile_id") or (s.get("mullion_profile_ids") or [None])[0]
    return None


def effective_transom_profile_id(elev: Elevation, bay: int, catalogue: Optional[Dict[str, Any]]) -> Optional[str]:
    if 0 <= bay < len(elev.bays) and elev.bays[bay].transom_profile_id:
        return elev.bays[bay].transom_profile_id
    if elev.transom_profile_id:
        return elev.transom_profile_id
    if catalogue:
        s = get_series(catalogue, elev.system_id)
        if s:
            return s.get("default_transom_profile_id") or (s.get("transom_profile_ids") or [None])[0]
    return None


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
def validate_elevation(elev: Elevation, catalogue: Optional[Dict[str, Any]] = None,
                       rule_set_id: Optional[str] = None) -> List[Issue]:
    issues: List[Issue] = []

    def add(code: str, sev: str, msg: str, ref: Optional[str] = None) -> None:
        issues.append(Issue(code=code, severity=sev, message=msg, ref=ref))

    W, H = elev.width, elev.height
    if not (W and W > 0):
        add("INVALID_WIDTH", "error", f"Framework width must be > 0 (got {W})", "width")
    if not (H and H > 0):
        add("INVALID_HEIGHT", "error", f"Framework height must be > 0 (got {H})", "height")
    if elev.quantity is None or elev.quantity < 1:
        add("INVALID_QUANTITY", "error", "Quantity must be >= 1", "quantity")
    if issues:
        return issues

    m = list(elev.mullions)
    geom_ok = True
    if len(m) < 2:
        add("MULLIONS_TOO_FEW", "error", "At least two mullion lines (both edges) are required", "mullions")
        geom_ok = False
    else:
        if abs(m[0]) > EPS:
            add("MULLION_FIRST_NOT_ZERO", "error", f"First mullion must be at x=0 (got {m[0]})", "mullion:0")
            geom_ok = False
        if abs(m[-1] - W) > EPS:
            add("MULLION_LAST_NOT_WIDTH", "error", f"Last mullion must be at x=width={W} (got {m[-1]})",
                f"mullion:{len(m) - 1}")
            geom_ok = False
        for i in range(1, len(m)):
            if m[i] <= m[i - 1] + EPS:
                add("MULLIONS_NOT_INCREASING", "error",
                    f"Mullion positions must be strictly increasing (x[{i - 1}]={m[i - 1]}, x[{i}]={m[i]})",
                    f"mullion:{i}")
                geom_ok = False
        if len(elev.bays) != len(m) - 1:
            add("BAY_COUNT_MISMATCH", "error",
                f"Number of bays ({len(elev.bays)}) must equal mullion lines - 1 ({len(m) - 1})", "bays")
            geom_ok = False

    for b, bay in enumerate(elev.bays):
        prev = 0.0
        for j, y in enumerate(bay.transoms):
            if y <= EPS or y >= H - EPS:
                add("TRANSOM_OUTSIDE", "error", f"Transom y={y} must be strictly inside (0, {H})",
                    f"bay:{b}/transom:{j}")
                geom_ok = False
            elif y <= prev + EPS:
                add("TRANSOMS_NOT_INCREASING", "error", f"Transoms must be strictly increasing in bay {b}",
                    f"bay:{b}/transom:{j}")
                geom_ok = False
            prev = max(prev, y)

    # top shape
    ts = elev.top_shape
    if getattr(ts, "type", "flat") == "arch":
        if ts.rise > W / 2 + EPS:
            add("ARCH_RISE_INVALID", "error", f"Arch rise {ts.rise} exceeds half the width ({W / 2})", "top_shape")
        add("ARCH_CALC_UNSUPPORTED", "error",
            "Arched heads are geometry/display only in v1; member and glass calculation is not supported",
            "top_shape")

    for k, y in enumerate(elev.anchor_levels):
        if y < -EPS or y > H + EPS:
            add("ANCHOR_OUTSIDE", "error", f"Anchor level y={y} is outside the framework height (0..{H})",
                f"anchor:{k}")

    # fills
    n_fields = {b: len(bay.transoms) + 1 for b, bay in enumerate(elev.bays)}
    for key, fill in elev.fills.items():
        pk = parse_fill_key(key)
        if pk is None:
            add("FILL_KEY_INVALID", "error", f"Fill key '{key}' must match 'b{{bay}}-f{{field}}'", f"fill:{key}")
        elif pk[0] not in n_fields or pk[1] >= n_fields[pk[0]]:
            add("FILL_KEY_ORPHAN", "warning", f"Fill key '{key}' does not refer to an existing field (ignored)",
                f"fill:{key}")

    if not geom_ok:
        return issues

    rects = field_rects(elev)
    for r in rects:
        f = resolve_fill(elev, r["key"])
        if f.type == "opening":
            add("VENT_NOT_SUPPORTED_IN_V1", "warning",
                "Opening/vent fields are not calculated in v1 (no glass or vent hardware produced)",
                f"bay:{r['bay']}/field:{r['field']}")

    if catalogue is None:
        return issues

    # ---- catalogue-dependent checks ----
    series = get_series(catalogue, elev.system_id)
    if not elev.system_id:
        add("SYSTEM_NOT_SET", "error", "No system (series) selected", "system_id")
    elif series is None:
        add("SYSTEM_NOT_FOUND", "error", f"Series '{elev.system_id}' not found in catalogue", "system_id")

    rs = resolve_rule_set(elev, catalogue, rule_set_id)
    if rule_set_id and rs is None:
        add("RULE_SET_NOT_FOUND", "error", f"Rule set '{rule_set_id}' not found", "rule_set")
    elif rs is not None and series is not None and rs.get("series_id") != series.get("id"):
        add("RULE_SET_SERIES_MISMATCH", "error", f"Rule set '{rs.get('id')}' belongs to another series",
            "rule_set")

    def check_profile(pid: Optional[str], role: str, ref: str) -> None:
        if not pid:
            add("PROFILE_NOT_SET", "error", f"No {role} profile selected", ref)
            return
        p = get_profile(catalogue, pid)
        if p is None:
            add("PROFILE_NOT_FOUND", "error", f"Profile '{pid}' not found", ref)
            return
        if p.get("role") != role:
            add("PROFILE_WRONG_ROLE", "error", f"Profile '{pid}' is a {p.get('role')}, not a {role}", ref)
        if series is not None:
            allowed = series.get(f"{role}_profile_ids") or []
            if p.get("series_id") != series.get("id") or (allowed and pid not in allowed):
                add("PROFILE_NOT_IN_SERIES", "error", f"Profile '{pid}' does not belong to series '{series['id']}'",
                    ref)

    if series is not None:
        check_profile(effective_mullion_profile_id(elev, catalogue), "mullion", "mullion_profile_id")
        seen = set()
        for b in range(len(elev.bays)):
            tid = effective_transom_profile_id(elev, b, catalogue)
            if tid in seen:
                continue
            seen.add(tid)
            check_profile(tid, "transom", f"bay:{b}/transom_profile_id")
        if elev.colour_id and get_colour(catalogue, elev.colour_id) is None:
            add("COLOUR_NOT_FOUND", "error", f"Colour '{elev.colour_id}' not found", "colour_id")

    # glass thickness range (series fields + compatibility rules)
    t_ranges = []
    if series is not None:
        if series.get("glass_thickness_min") is not None and series.get("glass_thickness_max") is not None:
            t_ranges.append((series["glass_thickness_min"], series["glass_thickness_max"], f"series:{series['id']}"))
        for c in compatibility_rules(catalogue, series["id"], "glass_thickness_range"):
            t_ranges.append((c["params"].get("min", 0), c["params"].get("max", 1e9), c.get("id")))
    size_rules = compatibility_rules(catalogue, series["id"], "max_field_size") if series else []

    p = (rs or {}).get("params", {})
    for r in rects:
        ref = f"bay:{r['bay']}/field:{r['field']}"
        w, h = r["x1"] - r["x0"], r["y1"] - r["y0"]
        if rs is not None:
            if "min_field_width" in p and w < p["min_field_width"] - EPS:
                add("FIELD_TOO_NARROW", "error", f"Field width {w:.1f} < min {p['min_field_width']}", ref)
            if "max_field_width" in p and w > p["max_field_width"] + EPS:
                add("FIELD_TOO_WIDE", "error", f"Field width {w:.1f} > max {p['max_field_width']}", ref)
            if "min_field_height" in p and h < p["min_field_height"] - EPS:
                add("FIELD_TOO_SHORT", "error", f"Field height {h:.1f} < min {p['min_field_height']}", ref)
            if "max_field_height" in p and h > p["max_field_height"] + EPS:
                add("FIELD_TOO_TALL", "error", f"Field height {h:.1f} > max {p['max_field_height']}", ref)
        for c in size_rules:
            ma = c["params"].get("max_area_m2")
            if ma is not None and w * h / 1e6 > ma + EPS:
                add("FIELD_AREA_EXCEEDS_LIMIT", "warning",
                    f"Field axis area {w * h / 1e6:.2f} m2 > {ma} m2 ({c.get('message', '')})", ref)
        f = resolve_fill(elev, r["key"])
        if f.type in ("glass", "spandrel"):
            if not f.glass_type_id:
                add("GLASS_TYPE_UNSPECIFIED", "warning", "No glass type selected for this field", ref)
                continue
            g = get_glass_type(catalogue, f.glass_type_id)
            if g is None:
                add("GLASS_TYPE_NOT_FOUND", "error", f"Glass type '{f.glass_type_id}' not found", ref)
                continue
            if f.type == "spandrel" and g.get("category") not in ("spandrel",):
                add("SPANDREL_GLASS_CATEGORY", "warning",
                    f"Spandrel field uses glass category '{g.get('category')}'", ref)
            if g.get("category") == "fire":
                add("FIRE_RATING_NOT_CERTIFIED", "warning",
                    "Fire glass selected: no certified fire rating in catalogue; must be supplied", ref)
            _check_thickness(g.get("thickness"), t_ranges, ref, add, f.glass_type_id)
        elif f.type == "panel":
            if not f.panel_type_id:
                add("PANEL_TYPE_MISSING", "error", "Panel field without panel_type_id", ref)
                continue
            pt = get_panel_type(catalogue, f.panel_type_id)
            if pt is None:
                add("PANEL_TYPE_NOT_FOUND", "error", f"Panel type '{f.panel_type_id}' not found", ref)
                continue
            _check_thickness(pt.get("thickness"), t_ranges, ref, add, f.panel_type_id,
                             code="PANEL_THICKNESS_OUTSIDE_GLAZING_RANGE", severity="warning")
    return issues


def _check_thickness(t, ranges, ref, add, item_id, code: str = "GLASS_THICKNESS_INCOMPATIBLE",
                     severity: str = "error") -> None:
    if t is None:
        add("FILL_THICKNESS_UNKNOWN", "warning",
            f"Fill '{item_id}' has no thickness; compatibility cannot be checked", ref)
        return
    for lo, hi, src in ranges:
        if t < lo - EPS or t > hi + EPS:
            add(code, severity,
                f"Fill '{item_id}' thickness {t} mm outside {lo}-{hi} mm ({src})"
                + ("" if severity == "error" else "; packers/adaptor needed - requires engineering approval"), ref)
            return


# ---------------------------------------------------------------------------
# Construction & pure editing helpers
# ---------------------------------------------------------------------------
def make_grid(width: float, height: float, n_bays: int, n_rows: int, **kwargs: Any) -> Elevation:
    """Equal-spacing grid: n_bays bays, n_rows fields per bay. Extra kwargs go to Elevation."""
    if n_bays < 1 or n_rows < 1:
        raise ValueError("n_bays and n_rows must be >= 1")
    mullions = [width * i / n_bays for i in range(n_bays + 1)]
    mullions[0], mullions[-1] = 0.0, float(width)
    transoms = [height * j / n_rows for j in range(1, n_rows)]
    bays = [Bay(transoms=list(transoms)) for _ in range(n_bays)]
    return Elevation(width=width, height=height, mullions=mullions, bays=bays, **kwargs)


def _copy(elev: Elevation) -> Elevation:
    return elev.model_copy(deep=True)


def _remap_fills(fills: Dict[str, FieldFill], fn) -> Dict[str, FieldFill]:
    """fn(bay, field) -> list of (bay, field) targets (empty list drops)."""
    out: Dict[str, FieldFill] = {}
    for k, v in fills.items():
        pk = parse_fill_key(k)
        if pk is None:
            continue
        for nb, nf in fn(*pk):
            out[fill_key(nb, nf)] = v.model_copy(deep=True)
    return out


def add_mullion(elev: Elevation, x: float) -> Elevation:
    """Insert a mullion at x, splitting the bay containing it. Both halves inherit the bay's transoms
    and fills."""
    if not (EPS < x < elev.width - EPS):
        raise ValueError("mullion must be strictly inside the framework width")
    if any(abs(x - mx) <= EPS for mx in elev.mullions):
        raise ValueError("a mullion already exists at this position")
    e = _copy(elev)
    b = max(i for i, mx in enumerate(e.mullions[:-1]) if mx < x)
    e.mullions.insert(b + 1, float(x))
    e.bays.insert(b + 1, e.bays[b].model_copy(deep=True))
    e.fills = _remap_fills(e.fills, lambda bb, ff: [(bb, ff)] if bb < b else
                           ([(bb, ff), (bb + 1, ff)] if bb == b else [(bb + 1, ff)]))
    return e


def remove_mullion(elev: Elevation, index: int) -> Elevation:
    """Remove an internal mullion line (1..n-2), merging the two adjacent bays. The merged bay keeps
    the LEFT bay's transoms and fills."""
    if not (1 <= index <= len(elev.mullions) - 2):
        raise ValueError("only internal mullions can be removed")
    e = _copy(elev)
    del e.mullions[index]
    del e.bays[index]
    e.fills = _remap_fills(e.fills, lambda bb, ff: [(bb, ff)] if bb < index else
                           ([] if bb == index else [(bb - 1, ff)]))
    return e


def move_mullion(elev: Elevation, index: int, x: float) -> Elevation:
    if not (1 <= index <= len(elev.mullions) - 2):
        raise ValueError("only internal mullions can be moved")
    if not (elev.mullions[index - 1] + EPS < x < elev.mullions[index + 1] - EPS):
        raise ValueError("mullion must stay between its neighbours")
    e = _copy(elev)
    e.mullions[index] = float(x)
    return e


def add_transom(elev: Elevation, bay: int, y: float) -> Elevation:
    """Insert a transom at height y in a bay; both resulting fields inherit the split field's fill."""
    if not (0 <= bay < len(elev.bays)):
        raise ValueError("bay index out of range")
    if not (EPS < y < elev.height - EPS):
        raise ValueError("transom must be strictly inside the framework height")
    tr = elev.bays[bay].transoms
    if any(abs(y - t) <= EPS for t in tr):
        raise ValueError("a transom already exists at this height")
    e = _copy(elev)
    j = sum(1 for t in tr if t < y)  # field index being split
    e.bays[bay].transoms = sorted(list(tr) + [float(y)])
    e.fills = _remap_fills(e.fills, lambda bb, ff: [(bb, ff)] if bb != bay or ff < j else
                           ([(bb, ff), (bb, ff + 1)] if ff == j else [(bb, ff + 1)]))
    return e


def add_transom_all_bays(elev: Elevation, y: float) -> Elevation:
    e = elev
    for b in range(len(elev.bays)):
        if not any(abs(y - t) <= EPS for t in e.bays[b].transoms):
            e = add_transom(e, b, y)
    return e


def remove_transom(elev: Elevation, bay: int, index: int) -> Elevation:
    """Remove transom `index` of a bay; the merged field keeps the LOWER field's fill."""
    if not (0 <= bay < len(elev.bays)) or not (0 <= index < len(elev.bays[bay].transoms)):
        raise ValueError("transom index out of range")
    e = _copy(elev)
    del e.bays[bay].transoms[index]
    upper = index + 1
    e.fills = _remap_fills(e.fills, lambda bb, ff: [(bb, ff)] if bb != bay or ff < upper else
                           ([] if ff == upper else [(bb, ff - 1)]))
    return e


def move_transom(elev: Elevation, bay: int, index: int, y: float) -> Elevation:
    tr = elev.bays[bay].transoms
    if not (0 <= index < len(tr)):
        raise ValueError("transom index out of range")
    lo = tr[index - 1] if index > 0 else 0.0
    hi = tr[index + 1] if index + 1 < len(tr) else elev.height
    if not (lo + EPS < y < hi - EPS):
        raise ValueError("transom must stay between its neighbours")
    e = _copy(elev)
    e.bays[bay].transoms[index] = float(y)
    return e


def set_fill(elev: Elevation, bay: int, field: int, fill: FieldFill) -> Elevation:
    if not (0 <= bay < len(elev.bays)) or not (0 <= field <= len(elev.bays[bay].transoms)):
        raise ValueError("field out of range")
    e = _copy(elev)
    e.fills[fill_key(bay, field)] = fill.model_copy(deep=True)
    return e


def resize(elev: Elevation, width: Optional[float] = None, height: Optional[float] = None) -> Elevation:
    """Scale mullion/transom/anchor positions proportionally to a new overall size."""
    e = _copy(elev)
    if width is not None:
        if width <= 0:
            raise ValueError("width must be > 0")
        sx = width / elev.width
        e.mullions = [mx * sx for mx in elev.mullions]
        e.mullions[-1] = float(width)
        e.width = float(width)
    if height is not None:
        if height <= 0:
            raise ValueError("height must be > 0")
        sy = height / elev.height
        for bay in e.bays:
            bay.transoms = [t * sy for t in bay.transoms]
        e.anchor_levels = [a * sy for a in e.anchor_levels]
        e.height = float(height)
    return e
