"""Generate parity fixtures for the v0.2 TS ports (design checks, DXF) from the Python engines.

Run from the repo root: backend/.venv/bin/python frontend/scripts/regen_v02_fixtures.py
Writes src/engine/__fixtures__/checks_cases.json and dxf_cases.json.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.engines.checks import run_design_checks  # noqa: E402
from app.engines.dxf_export import elevation_to_dxf  # noqa: E402
from app.engines.models import Elevation  # noqa: E402

cat = json.loads((ROOT / "backend/app/seed/demo_catalogue.json").read_text())
out_dir = ROOT / "frontend/src/engine/__fixtures__"


def grid(name, w, h, xs, levels, **kw):
    bays = [{"transoms": list(levels[i]) if (levels and isinstance(levels[0], list)) else list(levels)} for i in range(len(xs) - 1)]
    base = {"name": name, "units": "mm", "width": w, "height": h, "mullions": xs, "bays": bays, "fills": {},
            "top_shape": {"type": "flat"}, "system_id": "ser-cw50", "default_glass_type_id": "gl-dgu-24",
            "colour_id": "col-ral7016", "anchor_levels": [0, h], "quantity": 1}
    base.update(kw)
    return base


cases = [
    grid("Clean grid", 4500, 3600, [0, 1500, 3000, 4500], [1800]),
    grid("Heavy wide pane", 6000, 4000, [0, 3000, 6000], [], default_glass_type_id="gl-dgu-28", colour_id=None,
         anchor_levels=[]),
    grid("Slender fields", 3000, 4200, [0, 400, 3000], [2100], anchor_levels=[4200]),
    grid("Tall unanchored — mixed fills", 3600, 9000, [0, 1200, 2400, 3600], [3000, 6000], anchor_levels=[0],
         fills={"b0-f0": {"type": "spandrel", "glass_type_id": "gl-spandrel-6"}, "b1-f1": {"type": "panel", "panel_type_id": "pnl-alu-3"},
                "b2-f2": {"type": "opening"}, "b2-f0": {"type": "none"}}, quantity=2),
    grid("Lobby — CW65 — ×2", 4800, 3600, [0, 1400, 3400, 4800], [[], [2700], []], system_id="ser-cw65",
         default_glass_type_id="gl-dgu-28", colour_id="col-ano-nat"),
]

checks = []
dxfs = []
for c in cases:
    e = Elevation.model_validate(c)
    checks.append({"name": c["name"], "elevation": json.loads(e.model_dump_json()),
                   "issues": [json.loads(i.model_dump_json()) for i in run_design_checks(e, cat)]})
    dxfs.append({"name": c["name"], "elevation": json.loads(e.model_dump_json()), "dxf": elevation_to_dxf(e, cat),
                 "dxf_no_catalogue": elevation_to_dxf(e, None)})
(out_dir / "checks_cases.json").write_text(json.dumps(checks, indent=1, ensure_ascii=False) + "\n")
(out_dir / "dxf_cases.json").write_text(json.dumps(dxfs, indent=1, ensure_ascii=False) + "\n")
print("codes:", sorted({i["code"] for c in checks for i in c["issues"]}))
