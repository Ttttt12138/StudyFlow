param([ValidateSet('frontend','gates','demos','integration','reference','targeted','compose','restart','regression')][string]$Stage)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$out = Join-Path $repo 'evidence/verification-20261011'
$env:DB_HOST='127.0.0.1'
$env:DB_PORT='55438'
$env:DB_NAME='studyflow'
$env:DB_USER='studyflow'
$env:DB_PASSWORD='local-simulation-only'
$env:DB_TEST_NAME='test_verification_20261011'
$env:DJANGO_SECRET_KEY='verification-local-only'
$env:STUDYFLOW_MODE='mock'
$env:STUDYFLOW_FX_LIVE='false'
$env:STUDYFLOW_READINESS_ENABLED='true'
$env:STUDYFLOW_CONSUMPTION_ENABLED='true'
$env:STUDYFLOW_DB_PORT='55438'
$env:STUDYFLOW_API_PORT='8018'
$env:STUDYFLOW_WEB_PORT='8088'
$env:TEST_URL='http://127.0.0.1:8088'
$env:PYTHON=Join-Path $repo 'studyFlow/Scripts/python.exe'
$env:CHROMIUM_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:PYTHONIOENCODING='utf-8'
function Run-Check([string]$Name,[string]$Directory,[string]$Exe,[string[]]$Arguments) {
    Push-Location $Directory
    try {
        $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
        $log=Join-Path $out "$Name-$stamp.log"
        & $Exe @Arguments *> $log
        $code=$LASTEXITCODE
        @{name=$Name;command=@($Exe)+$Arguments;exit_code=$code;time=(Get-Date).ToUniversalTime().ToString('o');log=(Split-Path $log -Leaf)} | ConvertTo-Json -Compress | Add-Content (Join-Path $out 'commands.jsonl')
        Get-Content $log -Tail 12
        if ($code -ne 0) { throw "$Name failed: exit $code; $log" }
    } finally { Pop-Location }
}
switch ($Stage) {
    'targeted' {
        Run-Check 'targeted' "$repo/studyflow-ai" $env:PYTHON @('-m','pytest','auto_test/test_verification_rules.py','auto_test/test_ingestion.py','auto_test/test_copilot_evaluation.py','-q','--tb=short','-p','no:cacheprovider',"--basetemp=$repo/output/verification-targeted")
        Run-Check 'ruff' "$repo/studyflow-ai" $env:PYTHON @('-m','ruff','check','--no-cache','src','auto_test','scripts')
    }
    'frontend' {
        Run-Check 'frontend-types' "$repo/frontend" 'npm.cmd' @('run','typecheck')
        Run-Check 'frontend-build' "$repo/frontend" 'npm.cmd' @('run','build')
        Run-Check 'frontend-unit' "$repo/frontend" 'npm.cmd' @('run','test:unit')
        Run-Check 'frontend-mocked' "$repo/frontend" 'npm.cmd' @('run','test:e2e')
    }
    'gates' { Run-Check 'gates' $repo $env:PYTHON @('scripts/run_gates.py') }
    'demos' { Run-Check 'demos' $repo $env:PYTHON @('scripts/run_gates.py','--only','demo-readiness','demo-consumption','demo-copilot','demo-remittance','demo-agent','eval-agent') }
    'integration' { Run-Check 'frontend-integration' "$repo/frontend" 'npm.cmd' @('run','test:integration') }
    'reference' { Run-Check 'reference' "$repo/frontend" 'npm.cmd' @('run','test:integration','--','integration/reference') }
    'compose' { Run-Check 'compose-build' $repo 'docker' @('compose','-p','studyflow-verification-20261011','up','-d','--build','--wait') }
    'restart' { Run-Check 'docker-restart' $repo $env:PYTHON @('scripts/verify_compose_persistence.py') }
    'regression' {
        foreach ($set in @('copilot-v1','copilot-holdout-v2','copilot-holdout-v3')) {
            $split=if ($set -eq 'copilot-v1') { 'dev' } else { 'test' }
            $reportStamp=Get-Date -Format 'yyyyMMdd-HHmmss'
            Run-Check "regression-$set" "$repo/backend" $env:PYTHON @('manage.py','evaluate_copilot','--mode','mock','--split',$split,'--arm','rules','--evaluation-kind','regression','--dataset',"$repo/studyflow-ai/evals/$set/cases.jsonl",'--output',"$out/regression-$set-$reportStamp.json")
        }
    }
}
