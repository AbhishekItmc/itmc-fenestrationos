"""Elevation -> ASCII DXF R12 (AC1009), millimetres (ARCHITECTURE §8.4). Hand-written, no dependencies.

Layers: FOS-MULLION, FOS-TRANSOM, FOS-GLASS, FOS-PANEL, FOS-DIM, FOS-TEXT.
* Member outlines from catalogue face widths: mullions x ± face/2 over 0..H; sill/transoms/head per bay between
  the mullion faces, y ± transom face/2 (sill and head are clipped to the framework outline 0..H).
* Fields: the clear opening between member faces as a closed POLYLINE (glass/spandrel -> FOS-GLASS,
  panel -> FOS-PANEL; none/opening -> no rectangle) + mark text (same marks as the calc engine).
* Dimensions as LINE + TEXT only (no DIMENSION entities): overall width/height and chained bay widths /
  horizontal levels (union of all bays' transom levels).
Coordinates: origin = framework bottom-left, x right, y up (same as the Elevation model).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from .catalogue import get_profile
from .elevation import (
    bay_levels,
    effective_mullion_profile_id,
    effective_transom_profile_id,
    field_rects,
    resolve_fill,
)
from .models import Elevation

LAYERS: List[Tuple[str, int]] = [("FOS-MULLION", 5), ("FOS-TRANSOM", 4), ("FOS-GLASS", 3), ("FOS-PANEL", 6),
                                 ("FOS-DIM", 1), ("FOS-TEXT", 7)]
DEFAULT_FACE = 50.0
DIM_OFFSET_1 = 250.0     # chained dimensions offset from the framework
DIM_OFFSET_2 = 500.0     # overall dimensions offset
TICK = 40.0


def _n(v: float) -> str:
    s = f"{float(v):.4f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def _txt(s: str) -> str:
    # DXF R12 is single-byte text: keep it ASCII and free of control characters
    out = s.encode("ascii", "replace").decode("ascii")
    return "".join(ch if 32 <= ord(ch) < 127 else "?" for ch in out)


class _W:
    def __init__(self) -> None:
        self.lines: List[str] = []

    def pair(self, code: int, value: Any) -> None:
        self.lines.append(str(code))
        self.lines.append(value if isinstance(value, str) else _n(value))

    def line(self, layer: str, x1: float, y1: float, x2: float, y2: float) -> None:
        self.pair(0, "LINE")
        self.pair(8, layer)
        for c, v in ((10, x1), (20, y1), (30, 0.0), (11, x2), (21, y2), (31, 0.0)):
            self.pair(c, v)

    def rect(self, layer: str, x0: float, y0: float, x1: float, y1: float) -> None:
        """Closed 2D POLYLINE (R12: POLYLINE + VERTEX... + SEQEND; LWPOLYLINE does not exist in R12)."""
        self.pair(0, "POLYLINE")
        self.pair(8, layer)
        self.pair(66, "1")
        for c, v in ((10, 0.0), (20, 0.0), (30, 0.0)):
            self.pair(c, v)
        self.pair(70, "1")  # closed
        for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
            self.pair(0, "VERTEX")
            self.pair(8, layer)
            for c, v in ((10, x), (20, y), (30, 0.0)):
                self.pair(c, v)
        self.pair(0, "SEQEND")
        self.pair(8, layer)

    def text(self, layer: str, x: float, y: float, h: float, s: str, rot: float = 0.0, centred: bool = True) -> None:
        self.pair(0, "TEXT")
        self.pair(8, layer)
        for c, v in ((10, x), (20, y), (30, 0.0), (40, h)):
            self.pair(c, v)
        self.pair(1, _txt(s))
        if rot:
            self.pair(50, rot)
        if centred:  # middle-centre alignment: 72=1 (centre), 73=2 (middle) + alignment point 11/21
            self.pair(72, "1")
            for c, v in ((11, x), (21, y), (31, 0.0)):
                self.pair(c, v)
            self.pair(73, "2")


def _face(cat: Optional[Dict[str, Any]], pid: Optional[str]) -> float:
    p = get_profile(cat or {}, pid) if pid else None
    try:
        return float(p.get("face_width")) if p and p.get("face_width") else DEFAULT_FACE
    except (TypeError, ValueError):
        return DEFAULT_FACE


def _mark(elev: Elevation, key: str, bay: int, field: int) -> Tuple[Optional[str], str]:
    f = resolve_fill(elev, key)
    if f.type == "panel":
        return "FOS-PANEL", f"P{bay + 1}.{field + 1}"
    if f.type == "spandrel":
        return "FOS-GLASS", f"SP{bay + 1}.{field + 1}"
    if f.type == "glass":
        return "FOS-GLASS", f"G{bay + 1}.{field + 1}"
    return None, f"{f.type.upper()} {bay + 1}.{field + 1}"


def _hdim(w: _W, xa: float, xb: float, y: float, h: float) -> None:
    w.line("FOS-DIM", xa, y, xb, y)
    for x in (xa, xb):
        w.line("FOS-DIM", x, y - TICK, x, y + TICK)
    w.text("FOS-DIM", (xa + xb) / 2, y + h * 0.9, h, _n(xb - xa))


def _vdim(w: _W, ya: float, yb: float, x: float, h: float) -> None:
    w.line("FOS-DIM", x, ya, x, yb)
    for y in (ya, yb):
        w.line("FOS-DIM", x - TICK, y, x + TICK, y)
    w.text("FOS-DIM", x - h * 0.9, (ya + yb) / 2, h, _n(yb - ya), rot=90.0)


def elevation_to_dxf(elev: Elevation, catalogue: Optional[Dict[str, Any]] = None) -> str:
    W_, H_ = float(elev.width), float(elev.height)
    m = [float(x) for x in elev.mullions]
    mfw = _face(catalogue, effective_mullion_profile_id(elev, catalogue) if catalogue else elev.mullion_profile_id)
    th = max(40.0, min(150.0, min(W_, H_) / 40.0))   # text height (mm)
    ext_min = (-DIM_OFFSET_2 - 2 * th, -DIM_OFFSET_2 - 2 * th)
    ext_max = (W_ + DIM_OFFSET_2 + 2 * th, H_ + 3 * th)

    w = _W()
    # HEADER
    w.pair(0, "SECTION")
    w.pair(2, "HEADER")
    w.pair(9, "$ACADVER")
    w.pair(1, "AC1009")
    w.pair(9, "$INSUNITS")
    w.pair(70, "4")          # millimetres
    w.pair(9, "$MEASUREMENT")
    w.pair(70, "1")          # metric
    w.pair(9, "$EXTMIN")
    w.pair(10, ext_min[0]); w.pair(20, ext_min[1]); w.pair(30, 0.0)  # noqa: E702
    w.pair(9, "$EXTMAX")
    w.pair(10, ext_max[0]); w.pair(20, ext_max[1]); w.pair(30, 0.0)  # noqa: E702
    w.pair(0, "ENDSEC")
    # TABLES
    w.pair(0, "SECTION")
    w.pair(2, "TABLES")
    w.pair(0, "TABLE")
    w.pair(2, "LTYPE")
    w.pair(70, "1")
    w.pair(0, "LTYPE")
    w.pair(2, "CONTINUOUS")
    w.pair(70, "0")
    w.pair(3, "Solid line")
    w.pair(72, "65")
    w.pair(73, "0")
    w.pair(40, 0.0)
    w.pair(0, "ENDTAB")
    w.pair(0, "TABLE")
    w.pair(2, "LAYER")
    w.pair(70, str(len(LAYERS) + 1))
    for name, colour in [("0", 7)] + LAYERS:
        w.pair(0, "LAYER")
        w.pair(2, name)
        w.pair(70, "0")
        w.pair(62, str(colour))
        w.pair(6, "CONTINUOUS")
    w.pair(0, "ENDTAB")
    w.pair(0, "ENDSEC")
    # ENTITIES
    w.pair(0, "SECTION")
    w.pair(2, "ENTITIES")
    for x in m:
        w.rect("FOS-MULLION", x - mfw / 2, 0.0, x + mfw / 2, H_)
    for b in range(min(len(elev.bays), len(m) - 1)):
        tfw = _face(catalogue, effective_transom_profile_id(elev, b, catalogue) if catalogue
                    else (elev.bays[b].transom_profile_id or elev.transom_profile_id))
        xa, xb = m[b] + mfw / 2, m[b + 1] - mfw / 2
        for y in bay_levels(elev, b):
            w.rect("FOS-TRANSOM", xa, max(0.0, y - tfw / 2), xb, min(H_, y + tfw / 2))
    for r in field_rects(elev):
        b = r["bay"]
        tfw = _face(catalogue, effective_transom_profile_id(elev, b, catalogue) if catalogue
                    else (elev.bays[b].transom_profile_id or elev.transom_profile_id))
        x0, x1 = r["x0"] + mfw / 2, r["x1"] - mfw / 2
        y0, y1 = r["y0"] + tfw / 2, r["y1"] - tfw / 2
        layer, mark = _mark(elev, r["key"], b, r["field"])
        if layer and x1 > x0 and y1 > y0:
            w.rect(layer, x0, y0, x1, y1)
        w.text("FOS-TEXT", (r["x0"] + r["x1"]) / 2, (r["y0"] + r["y1"]) / 2, th, mark)
    # dimensions: chained bay widths + overall width (below), chained levels + overall height (left)
    for xa, xb in zip(m, m[1:]):
        _hdim(w, xa, xb, -DIM_OFFSET_1, th)
    _hdim(w, 0.0, W_, -DIM_OFFSET_2, th)
    levels = sorted({0.0, H_} | {float(t) for bay in elev.bays for t in bay.transoms})
    for ya, yb in zip(levels, levels[1:]):
        _vdim(w, ya, yb, -DIM_OFFSET_1, th)
    _vdim(w, 0.0, H_, -DIM_OFFSET_2, th)
    title = f"{elev.name} - {_n(W_)} x {_n(H_)} mm" + (f" - qty {elev.quantity}" if elev.quantity > 1 else "")
    w.text("FOS-TEXT", W_ / 2, H_ + 1.8 * th, th * 1.2, title)
    w.pair(0, "ENDSEC")
    w.pair(0, "EOF")
    return "\n".join(w.lines) + "\n"


def parse_dxf_entities(text: str) -> List[Dict[str, Any]]:
    """Tiny DXF reader (tests / diagnostics): returns the ENTITIES section as [{type, layer, codes: [(c, v)]}].
    VERTEX/SEQEND are folded into their POLYLINE (`vertices`: [(x, y)])."""
    lines = text.splitlines()
    if len(lines) % 2:
        raise ValueError("odd number of DXF lines")
    pairs = [(int(lines[i].strip()), lines[i + 1].strip()) for i in range(0, len(lines), 2)]
    out: List[Dict[str, Any]] = []
    in_ent = False
    cur: Optional[Dict[str, Any]] = None
    poly: Optional[Dict[str, Any]] = None
    for i, (c, v) in enumerate(pairs):
        if c == 0:
            if cur is not None:
                if cur["type"] == "VERTEX" and poly is not None:
                    d = dict(cur["codes"])
                    poly["vertices"].append((float(d[10]), float(d[20])))
                elif cur["type"] == "SEQEND":
                    poly = None
                else:
                    out.append(cur)
                    if cur["type"] == "POLYLINE":
                        cur["vertices"] = []
                        poly = cur
                cur = None
            if v == "SECTION" and pairs[i + 1] == (2, "ENTITIES"):
                in_ent = True
                continue
            if v == "ENDSEC":
                in_ent = False
                continue
            if in_ent:
                cur = {"type": v, "layer": None, "codes": []}
        elif cur is not None:
            if c == 8:
                cur["layer"] = v
            cur["codes"].append((c, v))
    return out
