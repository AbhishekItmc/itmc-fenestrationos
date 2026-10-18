"""Regenerate src/engine/__fixtures__/calc_cases.json `result`s from the Python calc engine.

Run from the repo root: backend/.venv/bin/python frontend/scripts/regen_calc_fixtures.py
Keeps each case's elevation and `issues_no_catalogue`; recomputes `result` with the current engine + catalogue.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.engines.calc import calculate  # noqa: E402
from app.engines.elevation import validate_elevation  # noqa: E402
from app.engines.models import Elevation  # noqa: E402

fx = ROOT / "frontend/src/engine/__fixtures__/calc_cases.json"
cat = json.loads((ROOT / "backend/app/seed/demo_catalogue.json").read_text())
cases = json.loads(fx.read_text())
for c in cases:
    elev = Elevation.model_validate(c["elevation"])
    c["result"] = json.loads(calculate(elev, cat).model_dump_json())
    c["issues_no_catalogue"] = [json.loads(i.model_dump_json()) for i in validate_elevation(elev)]
fx.write_text(json.dumps(cases, indent=1, ensure_ascii=False) + "\n")
print(f"regenerated {len(cases)} cases -> {fx}")
