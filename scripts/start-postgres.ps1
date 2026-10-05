$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
& docker compose up -d --wait db
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop and retry. PostgreSQL uses localhost:55433.' }
