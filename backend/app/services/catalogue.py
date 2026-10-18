"""Catalogue revisions: active catalogue lookup, seeding from the demo JSON and audited item edits."""
from __future__ import annotations

import copy
import re
from typing import Any, Dict, Optional, Tuple

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..engines.catalogue import COLLECTIONS, load_demo_catalogue, validate_catalogue
from ..errors import APIError
from ..models import CatalogueRevision, User

_REV = re.compile(r"^(.*?)-r(\d+)$")


def active_revision(db: Session) -> CatalogueRevision:
    rev = db.scalars(select(CatalogueRevision).where(CatalogueRevision.active.is_(True))
                     .order_by(CatalogueRevision.id.desc())).first()
    if rev is None:
        raise APIError(503, "CATALOGUE_MISSING", "No active catalogue revision. Run the seed (python -m app.seed).")
    return rev


def get_catalogue(db: Session, version: Optional[str] = None) -> Dict[str, Any]:
    if version:
        rev = db.scalars(select(CatalogueRevision).where(CatalogueRevision.version == version)).first()
        if rev is None:
            raise APIError(404, "CATALOGUE_VERSION_NOT_FOUND", f"Catalogue version '{version}' not found")
        return copy.deepcopy(rev.data)
    return copy.deepcopy(active_revision(db).data)


def ensure_seed_catalogue(db: Session) -> Tuple[CatalogueRevision, bool]:
    existing = db.scalars(select(CatalogueRevision).order_by(CatalogueRevision.id)).first()
    if existing is not None:
        return active_revision(db), False
    data = load_demo_catalogue()
    rev = CatalogueRevision(version=str(data["catalogue_version"]), data=data, active=True,
                            demo=bool(data.get("demo_data", True)), note="Seeded from demo_catalogue.json")
    db.add(rev)
    db.flush()
    return rev, True


def ensure_design_check_params(db: Session) -> Optional[CatalogueRevision]:
    """v0.2 upgrade (idempotent): when the ACTIVE revision is a demo revision whose rule sets lack the DEMO
    design-check params (§8.3) shipped in demo_catalogue.json, create a new revision with only those missing params
    (+ param_docs) added. Existing values are never overwritten; non-demo catalogues are left untouched."""
    from ..engines.checks import CHECK_PARAMS
    try:
        cur = active_revision(db)
    except APIError:
        return None
    if not cur.demo:
        return None
    seed = {rs["id"]: rs for rs in load_demo_catalogue().get("rule_sets", [])}
    data = copy.deepcopy(cur.data)
    added: Dict[str, list] = {}
    for rs in data.get("rule_sets", []):
        src = seed.get(rs.get("id"))
        if not src:
            continue
        params, docs = rs.setdefault("params", {}), rs.setdefault("param_docs", {})
        for k in CHECK_PARAMS:
            if k not in params and k in src.get("params", {}):
                params[k] = src["params"][k]
                docs.setdefault(k, src.get("param_docs", {}).get(k, "source: DEMO placeholder — requires approval"))
                added.setdefault(rs["id"], []).append(k)
    if not added:
        return None
    new_ver = next_version(db, cur.version)
    data["catalogue_version"] = new_ver
    db.execute(update(CatalogueRevision).where(CatalogueRevision.active.is_(True)).values(active=False))
    rev = CatalogueRevision(version=new_ver, data=data, active=True, demo=True,
                            note="v0.2: added DEMO design-check params " + "; ".join(
                                f"{k}: {', '.join(v)}" for k, v in added.items()))
    db.add(rev)
    db.flush()
    return rev


def next_version(db: Session, current: str) -> str:
    m = _REV.match(current)
    base, n = (m.group(1), int(m.group(2))) if m else (current, 0)
    while True:
        n += 1
        cand = f"{base}-r{n}"
        if db.scalars(select(CatalogueRevision.id).where(CatalogueRevision.version == cand)).first() is None:
            return cand


def edit_item(db: Session, collection: str, item_id: str, item: Dict[str, Any], user: User,
              note: Optional[str] = None) -> Tuple[CatalogueRevision, Dict[str, Any], bool, Optional[Dict[str, Any]]]:
    """Upsert one catalogue item into a NEW revision (previous revision kept, deactivated)."""
    if collection not in COLLECTIONS:
        raise APIError(404, "UNKNOWN_COLLECTION", f"Unknown catalogue collection '{collection}'. "
                                                  f"Valid: {', '.join(COLLECTIONS)}")
    if "id" in item and str(item["id"]) != item_id:
        raise APIError(400, "ID_MISMATCH", "Item id in body does not match the URL")
    item = {**item, "id": item_id}
    cur = active_revision(db)
    data = copy.deepcopy(cur.data)
    coll = data.setdefault(collection, [])
    before = None
    created = True
    for i, existing in enumerate(coll):
        if existing.get("id") == item_id:
            before = existing
            coll[i] = item
            created = False
            break
    if created:
        coll.append(item)
    new_ver = next_version(db, cur.version)
    data["catalogue_version"] = new_ver
    issues = validate_catalogue(data)
    errors = [i for i in issues if i.severity == "error"]
    if errors:
        raise APIError(422, "CATALOGUE_INVALID", "Catalogue edit rejected by validate_catalogue", errors)
    db.execute(update(CatalogueRevision).where(CatalogueRevision.active.is_(True)).values(active=False))
    rev = CatalogueRevision(version=new_ver, data=data, active=True, demo=bool(data.get("demo_data", True)),
                            note=note or f"{'create' if created else 'update'} {collection}/{item_id}",
                            created_by=user.id)
    db.add(rev)
    db.flush()
    return rev, item, created, before
