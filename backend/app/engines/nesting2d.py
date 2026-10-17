"""2D rectangular sheet nesting (glass, ACP, aluminium sheet).

Semantics (ARCHITECTURE.md section 4, assumption A-05 - requires approval):
  * usable sheet area = sheet minus edge trims; pieces may touch the trimmed edge
  * kerf = minimum clear gap between two pieces
  * rotation by 90 degrees only when piece.can_rotate
  * guillotine=true -> every layout is producible by edge-to-edge cuts

Kerf handling uses the classic inflation trick: every piece is packed as (w + kerf) x (h + kerf) into a
usable region enlarged by kerf on the right and top. Two inflated rectangles that do not overlap give
actual pieces separated by >= kerf; a piece inside the enlarged region stays inside the real usable area.

Algorithms: guillotine free-rectangle packer (best-area-fit, two split rules) and, when guillotine=false,
also MaxRects (best-short-side-fit). Several piece orderings are tried; the best layout set is kept
(fewest sheets, then least sheet area, then largest reusable residual area). Results are checked by the
independent validators.validate_2d.
"""
from __future__ import annotations

import math
import time
from collections import Counter, OrderedDict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .models import (Issue, Nesting2DRequest, Nesting2DResult, Piece2D, Placement2D, Residual2D, Sheet2D,
                     SheetLayout, Summary2D, ValidationReport)
from .validators import validate_2d

ENGINE_VERSION = "nesting2d/0.1.0"
EPS = 1e-6
Rect = Tuple[float, float, float, float]  # x, y, w, h


def _norm(s: Optional[str]) -> Optional[str]:
    return s.strip().lower() if isinstance(s, str) and s.strip() else None


def _compatible(p: Piece2D, s: Sheet2D) -> bool:
    pm, sm = _norm(p.material), _norm(s.material)
    if pm and sm and pm != sm:
        return False
    if p.thickness is not None and s.thickness is not None and abs(p.thickness - s.thickness) > EPS:
        return False
    return True


# ---------------------------------------------------------------------------
# single-sheet packers (operate in inflated coordinates)
# ---------------------------------------------------------------------------
class _GuillotineBin:
    def __init__(self, region: Rect, split_rule: str):
        self.free: List[Rect] = [region] if region[2] > EPS and region[3] > EPS else []
        self.split_rule = split_rule

    def find(self, w: float, h: float) -> Optional[Tuple[float, int]]:
        best = None
        for i, (fx, fy, fw, fh) in enumerate(self.free):
            if fw + EPS >= w and fh + EPS >= h:
                score = fw * fh - w * h
                if best is None or score < best[0] - EPS:
                    best = (score, i)
        return best

    def place(self, i: int, w: float, h: float) -> Tuple[float, float]:
        fx, fy, fw, fh = self.free.pop(i)
        dw, dh = fw - w, fh - h
        if self.split_rule == "slas":
            horizontal = dw < dh          # shorter-leftover-axis split
        else:
            horizontal = fw * dh >= dw * fh  # max-area split: keep the larger leftover whole
        if horizontal:
            top = (fx, fy + h, fw, dh)
            right = (fx + w, fy, dw, h)
        else:
            top = (fx, fy + h, w, dh)
            right = (fx + w, fy, dw, fh)
        for r in (top, right):
            if r[2] > EPS and r[3] > EPS:
                self.free.append(r)
        return fx, fy

    def free_rects(self) -> List[Rect]:
        return list(self.free)


