$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskAssets = Join-Path $taskRoot 'output/demo-video-20261014'
$taskNarration = Get-Content -LiteralPath (Join-Path $taskAssets 'narration.json') -Raw | ConvertFrom-Json
Add-Type -AssemblyName System.Speech
$taskVoice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $taskVoice.SelectVoice('Microsoft Zira Desktop')
    $taskVoice.Rate = 0
    $taskVoice.Volume = 100
    foreach ($taskScene in $taskNarration) {
        $taskWave = Join-Path $taskAssets ($taskScene.id + '.wav')
        $taskVoice.SetOutputToWaveFile($taskWave)
        $taskVoice.Speak($taskScene.text)
        $taskVoice.SetOutputToNull()
        Write-Output ('Narrated: ' + $taskScene.id)
    }
} finally {
    $taskVoice.Dispose()
}
