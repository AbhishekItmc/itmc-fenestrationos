"""End-to-end flows across routers + persistence (run against SQLite by default, PostgreSQL with
TEST_DATABASE_URL)."""
from helpers import assert_error, lobby_elevation, uid


def test_design_to_cutting_flow(client, auth):
    h = auth["engineer"]
    c = client.post("/api/v1/customers", headers=h, json={"name": uid("Cust")}).json()
    p = client.post("/api/v1/projects", headers=h, json={"code": uid("FLOW"), "name": "Flow", "customer_id": c["id"],
                                                         "status": "design"}).json()
    e = client.post(f"/api/v1/projects/{p['id']}/elevations", headers=h, json={"data": lobby_elevation()}).json()
    run = client.post(f"/api/v1/elevations/{e['id']}/calculate", headers=h).json()
    assert run["validation_status"] == "PROVISIONAL_DEMO_RULES"

    # build requests only (no persistence)
    items = client.post(f"/api/v1/cutting/from-calc/{run['id']}", headers=h).json()
    cuts = run["result"]["profile_cuts"]
    assert {i["profile_id"] for i in items} == {c_["profile_id"] for c_ in cuts}
    cat = client.get("/api/v1/catalogue", headers=h).json()
    prof = {x["id"]: x for x in cat["profiles"]}
    for it in items:
        rq = it["request"]
        assert rq["kerf"] == 4.0 and rq["trim_start"] == 10.0 and rq["material"] == it["profile_code"]
        assert sorted(s["length"] for s in rq["stocks"]) == sorted(prof[it["profile_id"]]["stock_lengths"])
        assert all(s["quantity"] is None for s in rq["stocks"])
        expected = {c_["mark"] for c_ in cuts if c_["profile_id"] == it["profile_id"]}
        assert {pc["id"] for pc in rq["pieces"]} == expected
        assert it["job_id"] is None
    total_req = sum(c_["quantity"] for c_ in cuts)
    assert sum(pc["quantity"] for it in items for pc in it["request"]["pieces"]) == total_req

    # with overrides + optimise -> persisted jobs
    items = client.post(f"/api/v1/cutting/from-calc/{run['id']}?optimize=true", headers=h,
                        json={"kerf": 3.0}).json()
    for it in items:
        assert it["job_id"] and it["validation_status"] in ("FEASIBLE_HEURISTIC", "OPTIMAL_PROVEN")
        job = client.get(f"/api/v1/cutting/jobs/{it['job_id']}", headers=h).json()
        assert job["request"]["kerf"] == 3.0 and job["project_id"] == p["id"] and job["demo"] is True
        assert job["source_calc_run_id"] == run["id"] and job["result"]["validation"]["passed"]
        assert not job["result"]["unplaced"]
    jobs = client.get(f"/api/v1/cutting/jobs?project_id={p['id']}", headers=h).json()
    assert len(jobs) == len(items)


