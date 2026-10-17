"""Role matrix (ARCHITECTURE §6): viewer is read-only; estimator cannot edit catalogue/elevations; engineer
cannot quote; admin-only endpoints."""
import pytest

from helpers import assert_error, lobby_elevation, uid


@pytest.mark.parametrize("method,path,body", [
    ("post", "/api/v1/customers", {"name": "X"}),
    ("post", "/api/v1/projects", {"code": "V-1", "name": "X"}),
    ("post", "/api/v1/cutting/jobs", {"name": "x", "request": {"stocks": [{"id": "s", "length": 6000}],
                                                                "pieces": [{"id": "a", "length": 100, "quantity": 1}]}}),
    ("post", "/api/v1/inventory", {"kind": "bar", "length": 1000}),
    ("put", "/api/v1/catalogue/colours/col-ral9010", {"name": "x"}),
    ("get", "/api/v1/admin/users", None),
    ("get", "/api/v1/admin/audit", None),
    ("post", "/api/v1/projects/1/quotes", {"calc_run_ids": [1]}),
    ("post", "/api/v1/projects/1/revisions", {"label": "x"}),
    ("post", "/api/v1/projects/1/elevations", {"data": lobby_elevation()}),
])
def test_viewer_cannot_write(client, auth, method, path, body):
    r = getattr(client, method)(path, headers=auth["viewer"], **({"json": body} if body is not None else {}))
    assert_error(r, 403, "FORBIDDEN")


def test_viewer_can_read_and_use_stateless_engines(client, auth):
    h = auth["viewer"]
    assert client.get("/api/v1/projects", headers=h).status_code == 200
    assert client.get("/api/v1/catalogue", headers=h).status_code == 200
    r = client.post("/api/v1/calc/elevation", headers=h, json={"elevation": lobby_elevation()})
    assert r.status_code == 200
    r = client.post("/api/v1/cutting/1d/optimize", headers=h,
                    json={"stocks": [{"id": "S", "length": 6000}], "pieces": [{"id": "A", "length": 1000,
                                                                               "quantity": 3}]})
    assert r.status_code == 200


def test_estimator_cannot_edit_catalogue_or_elevations(client, auth, project):
    p, e = project
    assert_error(client.put("/api/v1/catalogue/colours/col-ral9010", headers=auth["estimator"],
                            json={"name": "x"}), 403)
    assert_error(client.put(f"/api/v1/elevations/{e['id']}", headers=auth["estimator"],
                            json={"version": e["version"], "name": "x"}), 403)
    assert_error(client.post(f"/api/v1/elevations/{e['id']}/calculate", headers=auth["estimator"]), 403)
    # but estimator may create customers/projects
    assert client.post("/api/v1/customers", headers=auth["estimator"], json={"name": uid("C")}).status_code == 201


def test_engineer_cannot_quote_or_admin(client, auth, project):
    p, e = project
    run = client.post(f"/api/v1/elevations/{e['id']}/calculate", headers=auth["engineer"]).json()
    assert_error(client.post(f"/api/v1/projects/{p['id']}/quotes", headers=auth["engineer"],
                             json={"calc_run_ids": [run["id"]]}), 403)
    assert_error(client.get("/api/v1/admin/users", headers=auth["engineer"]), 403)
    assert client.post(f"/api/v1/projects/{p['id']}/quotes", headers=auth["estimator"],
                       json={"calc_run_ids": [run["id"]]}).status_code == 201


def test_project_membership_restricts_writes(client, auth, project):
    p, e = project
    users = {u["email"]: u for u in client.get("/api/v1/admin/users", headers=auth["admin"]).json()}
    est = users["estimator@demo.local"]
    r = client.post(f"/api/v1/projects/{p['id']}/members", headers=auth["admin"],
                    json={"user_id": est["id"], "role": "editor"})
    assert r.status_code == 201
    # engineer is not a member any more -> blocked on this project
    assert_error(client.put(f"/api/v1/projects/{p['id']}", headers=auth["engineer"], json={"site": "x"}), 403,
                 "PROJECT_FORBIDDEN")
    assert client.put(f"/api/v1/projects/{p['id']}", headers=auth["estimator"], json={"site": "y"}).status_code == 200
    assert client.delete(f"/api/v1/projects/{p['id']}/members/{est['id']}", headers=auth["admin"]).status_code == 204
    assert client.put(f"/api/v1/projects/{p['id']}", headers=auth["engineer"], json={"site": "z"}).status_code == 200
