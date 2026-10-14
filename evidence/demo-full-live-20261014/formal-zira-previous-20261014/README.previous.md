# Current formal English demonstration — full updated flow

[Watch the formal MP4](StudyFlow_Demo_EN.mp4) · [English subtitles](StudyFlow_Demo_EN.srt) · [Timed narration](../../docs/demo-video-en.md)

The current interface and requested checklist were recorded again after the October 14 credit-repayment update. The formal film is **4 minutes 50 seconds** (decoded video endpoint 290.021 s), 1920 × 1080 at 30 fps, H.264/AAC, with English synthetic narration and burned-in English captions. It replaces the previous formal video at its [existing entry point](../demo-live-20261014/StudyFlow_Demo_EN.mp4). The previous file is [archived unchanged](../demo-live-20261014/formal-previous-20261014/README.md).

## Acceptance result

**Take-07 passed** in 702.087 seconds. It contains 12 completed live-AI user turns, 43 recorded planner decisions, 51 recorded provider attempts and 16 explicit feature checks. Every model record is live `openai/gpt-6-luna`, prompt `planning-1.9`; no rule-provider fallback is used. The browser reports no JavaScript page errors, including the separate family/operator/verifier contexts.

An enrollment tool call returned `ALREADY_PROPOSED`: advancing the demo date had already created a proposal. The AI recognized the existing proposal, and the student explicitly confirmed it. This was one recorded tool error, not a second enrollment or an automatic enrollment. Format retries are included in the attempt count. This successful integration run does not establish a 100% model success rate or replace a frozen independent benchmark.

| Requested group | Observed result |
|---|---|
| 1. School costs and comparison | Full-course total, tuition/living/essential lines and sources; four-school comparison; THB/CNY/USD display |
| 2. Saved plan and funding gap | Known funds reused; fee override persisted and changed the total; dated forecast/sources shown; override restored |
| 3. Loan options and schedules | Custom/commercial simulated products; 36/60-month choices; 42 study months with interest-only payments versus amortization |
| 4. Application through school payout | Explicit application confirmation, checklist declarations, signing dialog and verified-school-directed payout; no student loan disbursement |
| 5. Family support | Student request, anonymous family promise, operator receipt; promise leaves the wallet unchanged; receipt adds THB 6,500 |
| 6. Preparation and enrollment | Live-AI dated reminder, persisted acknowledgement and completion; date alone leaves the plan un-enrolled; explicit student confirmation enrolls |
| 7. Multicurrency wallet and remittance | Separate balances; live-AI quotes/proposals; CNY 500 conversion and CNY 1,000 transfer debit only after authorization; order and ledger recorded |
| 8. Tuition payment | Shortfall shown, exact demo top-up, verified school payee, password and wallet debit; loan-covered duplicate request rejected with `BILL_ALREADY_PAID` |
| 9. Daily budget and expense | THB 6,000 budget; live-AI lunch entry THB 120 gives THB 5,880 remaining; undo restores THB 6,000 |
| 10. Repayment and internal record | First loan installment THB 372.86 paid; new credit repayment actually debits THB 2,000 after password, restores available line and records `ON_TIME`; signed snapshot verified anonymously and tampering rejected |
| 11. Authorization failures and audit | Wrong password refused; CNY 15,000 transfer blocked without operator approval and then rejected; balances unchanged; sign-in/step-up audit displayed |

[Browser assertions](take-07/browser.json) · [Feature checks](take-07/coverage.json) · [Exact prompts/answers](take-07/turns.json) · [Persisted model trace](take-07/model-trace.json) · [Django run](take-07/django.log)

## Full original recordings

- [Student — complete uninterrupted browser recording](take-07/raw-video/page@ffd872460111afa22eb236169884dbf3.webm)
- [Family confirmation](take-07/raw-family/page@91b98fac324035f0546c3de82ce80aba.webm)
- [Operator receipt](take-07/raw-operator/page@f6b824c31860eccb48049247c65f982a.webm)
- [Anonymous statement verification](take-07/raw-verifier/page@170a65926f24e7de60a2ac2f09d8e694.webm)

The formal film groups the accepted footage into feature chapters, shortens waiting and holds recorded final frames for narration. The raw files retain chronological interactions, including steps too detailed for the five-minute film. Screen values and model answers were not replaced. [Edit manifest](edit-manifest.json) maps every scene to a source recording and time range. The public verification shown was performed against the isolated test database during the run; that database was removed afterward.

## What is live, and what is simulated

The React app used real local Django HTTP and an isolated PostgreSQL database. AI requests went to the configured external gateway. FX pricing used fixtures/reference rates, not live market execution. School costs are sourced sample estimates. All balances, loans, family receipts, payouts, bills and transfers are simulated. The loan pre-check is not a bank offer or an affordability assessment; checklist declarations are not verified document uploads; the internal record is not a credit-bureau score. School verification is a seeded simulation, not a bank or university confirmation.