def test_residuals_reused_first_in_next_optimisation(client, auth):
    h = auth["engineer"]
    mat = uid("PRF")
    req = {"material": mat, "kerf": 4, "trim_start": 10, "trim_end": 0, "min_reusable_offcut": 500,
           "stocks": [{"id": "BAR6000", "length": 6000}], "pieces": [{"id": "A", "length": 3000, "quantity": 2}]}
    job1 = client.post("/api/v1/cutting/jobs", headers=h, json={"name": "J1", "request": req}).json()
    pats = job1["result"]["patterns"]
    # 2 x 3000 + kerf doesn't fit one 6000 bar -> 2 bars with ~2986 reusable offcut each
    assert job1["result"]["summary"]["bars_used"] == 2 and all(pt["offcut_reusable"] for pt in pats)
    res = client.post(f"/api/v1/inventory/residuals/from-cutting/{job1['id']}", headers=h,
                      json={"location": "Rack R1"})
    assert res.status_code == 201, res.text
    items = res.json()
    assert sum(i["quantity"] for i in items) == 2
    assert all(i["is_residual"] and i["kind"] == "bar" and i["material"] == mat and i["location"] == "Rack R1"
               and i["source_job_id"] == job1["id"] for i in items)
    assert_error(client.post(f"/api/v1/inventory/residuals/from-cutting/{job1['id']}", headers=h), 409,
                 "RESIDUALS_ALREADY_ADDED")
    inv = client.get(f"/api/v1/inventory?kind=bar&material={mat}", headers=h).json()
    assert len(inv) == len(items)

    stock = client.get(f"/api/v1/inventory/as-stock?kind=bar&material={mat}", headers=h).json()
    assert stock and all(s["is_offcut"] and s["id"].startswith("INV-") for s in stock)
    offcut_len = stock[0]["length"]
    assert offcut_len > 2900

    # next job: two pieces of 1400 -> both fit on one offcut; offcuts must be consumed before new bars
    req2 = {**req, "pieces": [{"id": "B", "length": 1400, "quantity": 2}],
            "stocks": stock + [{"id": "BAR6000", "length": 6000}], "prefer_offcuts": True}
    job2 = client.post("/api/v1/cutting/jobs", headers=h,
                       json={"name": "J2", "request": req2, "consume_inventory": True}).json()
    assert job2["result"]["validation"]["passed"]
    used = {pt["stock_id"]: pt["count"] for pt in job2["result"]["patterns"]}
    assert "BAR6000" not in used and all(k.startswith("INV-") for k in used)
    assert job2["inventory_consumed"]
    inv_id = int(next(iter(used)).split("-")[1])
    item = client.get(f"/api/v1/inventory/{inv_id}", headers=h).json()
    before = next(i for i in items if i["id"] == inv_id)["quantity"]
    assert item["quantity"] == before - used[f"INV-{inv_id}"]
    # manual consume of the rest
    left = [i for i in client.get(f"/api/v1/inventory?kind=bar&material={mat}&status=available", headers=h).json()]
    for it in left:
        r = client.post(f"/api/v1/inventory/{it['id']}/consume", headers=h, json={"quantity": it["quantity"]})
        assert r.status_code == 200 and r.json()["status"] == "consumed" and r.json()["quantity"] == 0
        assert_error(client.post(f"/api/v1/inventory/{it['id']}/consume", headers=h), 409, "ALREADY_CONSUMED")
    assert client.get(f"/api/v1/inventory/as-stock?kind=bar&material={mat}", headers=h).json() == []


def test_nesting_residuals_to_inventory(client, auth):
    h = auth["engineer"]
    mat = uid("GLS")
    req = {"kerf": 3, "sheets": [{"id": "SH", "width": 3210, "height": 2250, "material": mat, "thickness": 6}],
           "pieces": [{"id": "P", "width": 1000, "height": 2000, "quantity": 1, "material": mat, "thickness": 6}]}
    job = client.post("/api/v1/nesting/jobs", headers=h, json={"name": "N1", "request": req}).json()
    reusable = [r for lay in job["result"]["layouts"] for r in lay["residuals"] if r["reusable"]]
    assert reusable
    items = client.post(f"/api/v1/inventory/residuals/from-nesting/{job['id']}", headers=h).json()
    assert sum(i["quantity"] for i in items) == len(reusable)
    assert all(i["kind"] == "sheet" and i["material"] == mat and i["thickness"] == 6 for i in items)
    sheets = client.get(f"/api/v1/inventory/as-stock?kind=sheet&material={mat}", headers=h).json()
    assert sheets and all(s["is_residual"] for s in sheets)
    big = max(sheets, key=lambda s: s["width"] * s["height"])
    req2 = {"kerf": 3, "sheets": sheets + [{"id": "NEW", "width": 3210, "height": 2250, "material": mat,
                                            "thickness": 6}],
            "pieces": [{"id": "Q", "width": min(big["width"], big["height"]) - 10,
                        "height": min(big["width"], big["height"]) - 10, "quantity": 1, "material": mat,
                        "thickness": 6}], "prefer_residuals": True}
    job2 = client.post("/api/v1/nesting/jobs", headers=h,
                       json={"name": "N2", "request": req2, "consume_inventory": True}).json()
    assert job2["result"]["validation"]["passed"]
    assert all(lay["sheet_id"].startswith("INV-") for lay in job2["result"]["layouts"])
    assert job2["inventory_consumed"]


def test_manual_inventory_crud(client, auth):
    h = auth["engineer"]
    r = client.post("/api/v1/inventory", headers=h, json={"kind": "bar", "material": "X-1", "length": 6500,
                                                          "quantity": 12, "location": "Store"})
    assert r.status_code == 201
    it = r.json()
    assert it["source_kind"] == "manual" and not it["is_residual"]
    assert_error(client.post("/api/v1/inventory", headers=h, json={"kind": "sheet", "width": 100}), 422)
    assert client.put(f"/api/v1/inventory/{it['id']}", headers=h, json={"status": "reserved"}).json()["status"] == \
        "reserved"
    assert client.get("/api/v1/inventory/as-stock?kind=bar&material=X-1", headers=h).json() == []
    assert client.delete(f"/api/v1/inventory/{it['id']}", headers=h).status_code == 204


