from helpers import assert_error, uid


def test_admin_user_management(client, auth):
    h = auth["admin"]
    email = f"{uid('u').lower()}@demo.local"
    r = client.post("/api/v1/admin/users", headers=h, json={"email": email, "name": "New", "role": "estimator",
                                                            "password": "Secret@123"})
    assert r.status_code == 201
    u = r.json()
    assert_error(client.post("/api/v1/admin/users", headers=h, json={"email": email, "name": "dup",
                                                                     "password": "Secret@123"}), 409)
    assert_error(client.post("/api/v1/admin/users", headers=h, json={"email": "x@y.zz", "name": "w",
                                                                     "password": "short"}), 422)
    assert_error(client.post("/api/v1/admin/users", headers=h, json={"email": "x@y.zz", "name": "w", "role": "root",
                                                                     "password": "Secret@123"}), 422)
    r = client.put(f"/api/v1/admin/users/{u['id']}", headers=h, json={"role": "engineer"})
    assert r.json()["role"] == "engineer"
    tok = client.post("/api/v1/auth/login", json={"email": email, "password": "Secret@123"}).json()
    assert tok["user"]["role"] == "engineer"
    r = client.put(f"/api/v1/admin/users/{u['id']}", headers=h, json={"password": "Other@1234"})
    assert r.status_code == 200
    assert client.post("/api/v1/auth/login", json={"email": email, "password": "Other@1234"}).status_code == 200
    assert email in [x["email"] for x in client.get("/api/v1/admin/users", headers=h).json()]


def test_last_admin_cannot_be_demoted(client, auth):
    users = client.get("/api/v1/admin/users", headers=auth["admin"]).json()
    admins = [u for u in users if u["role"] == "admin" and u["active"]]
    if len(admins) == 1:
        assert_error(client.put(f"/api/v1/admin/users/{admins[0]['id']}", headers=auth["admin"],
                                json={"role": "viewer"}), 409, "LAST_ADMIN")
        assert_error(client.delete(f"/api/v1/admin/users/{admins[0]['id']}", headers=auth["admin"]), 409)


def test_audit_entries_and_filters(client, auth):
    h = auth["admin"]
    code = uid("AUD")
    p = client.post("/api/v1/projects", headers=auth["engineer"], json={"code": code, "name": "Audited"}).json()
    client.put(f"/api/v1/projects/{p['id']}", headers=auth["engineer"], json={"name": "Audited 2"})
    client.post("/api/v1/auth/login", json={"email": "engineer@demo.local", "password": "wrong-pass"})
    client.post("/api/v1/cutting/1d/optimize", headers=auth["viewer"],
                json={"stocks": [{"id": "S", "length": 6000}], "pieces": [{"id": "A", "length": 100, "quantity": 2}]})
    client.delete(f"/api/v1/projects/{p['id']}", headers=auth["engineer"])

    a = client.get(f"/api/v1/admin/audit?entity=project&entity_id={p['id']}", headers=h).json()
    actions = [x["action"] for x in a["items"]]
    assert actions == ["delete", "update", "create"]
    assert a["items"][1]["detail"]["changes"]["name"] == {"from": "Audited", "to": "Audited 2"}
    assert all(x["user_email"] == "engineer@demo.local" and x["request_id"] for x in a["items"])
    fails = client.get("/api/v1/admin/audit?action=login_failed", headers=h).json()
    assert fails["total"] >= 1 and fails["items"][0]["detail"]["email"] == "engineer@demo.local"
    assert "password" not in str(fails["items"][0]["detail"])
    assert client.get("/api/v1/admin/audit?action=login", headers=h).json()["total"] >= 1
    opt = client.get("/api/v1/admin/audit?action=optimize&entity=cutting_stateless", headers=h).json()
    assert opt["total"] >= 1
    page = client.get("/api/v1/admin/audit?limit=2&offset=1", headers=h).json()
    assert len(page["items"]) == 2 and page["limit"] == 2 and page["offset"] == 1 and page["total"] > 3
    assert_error(client.get("/api/v1/admin/audit?limit=0", headers=h), 422)


def test_report_and_calc_are_audited(client, auth, project):
    p, e = project
    run = client.post(f"/api/v1/elevations/{e['id']}/calculate", headers=auth["engineer"]).json()
    client.get(f"/api/v1/reports/calc/{run['id']}.pdf", headers=auth["viewer"])
    a = client.get(f"/api/v1/admin/audit?entity=calc_run&entity_id={run['id']}", headers=auth["admin"]).json()
    assert {"calculate", "report"} <= {x["action"] for x in a["items"]}