The script advances the isolated demo date and supplies synthetic wallet funds: THB 10,000 for loan repayment, CNY 30,000 for conversion/transfer demonstrations, a visible exact tuition-shortfall top-up, and THB 2,000 for credit repayment. Family receipt adds a separate THB 6,500. Simulated operator approval is disabled. The over-limit transfer was not approved or submitted. No development database was reset, no real money moved, and no physical-device/mobile/Safari acceptance is claimed by this desktop recording. Legacy CSV/OCR/What-if/refund/reconciliation screens are outside this current student checklist.

## Synchronization and visual checks

- Forty-six short narration lines map to forty-six scenes. English subtitle timing uses actual SAPI word positions with explicit 16 kHz speech output; the default output rate was found to produce inconsistent timestamps and was corrected.
- Original PCM narration is placed on an exact 48 kHz timeline and encoded to AAC once. This removes cumulative per-clip AAC padding. All 46 encoded narration segments match their scheduled PCM reference positions at 1 ms measurement resolution; this measures audio placement, not an independent phonetic alignment score.
- Thirty-six source cues were compared against screenshots and shifted where page loading required it. Every selected comparison had mean pixel difference below 3/255. The remaining core-loan scenes and all final scenes were inspected in four contact sheets; four key scenes were also inspected at full size.
- Full decoding found zero errors. Audio/video endpoint difference is **15.7 ms**. All caption groups stay within their scene duration.

[Media verification](verification.json) · [Narration timestamp check](narration-timing-check.json) · [Source cue alignment](take-07/shot-alignments.json) · [Visual review](visual-review.json) · [Media corrections](media-corrections.json) · [Contact sheets 1](contact-sheet-1.jpg), [2](contact-sheet-2.jpg), [3](contact-sheet-3.jpg), [4](contact-sheet-4.jpg)

## Source and failures retained

The accepted app/test inputs were copied before the run from working-tree baseline `afe4760bebedc875107753c5bea9ca54aed31780` plus the clock/output-format fixes and recording harness. All **1163** files match both the frozen runtime copy and [accepted-source.zip](take-07/accepted-source.zip), checked against [source-manifest.json](take-07/source-manifest.json). Environment secrets and dependencies are excluded. Local traces are instrumentation, not provider-signed receipts.

The [production asset archive](production-assets.zip) separately preserves the final narration WAVs, word timings, captions, title frames and the exact final editing scripts, including media fixes made after the app recording. Its 190 entries were read back and checked against [production-manifest.json](production-manifest.json).

| Attempt | Outcome |
|---|---|
| take-01 | Recording selector did not match the line-item button; retained |
| take-02 | Family currency selector did not match its accessible label; retained |
| take-03 | Forecast return selector did not account for portal navigation; retained |
| take-04 | Actual AI remittance failure: valid real-time quotes were treated as expired against the future demo date; write budget stopped repeated quotes |
| take-05 | Actual AI reminder failure: unstructured gateway prose was accepted as a final answer, with no saved task |
| take-06 | Strict output validation safely failed after three invalid final-reply attempts; explicit JSON examples were then added to the prompt |
| take-07 | All requested feature checks passed; selected for the final film |

The clock fix passed 84 backend tests ([log](clock-fix-backend.log)). The output-format fix also passed 84 backend tests ([log](format-fix-backend.log)) and the final AI planner/rule suite passed 130 tests ([log](format-explicit-ai.log)). [Focused live format probe](format-live-probe-02.json) passed both final-answer and reminder decisions. The first probe remains preserved and requested a valid extra cost-read step where its exploratory assertion had expected a final answer. These regressions do not overwrite the failures above.

## Reproduce

From the repository root, with the project `studyFlow` interpreter, installed frontend dependencies, Chrome and the existing server-side environment files, choose an unused take name:

```powershell
.\studyFlow\Scripts\python.exe -X utf8 scripts/run_full_demo.py freeze take-08
New-Item -ItemType Junction -Path 'output/full-demo-take-08/frontend/node_modules' -Target (Resolve-Path 'frontend/node_modules')
.\studyFlow\Scripts\python.exe -X utf8 scripts/run_full_demo.py run take-08
.\studyFlow\Scripts\python.exe scripts/build_full_demo_video.py prepare
.\scripts\narrate_synced_demo.ps1 -Assets output/demo-full-video-20261014
.\studyFlow\Scripts\python.exe scripts/align_full_demo.py --take evidence/demo-full-live-20261014/take-08 --ffmpeg output/video-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe
.\studyFlow\Scripts\python.exe scripts/build_full_demo_video.py render --take evidence/demo-full-live-20261014/take-08 --ffmpeg output/video-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe
.\studyFlow\Scripts\python.exe scripts/verify_full_demo.py --ffmpeg output/video-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe
```

Run the narration script in PowerShell 7 with installed Microsoft Zira Desktop. The film has no background music. Keep the existing formal artifacts archived before a future render replaces them. This local delivery does not publish the film to an external service.

Final video SHA-256: `33ca32b1e97aa9b5e52995ac0d292b86343d826ade79b6853746e828df9efe17`.
