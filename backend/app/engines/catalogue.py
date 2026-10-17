"""Catalogue loading, validation and lookups.

The catalogue is a plain dict (JSON shape documented in ARCHITECTURE.md section 5). The shipped
seed is DEMO data only - see its `disclaimer`.
"""
from __future__ import annotations

import copy
import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

from .models import Issue

SEED_PATH = Path(__file__).resolve().parent.parent / "seed" / "demo_catalogue.json"

REQUIRED_RULE_PARAMS = (
    "mullion_ext_top", "mullion_ext_bottom", "transom_clearance",
    "glass_deduction_x", "glass_deduction_y", "gasket_runs_per_field_edge",
    "connectors_per_transom", "brackets_per_anchor", "max_bar_length",
    "min_field_width", "min_field_height", "max_field_width", "max_field_height",
)
COLLECTIONS = ("series", "profiles", "glass_types", "panel_types", "accessories", "colours",
               "rule_sets", "compatibility")
PROFILE_ROLES = {"mullion", "transom", "pressure_plate", "cover_cap", "extension", "splice_sleeve"}
GLASS_CATEGORIES = {"single", "laminated", "igu", "spandrel", "fire", "special", "project"}


@lru_cache(maxsize=1)
def _load_cached(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def load_demo_catalogue(path: Optional[str] = None) -> Dict[str, Any]:
    """Load the demo catalogue (file read is cached; a fresh deep copy is returned each call so
    callers may mutate it safely)."""
    return copy.deepcopy(_parsed(str(path or SEED_PATH)))


@lru_cache(maxsize=4)
def _parsed(path: str) -> Dict[str, Any]:
    return json.loads(_load_cached(path))


def _find(cat: Dict[str, Any], collection: str, item_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not item_id:
        return None
    for item in cat.get(collection, []) or []:
        if item.get("id") == item_id:
            return item
    return None


def get_series(cat: Dict[str, Any], series_id: Optional[str]) -> Optional[Dict[str, Any]]:
    return _find(cat, "series", series_id)


def get_profile(cat: Dict[str, Any], profile_id: Optional[str]) -> Optional[Dict[str, Any]]:
    return _find(cat, "profiles", profile_id)


def get_rule_set(cat: Dict[str, Any], rule_set_id: Optional[str]) -> Optional[Dict[str, Any]]:
    return _find(cat, "rule_sets", rule_set_id)


def get_glass_type(cat: Dict[str, Any], glass_type_id: Optional[str]) -> Optional[Dict[str, Any]]:
    return _find(cat, "glass_types", glass_type_id)


def get_panel_type(cat: Dict[str, Any], panel_type_id: Optional[str]) -> Optional[Dict[str, Any]]:
    return _find(cat, "panel_types", panel_type_id)


def get_colour(cat: Dict[str, Any], colour_id: Optional[str]) -> Optional[Dict[str, Any]]:
    return _find(cat, "colours", colour_id)


def get_accessory(cat: Dict[str, Any], accessory_id: Optional[str]) -> Optional[Dict[str, Any]]:
    return _find(cat, "accessories", accessory_id)


def find_accessory(cat: Dict[str, Any], kind: str, series_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """First accessory of `kind` applicable to the series (series-specific preferred over shared)."""
    shared = None
    for a in cat.get("accessories", []) or []:
        if a.get("kind") != kind:
            continue
        sids = a.get("series_ids") or []
        if series_id and sids == [series_id]:
            return a
        if (not sids or series_id in sids) and shared is None:
            shared = a
    return shared


def compatibility_rules(cat: Dict[str, Any], series_id: Optional[str], kind: str) -> List[Dict[str, Any]]:
    return [c for c in cat.get("compatibility", []) or []
            if c.get("kind") == kind and (c.get("series_id") in (None, series_id))]


def validate_catalogue(cat: Dict[str, Any]) -> List[Issue]:
    """Referential integrity + required rule params. Returns issues (empty list == valid)."""
    issues: List[Issue] = []

    def err(code: str, msg: str, ref: Optional[str] = None, sev: str = "error") -> None:
        issues.append(Issue(code=code, severity=sev, message=msg, ref=ref))

    if not cat.get("catalogue_version"):
        err("CAT_NO_VERSION", "catalogue_version is missing")
    for coll in COLLECTIONS:
        if not isinstance(cat.get(coll, []), list):
            err("CAT_BAD_COLLECTION", f"'{coll}' must be a list", coll)
            return issues
        seen = set()
        for item in cat.get(coll, []):
            iid = item.get("id")
            if not iid:
                err("CAT_MISSING_ID", f"item in '{coll}' without id", coll)
            elif iid in seen:
                err("CAT_DUPLICATE_ID", f"duplicate id '{iid}' in '{coll}'", f"{coll}:{iid}")
            seen.add(iid)
    if cat.get("demo_data") and not cat.get("disclaimer"):
        err("CAT_NO_DISCLAIMER", "demo catalogue must carry a disclaimer")

    series_ids = {s.get("id") for s in cat.get("series", [])}
    for p in cat.get("profiles", []):
        ref = f"profiles:{p.get('id')}"
        if p.get("series_id") not in series_ids:
            err("CAT_BAD_REF", f"profile series_id '{p.get('series_id')}' not found", ref)
        if p.get("role") not in PROFILE_ROLES:
            err("CAT_BAD_ROLE", f"unknown profile role '{p.get('role')}'", ref)
        for k in ("face_width", "depth"):
            v = p.get(k)
            if not isinstance(v, (int, float)) or v <= 0:
                err("CAT_BAD_VALUE", f"profile {k} must be > 0", ref)
        if not p.get("stock_lengths"):
            err("CAT_BAD_VALUE", "profile has no stock_lengths", ref, "warning")

    for s in cat.get("series", []):
        ref = f"series:{s.get('id')}"
        for key, role in (("mullion_profile_ids", "mullion"), ("transom_profile_ids", "transom")):
            for pid in s.get(key, []) or []:
                p = get_profile(cat, pid)
                if p is None:
                    err("CAT_BAD_REF", f"{key}: profile '{pid}' not found", ref)
                elif p.get("role") != role or p.get("series_id") != s.get("id"):
                    err("CAT_BAD_REF", f"{key}: profile '{pid}' is not a {role} of this series", ref)
        for key in ("pressure_plate_profile_id", "cover_cap_profile_id", "splice_sleeve_profile_id",
                    "default_mullion_profile_id", "default_transom_profile_id"):
            if s.get(key) and get_profile(cat, s[key]) is None:
                err("CAT_BAD_REF", f"{key}: profile '{s[key]}' not found", ref)
        if s.get("default_rule_set_id") and get_rule_set(cat, s["default_rule_set_id"]) is None:
            err("CAT_BAD_REF", f"default_rule_set_id '{s['default_rule_set_id']}' not found", ref)
        gmin, gmax = s.get("glass_thickness_min"), s.get("glass_thickness_max")
        if gmin is not None and gmax is not None and gmin > gmax:
            err("CAT_BAD_VALUE", "glass_thickness_min > glass_thickness_max", ref)

    for rs in cat.get("rule_sets", []):
        ref = f"rule_sets:{rs.get('id')}"
        if rs.get("series_id") not in series_ids:
            err("CAT_BAD_REF", f"rule set series_id '{rs.get('series_id')}' not found", ref)
        params = rs.get("params") or {}
        docs = rs.get("param_docs") or {}
        for name in REQUIRED_RULE_PARAMS:
            if name not in params:
                err("CAT_RULE_PARAM_MISSING", f"required rule param '{name}' missing", ref)
            elif not isinstance(params[name], (int, float)):
                err("CAT_BAD_VALUE", f"rule param '{name}' must be numeric", ref)
        for name in params:
            if name not in docs:
                err("CAT_RULE_PARAM_UNDOCUMENTED", f"rule param '{name}' has no param_docs entry", ref)

    for g in cat.get("glass_types", []):
        ref = f"glass_types:{g.get('id')}"
        if g.get("category") not in GLASS_CATEGORIES:
            err("CAT_BAD_CATEGORY", f"unknown glass category '{g.get('category')}'", ref)
        if g.get("category") == "fire" and g.get("fire_rating") is not None and cat.get("demo_data"):
            err("CAT_FIRE_RATING_IN_DEMO", "demo fire glass must not state a fire rating", ref)

    for a in cat.get("accessories", []):
        for sid in a.get("series_ids", []) or []:
            if sid not in series_ids:
                err("CAT_BAD_REF", f"accessory series '{sid}' not found", f"accessories:{a.get('id')}")
    for c in cat.get("compatibility", []):
        if c.get("series_id") is not None and c.get("series_id") not in series_ids:
            err("CAT_BAD_REF", f"compatibility series '{c.get('series_id')}' not found", f"compatibility:{c.get('id')}")
    return issues
