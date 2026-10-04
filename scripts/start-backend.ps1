$ErrorActionPreference = 'Stop'
$backendRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $backendRoot
& '.\.venv\Scripts\python.exe' manage.py migrate --check
if ($LASTEXITCODE -ne 0) { throw 'Database connection or migrations are not ready.' }
& '.\.venv\Scripts\python.exe' manage.py runserver 127.0.0.1:8000 --noreload
