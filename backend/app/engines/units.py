"""Unit and tolerance helpers. All engine lengths are millimetres (float)."""
from __future__ import annotations

import math

EPS = 1e-6          # geometric tolerance (mm)
SUMMARY_TOL = 0.01  # tolerance for recomputed summary figures (mm / mm2 scaled)


def round_mm(value: float, step: float = 0.1) -> float:
    """Round a length for display (default 0.1 mm). Uses half-away-from-zero, not banker's rounding."""
    if step <= 0:
        raise ValueError("step must be > 0")
    q = value / step
    r = math.floor(abs(q) + 0.5 + 1e-9) * step
    r = math.copysign(r, q) if q != 0 else 0.0
    # clean binary noise, e.g. 0.30000000000000004
    return round(r, 6) + 0.0


def round_to(value: float, ndigits: int = 3) -> float:
    return float(round(value, ndigits))


def mm_to_m(mm: float) -> float:
    return mm / 1000.0


def mm2_to_m2(mm2: float) -> float:
    return mm2 / 1_000_000.0


def rect_area_m2(width_mm: float, height_mm: float) -> float:
    return mm2_to_m2(width_mm * height_mm)


def feq(a: float, b: float, tol: float = EPS) -> bool:
    return abs(a - b) <= tol


def fle(a: float, b: float, tol: float = EPS) -> bool:
    return a <= b + tol


def fge(a: float, b: float, tol: float = EPS) -> bool:
    return a + tol >= b