class _MaxRectsBin:
    def __init__(self, region: Rect):
        self.free: List[Rect] = [region] if region[2] > EPS and region[3] > EPS else []

    def find(self, w: float, h: float) -> Optional[Tuple[float, int]]:
        best = None
        for i, (fx, fy, fw, fh) in enumerate(self.free):
            if fw + EPS >= w and fh + EPS >= h:
                score = min(fw - w, fh - h) * 1e7 + max(fw - w, fh - h)
                if best is None or score < best[0] - EPS:
                    best = (score, i)
        return best

    def place(self, i: int, w: float, h: float) -> Tuple[float, float]:
        fx, fy = self.free[i][0], self.free[i][1]
        used = (fx, fy, w, h)
        new_free: List[Rect] = []
        for f in self.free:
            if not _overlap(f, used):
                new_free.append(f)
                continue
            x, y, fw, fh = f
            ux, uy, uw, uh = used
            if ux > x + EPS:
                new_free.append((x, y, ux - x, fh))
            if ux + uw < x + fw - EPS:
                new_free.append((ux + uw, y, x + fw - (ux + uw), fh))
            if uy > y + EPS:
                new_free.append((x, y, fw, uy - y))
            if uy + uh < y + fh - EPS:
                new_free.append((x, uy + uh, fw, y + fh - (uy + uh)))
        # prune contained rectangles
        new_free.sort(key=lambda r: -(r[2] * r[3]))
        pruned: List[Rect] = []
        for r in new_free:
            if r[2] <= EPS or r[3] <= EPS:
                continue
            if not any(_contains(q, r) for q in pruned):
                pruned.append(r)
        self.free = pruned
        return fx, fy

    def free_rects(self) -> List[Rect]:
        chosen: List[Rect] = []
        for r in sorted(self.free, key=lambda r: -(r[2] * r[3])):
            if not any(_overlap(r, q) for q in chosen):
                chosen.append(r)
        return chosen


def _overlap(a: Rect, b: Rect) -> bool:
    return (min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]) > EPS and
            min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]) > EPS)


def _contains(a: Rect, b: Rect) -> bool:
    return (b[0] >= a[0] - EPS and b[1] >= a[1] - EPS and b[0] + b[2] <= a[0] + a[2] + EPS
            and b[1] + b[3] <= a[1] + a[3] + EPS)


# ---------------------------------------------------------------------------
# multi-sheet greedy
# ---------------------------------------------------------------------------
@dataclass
class _OpenSheet:
    sheet_idx: int
    packer: object
    placements: List[Tuple[int, float, float, bool]] = field(default_factory=list)  # (piece idx, x, y, rotated)


def _orientations(p: Piece2D, k: float) -> List[Tuple[float, float, bool]]:
    o = [(p.width + k, p.height + k, False)]
    if p.can_rotate and abs(p.width - p.height) > EPS:
        o.append((p.height + k, p.width + k, True))
    return o


class _Packer:
    def __init__(self, req: Nesting2DRequest):
        self.req = req
        self.k = req.kerf
        t = req.edge_trim
        self.regions: List[Rect] = []
        for s in req.sheets:
            uw = s.width - t.left - t.right
            uh = s.height - t.top - t.bottom
            self.regions.append((t.left, t.bottom, uw + self.k, uh + self.k) if uw > EPS and uh > EPS
                                else (t.left, t.bottom, 0.0, 0.0))

    def sheet_order(self) -> List[int]:
        sh = self.req.sheets
        res = [i for i, s in enumerate(sh) if s.is_residual]
        new = [i for i, s in enumerate(sh) if not s.is_residual]
        res.sort(key=lambda i: sh[i].width * sh[i].height)
        new.sort(key=lambda i: -(sh[i].width * sh[i].height))
        if self.req.prefer_residuals:
            return res + new
        allc = res + new
        allc.sort(key=lambda i: -(sh[i].width * sh[i].height))
        return allc

    def _new_bin(self, si: int, algo: str, split: str):
        return _MaxRectsBin(self.regions[si]) if algo == "maxrects" else _GuillotineBin(self.regions[si], split)

    def run(self, items: List[int], algo: str, split: str) -> Tuple[List[_OpenSheet], List[int]]:
        req = self.req
        order = self.sheet_order()
        remaining = {i: (req.sheets[i].quantity if req.sheets[i].quantity is not None else math.inf) for i in order}
        sheets: List[_OpenSheet] = []
        unplaced: List[int] = []
        for pi in items:
            p = req.pieces[pi]
            ors = _orientations(p, self.k)
            done = False
            for os_ in sheets:
                if not _compatible(p, req.sheets[os_.sheet_idx]):
                    continue
                best = None
                for (w, h, rot) in ors:
                    f = os_.packer.find(w, h)
                    if f is not None and (best is None or f[0] < best[0] - EPS):
                        best = (f[0], f[1], w, h, rot)
                if best is not None:
                    x, y = os_.packer.place(best[1], best[2], best[3])
                    os_.placements.append((pi, x, y, best[4]))
                    done = True
                    break
            if done:
                continue
            for si in order:
                if remaining[si] < 1 or not _compatible(p, req.sheets[si]):
                    continue
                reg = self.regions[si]
                fits = [(w, h, rot) for (w, h, rot) in ors if reg[2] + EPS >= w and reg[3] + EPS >= h]
                if not fits:
                    continue
                remaining[si] -= 1
                b = self._new_bin(si, algo, split)
                best = None
                for (w, h, rot) in fits:
                    f = b.find(w, h)
                    if f is not None and (best is None or f[0] < best[0] - EPS):
                        best = (f[0], f[1], w, h, rot)
                x, y = b.place(best[1], best[2], best[3])
                os_ = _OpenSheet(si, b, [(pi, x, y, best[4])])
                sheets.append(os_)
                done = True
                break
            if not done:
                unplaced.append(pi)
        return sheets, unplaced


