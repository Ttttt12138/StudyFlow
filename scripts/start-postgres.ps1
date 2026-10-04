$ErrorActionPreference = 'Stop'
$backendRoot = Split-Path -Parent $PSScriptRoot
$pgBin = 'C:\Program Files\PostgreSQL\16\bin'
$pgData = Join-Path $backendRoot '.postgres'
if (-not (Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))) {
    throw 'The isolated PostgreSQL cluster is missing. See README for using your own database.'
}
if (Test-NetConnection -ComputerName '127.0.0.1' -Port 55432 -InformationLevel Quiet) {
    Write-Host 'Project PostgreSQL is already accepting connections on localhost:55432.'
    exit 0
}
$pgLog = Join-Path $backendRoot 'postgres-local.log'
& (Join-Path $pgBin 'pg_ctl.exe') start -D $pgData -l $pgLog -o '-p 55432 -h 127.0.0.1'
if ($LASTEXITCODE -ne 0) {
    throw 'PostgreSQL did not start. Review postgres-local.log.'
}
Write-Host 'Project PostgreSQL started on localhost:55432.'
