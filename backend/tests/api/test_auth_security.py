from helpers import DEMO_PW, assert_error


def test_health_public(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    b = r.json()
    assert b["status"] == "ok" and b["db"] == "ok"
    assert b["engines"]["cutting1d"].startswith("cutting1d/")
    assert b["engines"]["calc"].startswith("calc/")
    assert b["catalogue_version"]


def test_login_success_and_me(client):
    r = client.post("/api/v1/auth/login", json={"email": "Engineer@Demo.local", "password": DEMO_PW})
    assert r.status_code == 200
    b = r.json()
    assert b["token_type"] == "bearer" and b["user"]["role"] == "engineer"
    assert "hashed_password" not in b["user"]
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {b['access_token']}"})
    assert me.status_code == 200 and me.json()["email"] == "engineer@demo.local"


def test_login_failure_generic_message(client):
    wrong = client.post("/api/v1/auth/login", json={"email": "admin@demo.local", "password": "nope-nope"})
    unknown = client.post("/api/v1/auth/login", json={"email": "nobody@demo.local", "password": "nope-nope"})
    d1, d2 = assert_error(wrong, 401, "INVALID_CREDENTIALS"), assert_error(unknown, 401, "INVALID_CREDENTIALS")
    assert d1["message"] == d2["message"]


def test_login_rate_limited(client):
    for _ in range(5):
        assert client.post("/api/v1/auth/login", json={"email": "viewer@demo.local", "password": "bad-pass"}
                           ).status_code == 401
    r = client.post("/api/v1/auth/login", json={"email": "viewer@demo.local", "password": DEMO_PW})
    assert_error(r, 429, "RATE_LIMITED")
    assert int(r.headers["Retry-After"]) > 0


def test_unauthenticated_and_bad_token(client):
    assert_error(client.get("/api/v1/projects"), 401, "UNAUTHORIZED")
    r = client.get("/api/v1/projects", headers={"Authorization": "Bearer not.a.jwt"})
    assert_error(r, 401, "UNAUTHORIZED")
    assert r.headers.get("www-authenticate") == "Bearer"


def test_token_signed_with_other_secret_rejected(client):
    from jose import jwt
    tok = jwt.encode({"sub": "1", "role": "admin", "exp": 9999999999, "iss": "fos"}, "x" * 48, algorithm="HS256")
    assert_error(client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tok}"}), 401)


def test_security_headers_and_request_id(client):
    r = client.get("/api/v1/health", headers={"X-Request-ID": "abc-123"})
    assert r.headers["X-Request-ID"] == "abc-123"
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert "default-src 'none'" in r.headers["Content-Security-Policy"]
    r2 = client.get("/api/v1/health", headers={"X-Request-ID": "bad id with spaces"})
    assert r2.headers["X-Request-ID"] != "bad id with spaces"


def test_cors_preflight(client):
    r = client.options("/api/v1/projects", headers={"Origin": "http://localhost:5173",
                                                    "Access-Control-Request-Method": "GET"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"
    r = client.options("/api/v1/projects", headers={"Origin": "http://evil.example",
                                                    "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in r.headers


def test_error_shapes(client, auth):
    assert_error(client.get("/api/v1/projects/999999", headers=auth["viewer"]), 404, "NOT_FOUND")
    assert_error(client.get("/api/v1/no-such-route", headers=auth["viewer"]), 404)
    d = assert_error(client.post("/api/v1/projects", headers=auth["admin"], json={"name": "x"}), 422,
                     "VALIDATION_ERROR")
    assert any(i["ref"] == "body.code" and i["severity"] == "error" for i in d["issues"])
    d = assert_error(client.post("/api/v1/auth/login", content=b"{not json", headers={"Content-Type":
                                                                                      "application/json"}), 422)


def test_inactive_user_cannot_login(client, auth):
    r = client.post("/api/v1/admin/users", headers=auth["admin"],
                    json={"email": "temp.user@demo.local", "name": "Temp", "role": "viewer", "password": "Temp@12345"})
    assert r.status_code == 201
    uid_ = r.json()["id"]
    assert client.post("/api/v1/auth/login", json={"email": "temp.user@demo.local", "password": "Temp@12345"}
                       ).status_code == 200
    tok = client.post("/api/v1/auth/login", json={"email": "temp.user@demo.local", "password": "Temp@12345"}
                      ).json()["access_token"]
    assert client.delete(f"/api/v1/admin/users/{uid_}", headers=auth["admin"]).json()["active"] is False
    assert_error(client.post("/api/v1/auth/login", json={"email": "temp.user@demo.local",
                                                         "password": "Temp@12345"}), 401, "INVALID_CREDENTIALS")
    # existing token of a deactivated user is rejected too
    assert_error(client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tok}"}), 401)
