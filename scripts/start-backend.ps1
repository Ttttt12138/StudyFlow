$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$backendPython = if (Test-Path -LiteralPath './studyFlow/Scripts/python.exe') {
    './studyFlow/Scripts/python.exe'
} else { './.venv/Scripts/python.exe' }
& $backendPython manage.py migrate --check
if ($LASTEXITCODE -ne 0) { throw 'Database connection or migrations are not ready. Run manage.py migrate first.' }
& $backendPython manage.py runserver 127.0.0.1:8000 --noreload