def test_seed_is_idempotent(app, settings, db):
    from sqlalchemy import func, select
    from app.models import CalcRun, CatalogueRevision, Customer, CuttingJob, Project, User
    from app.seed import run_seed

    def counts():
        return [db.scalar(select(func.count(m.id))) for m in (CatalogueRevision, Customer, Project, User,
                                                               CalcRun, CuttingJob)]
    run_seed(db, settings)
    first = counts()
    run_seed(db, settings)
    assert counts() == first
    demo = db.scalars(select(Project).where(Project.code.in_(["DEMO-P001", "DEMO-P002", "DEMO-P003"]))).all()
    assert len(demo) == 3 and all("fictitious" in p.name for p in demo)
    assert db.scalars(select(User).where(User.email == "viewer@demo.local")).first().role == "viewer"


def test_seeded_demo_content_visible(client, auth):
    projects = {p["code"]: p for p in client.get("/api/v1/projects", headers=auth["viewer"]).json()}
    p1 = projects["DEMO-P001"]
    elevs = client.get(f"/api/v1/projects/{p1['id']}/elevations", headers=auth["viewer"]).json()
    lobby = next(e for e in elevs if e["data"]["width"] == 6000)
    assert lobby["data"]["bays"][0]["transoms"] == [1100, 2400] and len(lobby["data"]["bays"]) == 4
    runs = client.get(f"/api/v1/projects/{p1['id']}/calc-runs", headers=auth["viewer"]).json()
    assert runs and runs[-1]["validation_status"] == "PROVISIONAL_DEMO_RULES"
    jobs = client.get(f"/api/v1/cutting/jobs?project_id={p1['id']}", headers=auth["viewer"]).json()
    assert jobs and all(j["validation_status"] in ("FEASIBLE_HEURISTIC", "OPTIMAL_PROVEN") for j in jobs)


def test_alembic_migration_matches_models(tmp_path):
    """`alembic upgrade head` on a fresh SQLite file creates every ORM table and leaves no autogenerate diff."""
    from pathlib import Path

    from alembic import command
    from alembic.autogenerate import compare_metadata
    from alembic.config import Config
    from alembic.migration import MigrationContext
    from sqlalchemy import create_engine, inspect

    from app.db import Base
    backend = Path(__file__).resolve().parents[2]
    url = f"sqlite:///{tmp_path / 'mig.db'}"
    cfg = Config(str(backend / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend / "alembic"))
    cfg.attributes["database_url"] = url
    command.upgrade(cfg, "head")
    eng = create_engine(url)
    assert set(Base.metadata.tables) <= set(inspect(eng).get_table_names())
    with eng.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn, opts={"compare_type": False}), Base.metadata)
    assert diff == [], diff


def test_from_calc_uses_inventory_offcuts_first(client, auth, project):
    p, e = project
    h = auth["engineer"]
    run = client.post(f"/api/v1/elevations/{e['id']}/calculate", headers=h).json()
    code = next(c["profile_code"] for c in run["result"]["profile_cuts"] if c["role"] == "transom")
    # 2 offcuts x 3000 mm take 4 of the 16 transom-type pieces (1448 mm) -> saves one new bar, so the optimiser
    # (objective: minimise NEW stock length when prefer_offcuts) must use them
    inv = client.post("/api/v1/inventory", headers=h, json={"kind": "bar", "material": code, "length": 3000,
                                                            "quantity": 2, "is_residual": True}).json()
    items = client.post(f"/api/v1/cutting/from-calc/{run['id']}?optimize=true", headers=h,
                        json={"use_inventory": True}).json()
    it = next(i for i in items if i["profile_code"] == code)
    assert it["request"]["stocks"][0]["id"] == f"INV-{inv['id']}" and it["request"]["stocks"][0]["is_offcut"]
    job = client.get(f"/api/v1/cutting/jobs/{it['job_id']}", headers=h).json()
    assert any(pt["stock_id"] == f"INV-{inv['id']}" for pt in job["result"]["patterns"])
    client.delete(f"/api/v1/inventory/{inv['id']}", headers=h)
