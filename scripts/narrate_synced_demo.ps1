param([Parameter(Mandatory=$true)][string]$Assets)
$ErrorActionPreference = 'Stop'
$taskAssets = (Resolve-Path -LiteralPath $Assets).Path
Add-Type -AssemblyName System.Speech
Add-Type -ReferencedAssemblies System.Speech,System.Collections -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Speech.Synthesis;
public class DemoWord {
    public double seconds;
    public int position;
    public int length;
    public string text;
}
public static class DemoSpeech {
    public static List<DemoWord> Render(string text, string path) {
        var words = new List<DemoWord>();
        using (var voice = new SpeechSynthesizer()) {
            voice.SelectVoice("Microsoft Zira Desktop");
            voice.Rate = 0;
            voice.Volume = 100;
            voice.SpeakProgress += (sender, e) => words.Add(new DemoWord {
                seconds = e.AudioPosition.TotalSeconds, position = e.CharacterPosition,
                length = e.CharacterCount, text = e.Text });
            // This installed Zira voice reports progress on a 16 kHz clock.
            voice.SetOutputToWaveFile(path, new System.Speech.AudioFormat.SpeechAudioFormatInfo(
                16000, System.Speech.AudioFormat.AudioBitsPerSample.Sixteen,
                System.Speech.AudioFormat.AudioChannel.Mono));
            voice.Speak(text);
        }
        return words;
    }
}
'@
$taskNarration = Get-Content -LiteralPath (Join-Path $taskAssets 'narration.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($taskScene in $taskNarration) {
    $taskWav = Join-Path $taskAssets ($taskScene.id + '.wav')
    $taskWords = [DemoSpeech]::Render($taskScene.text, $taskWav)
    $taskWords | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $taskAssets ($taskScene.id + '.words.json')) -Encoding UTF8
    Write-Output ('Narrated with word timestamps: ' + $taskScene.id)
}
