# ITMC FenestrationOS (v0.1 MVP)

Fenestration CAD, engineering, estimation and manufacturing platform — curtain-wall elevation editor, provisional
engineering calculation, 1D profile cutting optimisation, 2D glass/sheet nesting, residual stock, quotations and reports.

> All catalogue data and calculation rules are **DEMO / PROVISIONAL**. See `docs/APPROVALS.md`.

## Quick start (local dev)
Prereqs: Python 3.12+, Node 20+, PostgreSQL 16.
```bash
# database
createuser fos -P   # password fos_dev ;  createdb -O fos fos
# backend
cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt   # Windows: .venv\Scripts\pip
export DATABASE_URL=postgresql+psycopg://fos:fos_dev@localhost:5432/fos SEED_DEMO_USERS=1 DEMO_PASSWORD='Demo@12345'
.venv/bin/alembic upgrade head && .venv/bin/uvicorn app.main:app --port 8000      # API docs: http://localhost:8000/api/docs
# frontend (new terminal)
cd frontend && npm ci && npm run dev                                                # http://localhost:5173
```
Public website at `/` (solutions, pricing, about, contact); the application is at **`/app`** (QR labels keep `/p/{code}`).
Website copy, contact e-mail and plan prices: `frontend/src/site/siteConfig.ts`.

Login: `admin@demo.local` / `Demo@12345` (also engineer@, estimator@, viewer@). Without the backend the UI offers
**Offline demo mode** (browser-only heuristic engine, clearly labelled).

## Docker
```bash
cp .env.example .env   # set POSTGRES_PASSWORD, JWT_SECRET, DEMO_PASSWORD
docker compose up -d --build     # web: http://localhost:8080
```

## Tests
```bash
cd backend && .venv/bin/pytest tests -q                          # 180 passed, 3 skipped (golden cases awaiting expert values)
cd frontend && npm run typecheck && npm run lint && npm test && npm run build   # 181 passed
cd e2e && npm ci && npx playwright test                          # 20 passed (with backend running; server specs skip without it)
```

Docs: `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEPLOYMENT.md`, `docs/REQUIREMENTS_TRACEABILITY.md`, `docs/APPROVALS.md`.
