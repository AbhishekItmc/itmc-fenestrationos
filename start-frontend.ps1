# ITMC FenestrationOS - start web UI (Windows PowerShell). Opens on http://localhost:5173
$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot\frontend"
if (-not (Test-Path "node_modules")) { npm ci }
npm run dev
