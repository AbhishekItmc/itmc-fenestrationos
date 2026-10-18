# ITMC FenestrationOS — Deployment & Operations

## 1. Local development

Prerequisites: Python 3.12+, PostgreSQL 16, Node 20 (frontend).

```bash
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env            # edit DATABASE_URL etc.
export DATABASE_URL=postgresql+psycopg://fos:fos_dev@localhost:5432/fos
.venv/bin/alembic upgrade head
SEED_DEMO_USERS=1 DEMO_PASSWORD='Demo@12345' .venv/bin/uvicorn app.main:app --reload --port 8000
# optional explicit seed (idempotent):  .venv/bin/python -m app.seed
```

* API docs: http://localhost:8000/api/docs — frontend dev server (`cd frontend && npm run dev`) proxies `/api`.
* Demo logins (only when `SEED_DEMO_USERS=1`): `admin@demo.local`, `engineer@demo.local`,
  `estimator@demo.local`, `viewer@demo.local`, password = `DEMO_PASSWORD`. Demo customers/projects are
  clearly marked “(fictitious)”.
* Without `JWT_SECRET` in dev/test an ephemeral secret is generated (warning logged; tokens die on restart).
* If the built frontend exists at `../frontend/dist`, the API also serves it at `/` (single-process mode;
  disable with `SERVE_FRONTEND=0`).

### Tests

```bash
cd backend
.venv/bin/pytest tests -q                                   # engines + API + integration on SQLite
TEST_DATABASE_URL=postgresql+psycopg://fos:fos_dev@localhost:5432/fos_test \
  .venv/bin/pytest tests/api tests/integration -q           # same API suite on PostgreSQL (drops/creates tables)
```

### Migrations

```bash
.venv/bin/alembic revision --autogenerate -m "describe change"   # review the generated file!
.venv/bin/alembic upgrade head
.venv/bin/alembic check                                            # models == migrations
```
`alembic/env.py` reads `DATABASE_URL` from the app settings; no URL lives in `alembic.ini`.

## 2. Docker compose (db + api + web)

```bash
cp .env.example .env    # set POSTGRES_PASSWORD and JWT_SECRET (python -c "import secrets;print(secrets.token_urlsafe(48))")
docker compose up -d --build
open http://localhost:8080          # nginx: SPA + /api proxy; API docs at /docs
```

* `db`: postgres:16, named volume `pgdata`, `pg_isready` health-check.
* `api`: `backend/Dockerfile` (python:3.12-slim, non-root uid 10001). Entry point runs
  `alembic upgrade head` then uvicorn (1 worker, `--proxy-headers`, no server header). Not published on the
  host; reachable only via nginx.
* `web`: `frontend/Dockerfile` (node build → nginx), `frontend/nginx.conf` proxies `/api/` to `api:8000`.
* Demo data in compose: set `SEED_DEMO_USERS=1` and `DEMO_PASSWORD=...` in `.env` (never in production).
* Validate configuration: `docker compose config`.

## 3. Environment variables (backend)

| Variable | Default | Notes |
|---|---|---|
| `ENV` | `dev` | `dev`/`test`/`prod`. `prod`: `JWT_SECRET` ≥ 32 chars required, HSTS header on |
| `DATABASE_URL` | `postgresql+psycopg://fos:fos_dev@localhost:5432/fos` | `postgres://` URLs are normalised to psycopg 3 |
| `JWT_SECRET` | — | required in prod; random ephemeral in dev/test |
| `JWT_EXPIRE_MIN` | 480 | token lifetime |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | comma list or JSON list |
| `SEED_ON_STARTUP` | 1 | ensure catalogue revision (+ demo users/data when enabled) at start |
| `SEED_DEMO_USERS` | 0 | create the four `@demo.local` users |
| `SEED_DEMO_DATA` | = `SEED_DEMO_USERS` | fictitious customers/projects/elevations/calc run/jobs |
| `DEMO_PASSWORD` | — | required (prod) when demo users seeded; random+logged in dev if missing |
| `LOGIN_MAX_FAILURES_PER_EMAIL` / `_PER_IP` / `LOGIN_WINDOW_S` | 5 / 20 / 300 | in-process login limiter |
| `MAX_UPLOAD_MB` | 5 | Excel import size limit |
| `LOG_LEVEL`, `LOG_JSON` | INFO, 1 | structured JSON logs with `request_id` |
| `SERVE_FRONTEND`, `FRONTEND_DIST` | 1, `../frontend/dist` | single-container SPA serving |
| `FORWARDED_ALLOW_IPS` | 127.0.0.1 | (container) proxies trusted for `X-Forwarded-For` |

