"""Test helpers (importable as `helpers` from any test module)."""
from __future__ import annotations

import uuid

DEMO_PW = "Test@Pass-12345"


def uid(prefix: str = "T") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def lobby_elevation(**over):
    d = {"name": "Test lobby", "width": 6000, "height": 3600, "mullions": [0, 1500, 3000, 4500, 6000],
         "bays": [{"transoms": [1100, 2400]} for _ in range(4)], "system_id": "ser-cw50", "colour_id": "col-ral7016",
         "default_glass_type_id": "gl-dgu-24", "anchor_levels": [0, 3600]}
    d.update(over)
    return d


def assert_error(resp, status, code=None):
    assert resp.status_code == status, resp.text
    body = resp.json()
    assert set(body) == {"detail"}
    d = body["detail"]
    assert {"code", "message", "issues"} <= set(d), d
    assert isinstance(d["issues"], list)
    if code:
        assert d["code"] == code, d
    return d