def _residuals(req: Nesting2DRequest, si: int, packer_bin, region: Rect, k: float) -> List[Residual2D]:
    s = req.sheets[si]
    t = req.edge_trim
    X1 = s.width - t.right
    Y1 = s.height - t.top
    rects = []
    for (x, y, w, h) in packer_bin.free_rects():
        w2 = min(x + w, X1) - x
        h2 = min(y + h, Y1) - y
        if w2 > EPS and h2 > EPS:
            rects.append([x, y, w2, h2])
    # merge rectangles sharing a full edge (keeps them disjoint)
    merged = True
    while merged:
        merged = False
        for i in range(len(rects)):
            for j in range(i + 1, len(rects)):
                a, b = rects[i], rects[j]
                if abs(a[1] - b[1]) <= EPS and abs(a[3] - b[3]) <= EPS and (
                        abs(a[0] + a[2] - b[0]) <= EPS or abs(b[0] + b[2] - a[0]) <= EPS):
                    rects[i] = [min(a[0], b[0]), a[1], a[2] + b[2], a[3]]
                elif abs(a[0] - b[0]) <= EPS and abs(a[2] - b[2]) <= EPS and (
                        abs(a[1] + a[3] - b[1]) <= EPS or abs(b[1] + b[3] - a[1]) <= EPS):
                    rects[i] = [a[0], min(a[1], b[1]), a[2], a[3] + b[3]]
                else:
                    continue
                del rects[j]
                merged = True
                break
            if merged:
                break
    mn = min(req.min_residual_width, req.min_residual_height)
    mx = max(req.min_residual_width, req.min_residual_height)
    out = []
    for x, y, w, h in sorted(rects, key=lambda r: -(r[2] * r[3])):
        reusable = min(w, h) + EPS >= mn and max(w, h) + EPS >= mx
        if reusable or min(w, h) >= 10.0:
            out.append(Residual2D(x=x, y=y, width=w, height=h, reusable=reusable))
    return out


SORTS = {
    "area": lambda p: (-(p.width * p.height), -max(p.width, p.height)),
    "max-side": lambda p: (-max(p.width, p.height), -min(p.width, p.height)),
    "height": lambda p: (-p.height, -p.width),
    "width": lambda p: (-p.width, -p.height),
    "perimeter": lambda p: (-(p.width + p.height), -max(p.width, p.height)),
}


