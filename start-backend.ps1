# ITMC FenestrationOS - start API (Windows PowerShell). Uses a local SQLite file; no PostgreSQL needed for demo.
$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot\backend"
if (-not (Test-Path ".venv\.installed")) {
    python -m venv .venv
    .\.venv\Scripts\python.exe -m pip install --upgrade pip
    .\.venv\Scripts\pip.exe install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
    New-Item ".venv\.installed" -ItemType File | Out-Null
}
if (-not $env:DATABASE_URL) { $env:DATABASE_URL = "sqlite:///./fos_demo.db" }
$env:SEED_DEMO_USERS = "1"
if (-not $env:DEMO_PASSWORD) { $env:DEMO_PASSWORD = "Demo@12345" }
.\.venv\Scripts\alembic.exe upgrade head
.\.venv\Scripts\uvicorn.exe app.main:app --port 8000
