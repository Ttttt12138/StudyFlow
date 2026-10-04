$ErrorActionPreference = 'Stop'
$backendRoot = Split-Path -Parent $PSScriptRoot
& 'C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe' stop -D (Join-Path $backendRoot '.postgres') -m fast