def optimize_2d(req: Nesting2DRequest) -> Nesting2DResult:
    t0 = time.perf_counter()
    issues: List[Issue] = []
    packer = _Packer(req)
    k = req.kerf

    # duplicate ids
    seen: Dict[str, Piece2D] = {}
    for p in req.pieces:
        if p.id in seen and (abs(seen[p.id].width - p.width) > EPS or abs(seen[p.id].height - p.height) > EPS):
            issues.append(Issue(code="DUPLICATE_PIECE_ID", severity="error",
                                message=f"piece id '{p.id}' used with different sizes", ref=f"piece:{p.id}"))
        seen[p.id] = p

    if not req.sheets:
        issues.append(Issue(code="NO_STOCK", severity="error", message="no sheets supplied"))
    # pre-check: pieces that fit no sheet at all
    impossible = set()
    for pi, p in enumerate(req.pieces):
        ok = False
        compat_any = False
        for si, s in enumerate(req.sheets):
            if s.quantity is not None and s.quantity < 1:
                continue
            if not _compatible(p, s):
                continue
            compat_any = True
            reg = packer.regions[si]
            if any(reg[2] + EPS >= w and reg[3] + EPS >= h for (w, h, _r) in _orientations(p, k)):
                ok = True
                break
        if not ok:
            impossible.add(pi)
            code = "PIECE_TOO_LARGE" if compat_any else "NO_COMPATIBLE_SHEET"
            msg = (f"piece '{p.id}' ({p.width}x{p.height}{'' if p.can_rotate else ', no rotation'}) does not fit "
                   f"the usable area of any available sheet" if compat_any else
                   f"piece '{p.id}' has no sheet with matching material/thickness")
            issues.append(Issue(code=code, severity="error", message=msg, ref=f"piece:{p.id}"))

    expanded = [pi for pi, p in enumerate(req.pieces) if pi not in impossible for _ in range(p.quantity)]
    algos = [("guillotine", "slas"), ("guillotine", "maxarea")]
    if not req.guillotine:
        algos = [("maxrects", "-")] + algos
    sheet_area = {i: s.width * s.height for i, s in enumerate(req.sheets)}

    best = None
    for sname, skey in SORTS.items():
        items = sorted(expanded, key=lambda pi: (skey(req.pieces[pi]), pi))
        for algo, split in algos:
            sheets, unpl = packer.run(items, algo, split)
            n_new_area = sum(sheet_area[s.sheet_idx] for s in sheets if not req.sheets[s.sheet_idx].is_residual)
            tot_area = sum(sheet_area[s.sheet_idx] for s in sheets)
            reuse = 0.0
            res_cache = []
            for s in sheets:
                rs = _residuals(req, s.sheet_idx, s.packer, packer.regions[s.sheet_idx], k)
                res_cache.append(rs)
                reuse += sum(r.width * r.height for r in rs if r.reusable)
            key = (len(unpl), round(n_new_area if req.prefer_residuals else 0.0, 3), len(sheets),
                   round(tot_area, 3), -round(reuse, 3))
            if best is None or key < best[0]:
                best = (key, sheets, unpl, res_cache, f"{'MaxRects-BSSF' if algo == 'maxrects' else 'guillotine-BAF-' + split}"
                        f" / sort:{sname}")
            if time.perf_counter() - t0 > req.time_limit_s:
                break
        if time.perf_counter() - t0 > req.time_limit_s:
            issues.append(Issue(code="TIME_LIMIT_REACHED", severity="info",
                                message="time limit reached before all heuristic variants were tried"))
            break

    _key, sheets, unpl, res_cache, method = best if best else ((), [], [], [], "none")
    unplaced_idx = list(unpl) + [pi for pi in impossible for _ in range(req.pieces[pi].quantity)]
    exhausted = [pi for pi in unpl if pi not in impossible]
    if exhausted:
        issues.append(Issue(code="SHEETS_EXHAUSTED", severity="error",
                            message=f"{len(exhausted)} piece(s) unplaced: finite sheet quantities exhausted",
                            ref="sheets"))

    # build layouts, grouping identical ones
    groups: "OrderedDict[Tuple, Dict]" = OrderedDict()
    for s, rs in zip(sheets, res_cache):
        pls = sorted(s.placements, key=lambda t: (t[2], t[1]))
        sig = (s.sheet_idx, tuple((req.pieces[pi].id, round(x, 6), round(y, 6), rot) for pi, x, y, rot in pls))
        if sig in groups:
            groups[sig]["count"] += 1
        else:
            groups[sig] = {"si": s.sheet_idx, "pls": pls, "res": rs, "count": 1}
    layouts: List[SheetLayout] = []
    tot_sheet = tot_piece = tot_reuse = 0.0
    cost = 0.0
    any_cost = False
    n_sheets = 0
    for n, g in enumerate(groups.values(), 1):
        sh = req.sheets[g["si"]]
        placements = []
        area = 0.0
        for pi, x, y, rot in g["pls"]:
            p = req.pieces[pi]
            w, h = (p.height, p.width) if rot else (p.width, p.height)
            placements.append(Placement2D(piece_id=p.id, label=p.label, x=x, y=y, width=w, height=h, rotated=rot))
            area += p.width * p.height
        sa = sh.width * sh.height
        reuse = sum(r.width * r.height for r in g["res"] if r.reusable)
        c = g["count"]
        layouts.append(SheetLayout(layout_id=f"L{n}", sheet_id=sh.id, sheet_label=sh.label, width=sh.width,
                                   height=sh.height, is_residual_sheet=sh.is_residual, count=c,
                                   placements=placements, residuals=g["res"], used_area=area,
                                   utilization=area / sa))
        n_sheets += c
        tot_sheet += c * sa
        tot_piece += c * area
        tot_reuse += c * reuse
        if sh.cost_per_sheet is not None:
            any_cost = True
            cost += c * sh.cost_per_sheet
    summary = Summary2D(sheets_used=n_sheets, total_sheet_area_m2=tot_sheet / 1e6, total_piece_area_m2=tot_piece / 1e6,
                        waste_area_m2=(tot_sheet - tot_piece - tot_reuse) / 1e6,
                        reusable_residual_area_m2=tot_reuse / 1e6,
                        utilization=tot_piece / tot_sheet if tot_sheet > 0 else 0.0,
                        total_cost=cost if any_cost else None)
    uc = Counter(unplaced_idx)
    unplaced = [req.pieces[pi].model_copy(update={"quantity": q}) for pi, q in sorted(uc.items())]
    # lower bound
    t = req.edge_trim
    usable = [(s.width - t.left - t.right) * (s.height - t.top - t.bottom) for s in req.sheets
              if s.quantity is None or s.quantity > 0]
    usable = [u for u in usable if u > 0]
    lb = (math.ceil(sum(p.width * p.height * p.quantity for p in req.pieces) / max(usable) - 1e-9)
          if usable else None)
    same_size = len({(round(s.width, 6), round(s.height, 6)) for s in req.sheets}) == 1
    if unplaced and n_sheets == 0:
        status = "INFEASIBLE"
    elif unplaced:
        status = "PARTIAL"
    elif lb is not None and n_sheets == lb and same_size:
        status = "OPTIMAL"
    else:
        status = "FEASIBLE"
    res = Nesting2DResult(engine_version=ENGINE_VERSION, method=method, status=status,
                          validation_status="FEASIBLE_HEURISTIC", layouts=layouts, unplaced=unplaced, summary=summary,
                          lower_bound_sheets=lb, validation=ValidationReport(passed=True, validator="pending"),
                          issues=issues, request=req, runtime_ms=0.0)
    res.validation = validate_2d(req, res)
    if not res.validation.passed:
        res.validation_status = "INVALID"
    elif status == "OPTIMAL":
        res.validation_status = "OPTIMAL_PROVEN"
    res.runtime_ms = (time.perf_counter() - t0) * 1000.0
    return res
