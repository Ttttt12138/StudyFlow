$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
& docker compose stop db
if ($LASTEXITCODE -ne 0) { throw 'Could not stop the project PostgreSQL container.' }