## 4. Backups & restore

```bash
# from a host with pg_dump (DATABASE_URL or PG* env), custom format, sha256, 14-day retention
DATABASE_URL=postgresql+psycopg://fos:...@host:5432/fos BACKUP_DIR=/srv/backups scripts/backup.sh
# from the compose db service
COMPOSE=1 scripts/backup.sh
# cron (02:15 UTC daily)
15 2 * * * cd /opt/fos && COMPOSE=1 BACKUP_DIR=/srv/backups scripts/backup.sh >> /var/log/fos-backup.log 2>&1

# restore (asks for confirmation; verifies checksum; single transaction)
COMPOSE=1 scripts/restore.sh /srv/backups/fos_20261017T021500Z.dump
```
Copy backups off-host (object storage with versioning) and test a restore into a scratch database
regularly. The API re-applies newer migrations on start, so restoring an older dump is safe.

## 5. Security checklist

- [ ] `ENV=prod`, strong unique `JWT_SECRET` (≥ 32 random chars), rotated on compromise (invalidates tokens).
- [ ] Strong `POSTGRES_PASSWORD`; DB not exposed outside the compose network / private subnet.
- [ ] `SEED_DEMO_USERS=0` in production; delete/deactivate demo accounts if they were ever created.
- [ ] Terminate TLS in front of nginx (or add a TLS server block); HSTS is emitted by the API in prod.
- [ ] `CORS_ORIGINS` limited to the real frontend origin(s).
- [ ] Run the API with **one worker per container** (login limiter is in-process) or add a shared limiter
      at the proxy; keep `FORWARDED_ALLOW_IPS` restricted to the proxy.
- [ ] Containers run as non-root; images rebuilt regularly for OS/Python patches; `pip-audit`/`npm audit`.
- [ ] Backups scheduled, encrypted at rest, off-host, and restore tested.
- [ ] Audit log (`/admin/audit`) reviewed; logs shipped to central storage (JSON on stdout).
- [ ] Catalogue/rule sets remain flagged DEMO until approved by a domain expert (`approved` and
      `golden_cases_passed`); reports and quotes show the PROVISIONAL banner until then.
- [ ] Upload limit (`MAX_UPLOAD_MB`, nginx `client_max_body_size`) appropriate.

## Vercel (one project, two services)

The repo-root `vercel.json` deploys the whole app as one Vercel project using
[Vercel Services](https://vercel.com/docs/services):

| Service | Root | Public path | Notes |
|---|---|---|---|
| `api` | `backend/` | `/api/*` | FastAPI (`app.main:app`), Python 3.12 (`backend/.python-version`). Receives the original path, so routes stay `/api/v1/...`; Swagger UI at `/api/docs`. |
| `web` | `frontend/` | everything else | Vite static build (`dist/`), SPA fallback to `index.html` for client routes. |

No service bindings: the browser calls the API on the same origin via the public `/api` rewrite; neither
service calls the other server-side.

**Environment variables (Project → Settings → Environment Variables):**

| Variable | Value |
|---|---|
| `DATABASE_URL` | Hosted PostgreSQL, e.g. Neon from the Vercel Marketplace (`postgres://…?sslmode=require` is accepted; the driver prefix is added automatically) |
| `ENV` | `prod` |
| `JWT_SECRET` | random string, ≥ 32 characters |
| `AUTO_MIGRATE` | `1` — runs `alembic upgrade head` at start-up under a PostgreSQL advisory lock (no release step on Vercel). The lock uses `DATABASE_URL_UNPOOLED` (set by the Neon integration) when present, because advisory locks are unsafe through PgBouncer. |
| `SEED_DEMO_USERS` / `DEMO_PASSWORD` | `1` / strong password — demo accounts; turn off once real users exist |

Do not use SQLite on Vercel (the function filesystem is not persistent). On Vercel the DB pool defaults to
2 + 3 overflow per instance (`DB_POOL_SIZE` / `DB_MAX_OVERFLOW` override). The login rate limiter is
per-instance in memory; add a Vercel Firewall rate-limit rule on `/api/v1/auth/login` for production.
Local check: `vercel dev` (runs both services). Docker/compose deployment is unchanged.
