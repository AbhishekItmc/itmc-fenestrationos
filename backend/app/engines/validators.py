"""INDEPENDENT feasibility validators.

This module deliberately does NOT import any optimiser / calc internals. It re-derives every
quantity from the request (and, for calc, from the echoed elevation) and compares against what the
engine reported. Any discrepancy is an error -> the caller must mark the result INVALID.

Semantics checked are those of ARCHITECTURE.md sections 3 (1D) and 4 (2D).
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

from .models import (CalcResult, Cutting1DRequest, Cutting1DResult, Issue, Nesting2DRequest,
                     Nesting2DResult, ValidationReport)

VALIDATOR_1D = "validate_1d/1.0"
VALIDATOR_2D = "validate_2d/1.0"
VALIDATOR_CALC = "validate_calc/1.0"
EPS = 1e-6           # geometric tolerance (mm) - kept local on purpose (independence)
SUM_TOL = 0.01       # mm tolerance for recomputed summary lengths
AREA_TOL_M2 = 1e-6   # m2 tolerance for recomputed areas


class _Collector:
    def __init__(self) -> None:
        self.errors: List[Issue] = []
        self.checked = 0

    def err(self, code: str, msg: str, ref: Optional[str] = None) -> None:
        if len(self.errors) < 500:
            self.errors.append(Issue(code=code, severity="error", message=msg, ref=ref))

    def report(self, name: str) -> ValidationReport:
        return ValidationReport(passed=not self.errors, validator=name, errors=self.errors,
                                checked_items=self.checked)


def _close(a: Optional[float], b: Optional[float], tol: float) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= tol


# ---------------------------------------------------------------------------
# 1D
# ---------------------------------------------------------------------------
def validate_1d(req: Cutting1DRequest, result: Cutting1DResult) -> ValidationReport:
    c = _Collector()
    kerf, ts, te = req.kerf, req.trim_start, req.trim_end

    demand: Dict[str, int] = defaultdict(int)
    plen: Dict[str, float] = {}
    pang: Dict[str, Tuple[float, float]] = {}
    for p in req.pieces:
        if p.id in plen and abs(plen[p.id] - p.length) > EPS:
            c.err("REQUEST_DUPLICATE_PIECE_ID", f"piece id '{p.id}' used with different lengths", f"piece:{p.id}")
        plen[p.id] = p.length
        pang[p.id] = (p.angle_start, p.angle_end)
        demand[p.id] += p.quantity
    stocks = {s.id: s for s in req.stocks}

    placed: Dict[str, int] = defaultdict(int)
    stock_used: Dict[str, int] = defaultdict(int)
    tot_stock = tot_piece = tot_kerf = tot_trim = tot_reuse = tot_waste = 0.0
    tot_cost = 0.0
    any_cost = False
    bars = 0

    for pat in result.patterns:
        ref = f"pattern:{pat.pattern_id}"
        c.checked += 1
        st = stocks.get(pat.stock_id)
        if st is None:
            c.err("UNKNOWN_STOCK", f"stock '{pat.stock_id}' not in request", ref)
            continue
        if abs(pat.stock_length - st.length) > EPS:
            c.err("STOCK_LENGTH_MISMATCH", f"pattern stock_length {pat.stock_length} != stock {st.length}", ref)
        if pat.is_offcut_stock != st.is_offcut:
            c.err("OFFCUT_FLAG_MISMATCH", "is_offcut_stock does not match stock", ref)
        if pat.count < 1:
            c.err("BAD_PATTERN_COUNT", "pattern count must be >= 1", ref)
            continue
        if not pat.cuts:
            c.err("EMPTY_PATTERN", "pattern has no cuts", ref)
            continue
        L = st.length
        expected_offset = ts
        prev_end = None
        sum_p = 0.0
        for i, cut in enumerate(pat.cuts):
            cref = f"{ref}/cut:{i}"
            if cut.piece_id not in plen:
                c.err("UNKNOWN_PIECE", f"piece '{cut.piece_id}' not in request", cref)
                continue
            if abs(cut.length - plen[cut.piece_id]) > EPS:
                c.err("CUT_LENGTH_MISMATCH", f"cut length {cut.length} != piece length {plen[cut.piece_id]}", cref)
            if (abs(cut.angle_start - pang[cut.piece_id][0]) > EPS
                    or abs(cut.angle_end - pang[cut.piece_id][1]) > EPS):
                c.err("CUT_ANGLE_MISMATCH", "cut angles differ from piece angles", cref)
            if i == 0:
                if abs(cut.offset - ts) > EPS:
                    c.err("FIRST_OFFSET_NOT_TRIM", f"first offset {cut.offset} != trim_start {ts}", cref)
            elif cut.offset < expected_offset - EPS:
                c.err("CUT_OVERLAP", f"offset {cut.offset} < previous end + kerf ({expected_offset})", cref)
            expected_offset = cut.offset + cut.length + kerf
            prev_end = cut.offset + cut.length
            sum_p += cut.length
            placed[cut.piece_id] += pat.count
        if prev_end is None:
            continue
        used = prev_end + kerf
        if used + te > L + EPS:
            c.err("BAR_OVERFLOW", f"last cut end + kerf + trim_end = {used + te} > stock length {L}", ref)
        # used = end of last cut + its kerf (== trim_start + sum(p) + n*kerf for tightly packed cuts)
        if abs(pat.used_length - used) > SUM_TOL:
            c.err("USED_LENGTH_MISMATCH", f"used_length {pat.used_length} != recomputed {used}", ref)
        remainder = L - used - te
        if abs(pat.remainder - remainder) > SUM_TOL:
            c.err("REMAINDER_MISMATCH", f"remainder {pat.remainder} != recomputed {remainder}", ref)
        reusable = remainder + EPS >= req.min_reusable_offcut
        if pat.offcut_reusable != reusable:
            c.err("OFFCUT_FLAG_WRONG", f"offcut_reusable should be {reusable}", ref)
        waste = 0.0 if reusable else max(remainder, 0.0)
        if abs(pat.waste - waste) > SUM_TOL:
            c.err("WASTE_MISMATCH", f"waste {pat.waste} != recomputed {waste}", ref)
        k = pat.count
        bars += k
        stock_used[st.id] += k
        tot_stock += k * L
        tot_piece += k * sum_p
        tot_kerf += k * (used - ts - sum_p)
        tot_trim += k * (ts + te)
        tot_reuse += k * (remainder if reusable else 0.0)
        tot_waste += k * waste
        if st.cost_per_bar is not None:
            any_cost = True
            tot_cost += k * st.cost_per_bar

    for sid, n in stock_used.items():
        q = stocks[sid].quantity
        if q is not None and n > q:
            c.err("STOCK_QTY_EXCEEDED", f"stock '{sid}' used {n} times, only {q} available", f"stock:{sid}")

    unplaced: Dict[str, int] = defaultdict(int)
    for u in result.unplaced:
        if u.id not in plen:
            c.err("UNKNOWN_UNPLACED", f"unplaced piece '{u.id}' not in request", f"piece:{u.id}")
        unplaced[u.id] += u.quantity
    for pid, q in demand.items():
        c.checked += 1
        if placed[pid] + unplaced[pid] != q:
            c.err("QUANTITY_MISMATCH",
                  f"piece '{pid}': demanded {q}, placed {placed[pid]}, unplaced {unplaced[pid]}", f"piece:{pid}")
    for pid in placed:
        if pid not in demand:
            c.err("UNKNOWN_PIECE", f"placed piece '{pid}' not demanded", f"piece:{pid}")

    s = result.summary
    checks = [("bars_used", s.bars_used, bars, 0), ("total_stock_length", s.total_stock_length, tot_stock, SUM_TOL),
              ("total_piece_length", s.total_piece_length, tot_piece, SUM_TOL),
              ("total_kerf_loss", s.total_kerf_loss, tot_kerf, SUM_TOL),
              ("total_trim_loss", s.total_trim_loss, tot_trim, SUM_TOL),
              ("reusable_offcut_length", s.reusable_offcut_length, tot_reuse, SUM_TOL),
              ("waste_length", s.waste_length, tot_waste, SUM_TOL)]
    for name, got, exp, tol in checks:
        if abs(got - exp) > tol:
            c.err("SUMMARY_MISMATCH", f"summary.{name} = {got}, recomputed {exp}", "summary")
    util = tot_piece / tot_stock if tot_stock > 0 else 0.0
    if abs(s.utilization - util) > 1e-6:
        c.err("SUMMARY_MISMATCH", f"summary.utilization = {s.utilization}, recomputed {util}", "summary")
    exp_cost = tot_cost if any_cost else None
    if not _close(s.total_cost, exp_cost, SUM_TOL):
        c.err("SUMMARY_MISMATCH", f"summary.total_cost = {s.total_cost}, recomputed {exp_cost}", "summary")

    # status consistency + independent lower bound
    n_unplaced = sum(unplaced.values())
    if n_unplaced and result.status in ("OPTIMAL", "FEASIBLE"):
        c.err("STATUS_INCONSISTENT", f"status {result.status} but {n_unplaced} pieces unplaced", "status")
    if not n_unplaced and result.status in ("PARTIAL", "INFEASIBLE") and demand:
        c.err("STATUS_INCONSISTENT", f"status {result.status} but every piece placed", "status")
    caps = [st.length - ts - te for st in req.stocks if (st.quantity is None or st.quantity > 0)]
    if not n_unplaced and caps and max(caps) > 0:
        need = sum((plen[pid] + kerf) * q for pid, q in demand.items())
        lb = math.ceil(need / max(caps) - 1e-9)
        if bars < lb:
            c.err("BELOW_LOWER_BOUND", f"bars used {bars} < independent lower bound {lb}", "proof")
        if result.proof is not None and result.proof.lower_bound_bars > bars:
            c.err("PROOF_INCONSISTENT", "reported lower bound exceeds bars used", "proof")
    return c.report(VALIDATOR_1D)


# ---------------------------------------------------------------------------
# 2D
# ---------------------------------------------------------------------------
def _norm(s: Optional[str]) -> Optional[str]:
    return s.strip().lower() if isinstance(s, str) and s.strip() else None


def _guillotine_ok(rects: List[Tuple[float, float, float, float]], kerf: float) -> bool:
    """Iterative recursive check: a set of rectangles (x, y, w, h) is guillotine-separable if it is a
    single piece or a full straight cut strip of width `kerf` exists that touches no piece and splits
    it into two non-empty guillotine-separable subsets."""
    stack = [rects]
    while stack:
        rs = stack.pop()
        if len(rs) <= 1:
            continue
        split = None
        for axis in (0, 1):
            srt = sorted(rs, key=lambda r: r[axis])
            max_end = -math.inf
            for i in range(len(srt) - 1):
                max_end = max(max_end, srt[i][axis] + srt[i][axis + 2])
                if max_end + kerf <= srt[i + 1][axis] + EPS:
                    split = (srt[: i + 1], srt[i + 1:])
                    break
            if split:
                break
        if not split:
            return False
        stack.extend(split)
    return True


def validate_2d(req: Nesting2DRequest, result: Nesting2DResult) -> ValidationReport:
    c = _Collector()
    k = req.kerf
    tr = req.edge_trim
    pieces = {}
    demand: Dict[str, int] = defaultdict(int)
    for p in req.pieces:
        pieces[p.id] = p
        demand[p.id] += p.quantity
    sheets = {s.id: s for s in req.sheets}
    placed: Dict[str, int] = defaultdict(int)
    sheet_used: Dict[str, int] = defaultdict(int)
    tot_sheet = tot_piece = tot_reuse = 0.0
    tot_cost = 0.0
    any_cost = False
    n_sheets = 0

    for lay in result.layouts:
        ref = f"layout:{lay.layout_id}"
        c.checked += 1
        sh = sheets.get(lay.sheet_id)
        if sh is None:
            c.err("UNKNOWN_SHEET", f"sheet '{lay.sheet_id}' not in request", ref)
            continue
        if abs(lay.width - sh.width) > EPS or abs(lay.height - sh.height) > EPS:
            c.err("SHEET_SIZE_MISMATCH", "layout size differs from sheet", ref)
        if lay.is_residual_sheet != sh.is_residual:
            c.err("RESIDUAL_FLAG_MISMATCH", "is_residual_sheet does not match sheet", ref)
        if lay.count < 1:
            c.err("BAD_LAYOUT_COUNT", "layout count must be >= 1", ref)
            continue
        if not lay.placements:
            c.err("EMPTY_LAYOUT", "layout has no placements", ref)
        x0, x1 = tr.left, sh.width - tr.right
        y0, y1 = tr.bottom, sh.height - tr.top
        rects = []
        area = 0.0
        for i, pl in enumerate(lay.placements):
            pref = f"{ref}/placement:{i}"
            c.checked += 1
            p = pieces.get(pl.piece_id)
            if p is None:
                c.err("UNKNOWN_PIECE", f"piece '{pl.piece_id}' not in request", pref)
                continue
            if pl.rotated:
                if not p.can_rotate:
                    c.err("ROTATION_NOT_ALLOWED", f"piece '{p.id}' rotated but can_rotate is false", pref)
                ok = abs(pl.width - p.height) <= EPS and abs(pl.height - p.width) <= EPS
            else:
                ok = abs(pl.width - p.width) <= EPS and abs(pl.height - p.height) <= EPS
            if not ok:
                c.err("PLACEMENT_SIZE_MISMATCH", f"placed {pl.width}x{pl.height} does not match piece "
                      f"{p.width}x{p.height} (rotated={pl.rotated})", pref)
            if (pl.x < x0 - EPS or pl.y < y0 - EPS or pl.x + pl.width > x1 + EPS
                    or pl.y + pl.height > y1 + EPS):
                c.err("OUTSIDE_USABLE_AREA", f"placement ({pl.x},{pl.y},{pl.width},{pl.height}) outside usable "
                      f"area [{x0},{x1}]x[{y0},{y1}]", pref)
            pm, sm = _norm(p.material), _norm(sh.material)
            if pm and sm and pm != sm:
                c.err("MATERIAL_MISMATCH", f"piece material '{p.material}' on sheet '{sh.material}'", pref)
            if p.thickness is not None and sh.thickness is not None and abs(p.thickness - sh.thickness) > EPS:
                c.err("THICKNESS_MISMATCH", f"piece thickness {p.thickness} on sheet {sh.thickness}", pref)
            rects.append((pl.x, pl.y, pl.width, pl.height))
            area += p.width * p.height
            placed[p.id] += lay.count
        # pairwise kerf separation (sweep on x)
        order = sorted(range(len(rects)), key=lambda j: rects[j][0])
        for a_i in range(len(order)):
            a = rects[order[a_i]]
            for b_i in range(a_i + 1, len(order)):
                b = rects[order[b_i]]
                if b[0] >= a[0] + a[2] + k - EPS:
                    break
                gx = max(b[0] - (a[0] + a[2]), a[0] - (b[0] + b[2]))
                gy = max(b[1] - (a[1] + a[3]), a[1] - (b[1] + b[3]))
                if gx < k - EPS and gy < k - EPS:
                    c.err("OVERLAP_OR_KERF", f"placements {order[a_i]} and {order[b_i]} closer than kerf {k} "
                          f"(gap x={gx:.3f}, y={gy:.3f})", ref)
        if req.guillotine and rects and not _guillotine_ok(rects, k):
            c.err("NOT_GUILLOTINE", "layout is not guillotine-separable with the given kerf", ref)
        # residuals
        reuse_area = 0.0
        for j, r in enumerate(lay.residuals):
            rref = f"{ref}/residual:{j}"
            if r.width <= 0 or r.height <= 0:
                c.err("BAD_RESIDUAL", "residual with non-positive size", rref)
                continue
            if r.x < x0 - EPS or r.y < y0 - EPS or r.x + r.width > x1 + EPS or r.y + r.height > y1 + EPS:
                c.err("RESIDUAL_OUTSIDE", "residual outside usable area", rref)
            for q in rects:
                if (min(r.x + r.width, q[0] + q[2]) - max(r.x, q[0]) > EPS
                        and min(r.y + r.height, q[1] + q[3]) - max(r.y, q[1]) > EPS):
                    c.err("RESIDUAL_OVERLAPS_PIECE", "residual overlaps a placed piece", rref)
                    break
            for r2 in lay.residuals[j + 1:]:
                if (min(r.x + r.width, r2.x + r2.width) - max(r.x, r2.x) > EPS
                        and min(r.y + r.height, r2.y + r2.height) - max(r.y, r2.y) > EPS):
                    c.err("RESIDUALS_OVERLAP", "residual rectangles overlap", rref)
            mn, mx = min(req.min_residual_width, req.min_residual_height), max(req.min_residual_width,
                                                                                req.min_residual_height)
            reusable = min(r.width, r.height) + EPS >= mn and max(r.width, r.height) + EPS >= mx
            if r.reusable != reusable:
                c.err("RESIDUAL_FLAG_WRONG", f"reusable should be {reusable}", rref)
            if reusable:
                reuse_area += r.width * r.height
        sa = sh.width * sh.height
        if abs(lay.used_area - area) > 0.01:
            c.err("USED_AREA_MISMATCH", f"used_area {lay.used_area} != {area}", ref)
        if abs(lay.utilization - area / sa) > 1e-6:
            c.err("UTILIZATION_MISMATCH", "layout utilization mismatch", ref)
        n_sheets += lay.count
        sheet_used[sh.id] += lay.count
        tot_sheet += lay.count * sa
        tot_piece += lay.count * area
        tot_reuse += lay.count * reuse_area
        if sh.cost_per_sheet is not None:
            any_cost = True
            tot_cost += lay.count * sh.cost_per_sheet

    for sid, n in sheet_used.items():
        q = sheets[sid].quantity
        if q is not None and n > q:
            c.err("SHEET_QTY_EXCEEDED", f"sheet '{sid}' used {n} times, only {q} available", f"sheet:{sid}")
    unplaced: Dict[str, int] = defaultdict(int)
    for u in result.unplaced:
        if u.id not in pieces:
            c.err("UNKNOWN_UNPLACED", f"unplaced piece '{u.id}' not in request", f"piece:{u.id}")
        unplaced[u.id] += u.quantity
    for pid, q in demand.items():
        c.checked += 1
        if placed[pid] + unplaced[pid] != q:
            c.err("QUANTITY_MISMATCH", f"piece '{pid}': demanded {q}, placed {placed[pid]}, "
                  f"unplaced {unplaced[pid]}", f"piece:{pid}")

    s = result.summary
    for name, got, exp in (("total_sheet_area_m2", s.total_sheet_area_m2, tot_sheet / 1e6),
                           ("total_piece_area_m2", s.total_piece_area_m2, tot_piece / 1e6),
                           ("reusable_residual_area_m2", s.reusable_residual_area_m2, tot_reuse / 1e6),
                           ("waste_area_m2", s.waste_area_m2, (tot_sheet - tot_piece - tot_reuse) / 1e6)):
        if abs(got - exp) > AREA_TOL_M2 * max(1.0, abs(exp)):
            c.err("SUMMARY_MISMATCH", f"summary.{name} = {got}, recomputed {exp}", "summary")
    if s.sheets_used != n_sheets:
        c.err("SUMMARY_MISMATCH", f"summary.sheets_used = {s.sheets_used}, recomputed {n_sheets}", "summary")
    util = tot_piece / tot_sheet if tot_sheet > 0 else 0.0
    if abs(s.utilization - util) > 1e-6:
        c.err("SUMMARY_MISMATCH", "summary.utilization mismatch", "summary")
    if not _close(s.total_cost, tot_cost if any_cost else None, 0.01):
        c.err("SUMMARY_MISMATCH", "summary.total_cost mismatch", "summary")

    n_unplaced = sum(unplaced.values())
    if n_unplaced and result.status in ("OPTIMAL", "FEASIBLE"):
        c.err("STATUS_INCONSISTENT", f"status {result.status} but pieces unplaced", "status")
    usable = [(sh.width - tr.left - tr.right) * (sh.height - tr.top - tr.bottom) for sh in req.sheets
              if sh.quantity is None or sh.quantity > 0]
    usable = [u for u in usable if u > 0]
    if not n_unplaced and usable:
        lb = math.ceil(sum(p.width * p.height * p.quantity for p in req.pieces) / max(usable) - 1e-9)
        if n_sheets < lb:
            c.err("BELOW_LOWER_BOUND", f"sheets used {n_sheets} < lower bound {lb}", "summary")
        if result.status == "OPTIMAL" and n_sheets != lb:
            c.err("STATUS_INCONSISTENT", "OPTIMAL claimed but sheets used != area lower bound", "status")
    return c.report(VALIDATOR_2D)


# ---------------------------------------------------------------------------
# Calc
# ---------------------------------------------------------------------------
_KEY = re.compile(r"^b(\d+)-f(\d+)$")


def validate_calc(result: CalcResult) -> ValidationReport:
    c = _Collector()
    e = result.elevation
    qty = e.quantity
    has_errors = any(i.severity == "error" for i in result.issues)
    if result.validation_status == "INVALID" or has_errors:
        if result.profile_cuts or result.glass_items:
            c.err("INVALID_WITH_OUTPUT", "result with error issues must not contain cuts or glass", "result")
        return c.report(VALIDATOR_CALC)

    by_role: Dict[str, int] = defaultdict(int)
    prof_len: Dict[str, float] = defaultdict(float)
    for pc in result.profile_cuts:
        c.checked += 1
        ref = f"cut:{pc.mark}"
        if not pc.length > 0:
            c.err("NONPOSITIVE_LENGTH", f"cut {pc.mark} length {pc.length}", ref)
        if pc.quantity < 1:
            c.err("BAD_QUANTITY", f"cut {pc.mark} quantity {pc.quantity}", ref)
        if pc.quantity % qty:
            c.err("QTY_NOT_MULTIPLE", f"cut {pc.mark} quantity not a multiple of elevation quantity", ref)
        by_role[pc.role] += pc.quantity
        prof_len[pc.profile_id] += pc.length * pc.quantity

    # expected member counts re-derived from the echoed elevation
    n_m = len(e.mullions)
    n_b = len(e.bays)
    n_t = sum(len(b.transoms) for b in e.bays)
    for role, exp in (("mullion", n_m * qty), ("sill", n_b * qty), ("head", n_b * qty), ("transom", n_t * qty)):
        if by_role.get(role, 0) != exp:
            c.err("MEMBER_COUNT_MISMATCH", f"{role}: {by_role.get(role, 0)} cut pieces, expected {exp}", role)

    # fields
    fields = {}
    for b in range(n_b):
        ys = [0.0] + list(e.bays[b].transoms) + [e.height]
        for f in range(len(ys) - 1):
            fields[f"b{b}-f{f}"] = (e.mullions[b + 1] - e.mullions[b], ys[f + 1] - ys[f])
    seen: Dict[str, int] = defaultdict(int)
    glass_area: Dict[str, float] = defaultdict(float)
    panel_area: Dict[str, float] = defaultdict(float)
    for g in result.glass_items:
        c.checked += 1
        ref = f"glass:{g.mark}"
        if not (g.width > 0 and g.height > 0):
            c.err("NONPOSITIVE_GLASS", f"glass {g.mark} size {g.width}x{g.height}", ref)
        if abs(g.area_m2 - g.width * g.height / 1e6) > AREA_TOL_M2:
            c.err("AREA_MISMATCH", f"glass {g.mark} area {g.area_m2} != w*h", ref)
        if g.quantity != qty:
            c.err("BAD_QUANTITY", f"glass {g.mark} quantity {g.quantity} != elevation quantity {qty}", ref)
        if g.field_key not in fields:
            c.err("UNKNOWN_FIELD", f"glass {g.mark} refers to unknown field {g.field_key}", ref)
        else:
            aw, ah = fields[g.field_key]
            if g.width > aw + EPS or g.height > ah + EPS:
                c.err("GLASS_LARGER_THAN_FIELD", f"glass {g.mark} larger than field axis size", ref)
        seen[g.field_key] += 1
        if g.fill_type == "panel":
            panel_area[getattr(g, "panel_type_id", None) or "unspecified"] += g.area_m2 * g.quantity
        else:
            glass_area[g.glass_type_id or "unspecified"] += g.area_m2 * g.quantity
    for key in fields:
        fill = e.fills.get(key)
        ftype = fill.type if fill is not None else "glass"
        want = 1 if ftype in ("glass", "spandrel", "panel") else 0
        if seen.get(key, 0) != want:
            c.err("FIELD_FILL_COUNT", f"field {key} ({ftype}) has {seen.get(key, 0)} fill items, expected {want}",
                  f"field:{key}")

    # BOM vs cut / glass sums
    bom_prof: Dict[str, float] = defaultdict(float)
    bom_glass: Dict[str, float] = defaultdict(float)
    bom_panel: Dict[str, float] = defaultdict(float)
    for line in result.bom:
        c.checked += 1
        if line.quantity < 0:
            c.err("NEGATIVE_BOM", f"BOM {line.code} negative quantity", f"bom:{line.item_id}")
        if line.item_type == "profile" and line.unit == "m":
            bom_prof[line.item_id] += line.quantity
        elif line.item_type == "glass" and line.unit == "m2":
            bom_glass[line.item_id] += line.quantity
        elif line.item_type == "panel" and line.unit == "m2":
            bom_panel[line.item_id] += line.quantity
    for pid in set(prof_len) | set(bom_prof):
        if abs(prof_len.get(pid, 0.0) / 1000 - bom_prof.get(pid, 0.0)) > 1e-6:
            c.err("BOM_PROFILE_MISMATCH", f"profile {pid}: BOM {bom_prof.get(pid, 0)} m != cuts "
                  f"{prof_len.get(pid, 0) / 1000} m", f"bom:{pid}")
    for src, bom, name in ((glass_area, bom_glass, "glass"), (panel_area, bom_panel, "panel")):
        for gid in set(src) | set(bom):
            if abs(src.get(gid, 0.0) - bom.get(gid, 0.0)) > 1e-6:
                c.err("BOM_AREA_MISMATCH", f"{name} {gid}: BOM {bom.get(gid, 0)} != items {src.get(gid, 0)}",
                      f"bom:{gid}")
    t = result.totals or {}
    if "glass_area_m2" in t and abs(t["glass_area_m2"] - sum(glass_area.values())) > 1e-6:
        c.err("TOTALS_MISMATCH", "totals.glass_area_m2 != sum of glass items", "totals")
    if "profile_length_m" in t and abs(t["profile_length_m"] - sum(prof_len.values()) / 1000) > 1e-6:
        c.err("TOTALS_MISMATCH", "totals.profile_length_m != sum of cuts", "totals")
    if "field_count" in t and int(t["field_count"]) != len(fields):
        c.err("TOTALS_MISMATCH", "totals.field_count != number of fields", "totals")
    return c.report(VALIDATOR_CALC)
