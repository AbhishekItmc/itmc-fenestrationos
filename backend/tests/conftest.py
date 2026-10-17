"""Shared fixtures for API/integration tests.

SQLite in-memory by default; set TEST_DATABASE_URL (e.g. postgresql+psycopg://fos:fos_dev@localhost:5432/fos_test)
to run the same suite against PostgreSQL. Engine tests (tests/engines) do not use these fixtures.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import DEMO_PW, lobby_elevation, uid  # noqa: E402

TEST_DB = os.environ.get("TEST_DATABASE_URL", "sqlite+pysqlite:///:memory:")


@pytest.fixture(scope="session")
def settings():
    from app.config import Settings
    return Settings(_env_file=None, env="test", database_url=TEST_DB, jwt_secret="t" * 48, jwt_expire_min=60,
                    seed_demo_users=True, seed_demo_data=True, demo_password=DEMO_PW, log_level="WARNING",
                    serve_frontend=False, cors_origins="http://localhost:5173")


@pytest.fixture(scope="session")
def app(settings):
    from app.db import Base, make_engine
    from app.main import create_app
    import app.models  # noqa: F401
    engine = make_engine(settings.database_url)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    application = create_app(settings, engine)
    yield application
    if not settings.database_url.startswith("sqlite"):
        Base.metadata.drop_all(engine)


@pytest.fixture(scope="session")
def client(app):
    from fastapi.testclient import TestClient
    with TestClient(app) as c:   # runs lifespan -> seed (catalogue, demo users, demo projects)
        yield c


@pytest.fixture(autouse=True)
def _reset_login_limiter(request):
    if "client" in request.fixturenames or "app" in request.fixturenames:
        request.getfixturevalue("app").state.login_limiter.reset()
    yield


def _login(client, email, password=DEMO_PW):
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def auth(client):
    """auth['admin'] etc. -> request headers with a bearer token."""
    return {role: _login(client, f"{role}@demo.local") for role in ("admin", "engineer", "estimator", "viewer")}


@pytest.fixture
def db(app):
    s = app.state.SessionLocal()
    yield s
    s.close()


@pytest.fixture
def project(client, auth):
    """A fresh project with one elevation: returns (project_json, elevation_json)."""
    r = client.post("/api/v1/projects", headers=auth["engineer"], json={"code": uid("P"), "name": "Test project",
                                                                        "status": "design"})
    assert r.status_code == 201, r.text
    p = r.json()
    r = client.post(f"/api/v1/projects/{p['id']}/elevations", headers=auth["engineer"],
                    json={"data": lobby_elevation()})
    assert r.status_code == 201, r.text
    return p, r.json()
