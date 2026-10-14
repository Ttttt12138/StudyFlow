# Current formal English demonstration

[Watch StudyFlow_Demo_EN.mp4](StudyFlow_Demo_EN.mp4) · [English subtitles](StudyFlow_Demo_EN.srt) · [Timed narration](../../docs/demo-video-en.md)

This film replaces the October 12–13 multi-role recordings as StudyFlow's formal demonstration. It shows the current cost-first journey: compare four schools, choose PSU Phuket, reuse declared funds, explain the funding gap, review a simulated loan, confirm the application, complete the checklist, sign, and repay the first installment with password authorization.

The output is a **3 minute 33.52 second**, 1920 × 1080, 30 fps H.264/AAC MP4 with English synthetic narration and burned-in English captions (18,723,011 bytes). The verified duration, file size, SHA-256 and decoding results are in [verification.json](verification.json). The film is shorter than the five-minute submission limit.

## What is real and what is simulated

- The English conversation was recorded from the actual React app, backed by Django HTTP and an isolated PostgreSQL test database. The model calls use the configured external gateway, `openai/gpt-6-luna`, and `planning-1.7`. No prerecorded answers or rule-provider fallback are used in the final take.
- School data are sourced sample estimates. Financial actions, approval, school payouts, wallet top-up and repayment are simulated. The gap-based pre-check is not a bank offer or a household affordability assessment. The document checklist contains declarations rather than verified uploads.
- The 20,000 THB example loan covers part of the 1,003,800 THB gap. Its first amortizing installment is 372.86 THB. A separately recorded 10,000 THB synthetic top-up and an advanced demo date make the repayment possible; these setup actions are disclosed in the narration.
- The refusal to transfer before enrollment is an observed model response in this take. It does not establish a universal server-side enrollment gate for every legacy API.
- The final film contains the English desktop journey. The same run also checks the Chinese phone-width journey; that second journey is not presented as English footage or included in the film.

## Evidence and edit decisions

The selected source is **take-04**. [browser.json](take-04/browser.json) holds journey assertions; [turns.json](take-04/turns.json) holds the exact prompts, responses and tool steps; [model-trace.json](take-04/model-trace.json) records persisted live calls. [submitted-assessment.json](take-04/submitted-assessment.json) records the selected product and confirmed application. [short-desktop-paid-history.png](take-04/short-desktop-paid-history.png) shows the first installment as Paid and the outstanding principal as 19,702.14 THB.

[video-source.json](take-04/video-source.json) identifies the unedited WebM recording in `take-04/raw-video/`. [video-marks.json](take-04/video-marks.json) records editorial cue times. [edit-manifest.json](edit-manifest.json) maps every film chapter to its source time ranges. Only idle waits are shortened; final frames are held where narration needs more time. Financial values, model responses and application screens are not replaced. English titles and explanatory annotations surround the actual recording.

The recorded frontend was copied to a fixed local snapshot to prevent edits in other work from changing the page during recording. [source-manifest.json](take-04/source-manifest.json) records the working-tree code hashes. All 294 matched at the first postrun check. Later unrelated backend edits occurred during video editing; this recording does not validate those later edits. [source-snapshot.zip](take-04/source-snapshot.zip) preserves 291 matching files; three uncommitted backend originals could not be recovered after those edits, as listed in [source-archive-status.json](take-04/source-archive-status.json). The archive is therefore partial. This is a working-tree integration demonstration, not an independently frozen model benchmark. Live-model traces are local instrumentation, not provider-signed receipts.

| Attempt | Outcome | Use |
|---|---|---|
| [take-01](take-01.log) | Both journeys passed in 203.599 s | Initial recording; improved afterward to expose the loan schedule and paid history clearly |
| [take-02](take-02.log) | Failed after confirmation: persisted product was custom rather than the selected commercial sample | Preserved failure; two frontend source files changed during the run. Hot reload was a possible interference, not a proven root cause |
| [take-03](take-03.log) | Vite startup failed before browser/model work because the snapshot dependency junction was missing | Preserved setup failure; junction created before retry |
| [take-04](take-04.log) | Both journeys passed in 209.497 s with the fixed frontend snapshot | Used for the formal film: four English turns / seven live calls; four Chinese turns / eight live calls |

The original October 12–13 recordings remain archived unchanged. They are no longer the formal demo entry point. No development data were reset, and no real funds moved.

## Reproduce

Use the matching source snapshot and the installed frontend dependencies. Keep credentials in the existing server-side environment files. From `backend/`, select a fresh evidence folder:

```powershell
$env:DB_TEST_NAME='test_studyflow_video_20261014'
$env:RUN_PLANNING_LIVE_ACCEPTANCE='1'
$env:SHORT_TEST_PORT='5199'
$env:SHORT_TEST_EVIDENCE='demo-live-20261014/new-take'
$env:SHORT_TEST_RECORD_VIDEO='1'
$env:SHORT_TEST_FRONTEND_ROOT='output/demo-recording-snapshot-20261014/frontend'
$env:CHROMIUM_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
..\studyFlow\Scripts\python.exe manage.py test auto_test.test_short_planning_browser --noinput --keepdb
```

`SHORT_TEST_FRONTEND_ROOT` is optional for normal browser acceptance and should point at a fixed frontend copy when other work is editing the app. It defaults to the workspace frontend. The runner closes its own Vite server and refuses to overwrite an existing live model trace.

From the repository root, prepare titles and narration, synthesize the English WAV files with the installed Windows voice, then encode with a local FFmpeg build supporting libx264 and libass:

```powershell
.\studyFlow\Scripts\python.exe scripts/build_demo_video.py prepare
.\scripts\narrate_demo_video.ps1
.\studyFlow\Scripts\python.exe scripts/build_demo_video.py render --take evidence/demo-live-20261014/take-04 --ffmpeg output/video-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe
```

Narration voice: Microsoft Zira Desktop, synthetic English speech. There is no background music. Generated media tools and intermediate render files stay under the ignored `output/` directory.
