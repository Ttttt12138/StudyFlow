# StudyFlow — Current Formal English Demo

[Watch the formal video](StudyFlow_Demo_EN.mp4) · [English subtitles](StudyFlow_Demo_EN.srt) · [Verification](verification.json)

Runtime: **04:25** (264.867 seconds), 1920 × 1080, 30 fps. 54 feature shots in 8 connected narration paragraphs. Microsoft `en-US-AvaNeural`, synthesis `-10%`, local tempo `1.20`; key amount sentences use `1.12`. The user authorized sending the English narration to Microsoft. No Chinese review copy is included.

## Current acceptance

The film uses **take-07**, recorded on 2026-10-15 against the working tree based on commit `88665b79c1f159e56a8e0509547c12183221d00a`. The frozen source archive, per-file hashes and post-run hash check identify the actual version, including the recorded fixes. This is a live browser acceptance run and production replay, not a new frozen model benchmark.

**19 user turns**, **13 checked scenarios**. Call modes: `{"deterministic": 10, "live": 48, "system": 1}`. Every conversational request invoked the external model; deterministic server replies are counted separately. No rule or mock fallback occurred in the accepted take. Model: `openai/gpt-6-luna`; prompt `planning-2.6`.

**The submitted code is not the recorded code.** [Delivery source check](delivery-source-check.json) compares the take-07 snapshot with commit `3a969fb` (later commits change documentation, evidence and two evaluation scripts only; no runtime file): 54 runtime files changed and 1 runtime file was removed after recording, plus test and tooling changes. It lists every file with both hashes and the commit behind it. The changes are the server-side wallet-tool lock, removal of retired-feature leftovers, error-message translations, English as the default interface language and source attribution for four catalog titles; none changes an amount, fee, rate or step shown in the film. The film shows the recorded version, which [`take-07/accepted-source.zip`](take-07/accepted-source.zip) preserves.

**Regression on the submitted code (17 Oct 2026).** [take-08](take-08/) re-ran the same 19-turn, 13-scenario journey with the live model on the submitted runtime code: all 13 checks passed, call modes `{"deterministic": 10, "live": 48, "system": 1}`, no rule fallback, and its post-run hash check found no change. Take-08 passed on its first attempt and is kept as evidence only; it was not edited into the film. The full suites also pass on that code: Django 632 tests (2 opt-in live recordings skipped), C package 481, frontend 81 unit and 54 mocked browser tests ([logs](regression-20261017/)).

All wallets, loans, university notices, payments and approvals are simulated in a disposable PostgreSQL test database. FX is fixture-based; school costs are sourced sample data and estimates. The student, payee verifier and approver are separate synthetic accounts. Actual UI interactions and server persistence are exercised; approval simulation is disabled so the separate staff account decides. Setup includes a CNY 30,000 simulated top-up, a synthetic housing payee and a THB 10,000 repayment top-up. These setup API calls are recorded in the harness, not described as AI actions.

Take-07 (film): [Uncut role recordings](take-07/raw/) · [Conversation and tool results](take-07/turns.json) · [Full model trace](take-07/model-trace.json) · [Scenario assertions](take-07/coverage.json) · [Frozen source](take-07/accepted-source.zip) · [Source hash check](take-07/source-check.json)

Take-08 (17 Oct re-run, submitted code): [Complete audit log](take-08/financial-audit.json) · [Uncut role recordings](take-08/raw/) · [Conversation and tool results](take-08/turns.json) · [Full model trace](take-08/model-trace.json) · [Scenario assertions](take-08/coverage.json) · [Frozen source](take-08/accepted-source.zip) · [Source hash check](take-08/source-check.json)

## Coverage

The current path covers costs and sources; four-school and THB/CNY/USD comparison; missing-data disclosure; school selection; borrowing amount, alternative loans, monthly-payment/interest tradeoffs and study-period payments; manual loan controls; pause/resume and stale-quote rejection; explicit application, simulated notice, documents and signing; school-directed payouts; reminders with completion and undo; split tuition and password-authorized wallet payment; exchange, wrong-password denial, remittance and delivery; loan repayment; over-limit rejection, payee verification, separation of duties, independent approval and final student submission.

For the film only the successful take is kept. Six earlier attempts on the same day stopped on recorder selectors or on two prompt issues (default loan inputs treated as explicit preferences, and an unnecessary catalog listing before a named-school comparison); both prompt issues were fixed before take-07, and malformed JSON-tail replies are now retried instead of shown.

In [`coverage.json`](take-07/coverage.json) the loan rows copy the saved plan inputs, whose `annual_rate` field is the custom-loan default (0.06). The commercial study loan example is priced at its fixed 4.5%, as the turns, cards and signed schedule show. The harness now records the priced rate.

After recording, the server was changed to refuse wallet, exchange and remittance tools in a planning conversation until the loan application is submitted (previously only the prompt said so). The film uses those tools only after submission, so the recorded flow is unaffected; the frozen snapshot shows the recorded version. Later changes after recording: the interface now defaults to English, and four catalog source titles gained licence or publisher attribution (no fee or figure changed).

Simulated-account operation logs: **take-07's [`financial-audit.json`](take-07/financial-audit.json) is not a complete audit log.** It holds the newest 50 of the 82 audit events (15:52 onward: reminders, exchange, remittance, approval, tuition and repayment); the recorder saved only the first API page, and that disposable test database no longer exists. Its earlier steps are covered by [`turns.json`](take-07/turns.json) (every agent tool call and result), [`loan-after-signing.json`](take-07/loan-after-signing.json), [`loan-after-repayment.json`](take-07/loan-after-repayment.json), [`approval-records.json`](take-07/approval-records.json) and the uncut recordings. **The complete log is [`take-08/financial-audit.json`](take-08/financial-audit.json): all 82 events of the 17 October re-run on the submitted code, every page exported (`next` is null).**

The [10 financial regression tests](financial-regression.txt) additionally exercise wallet-bill and operations permissions against a separate test database. Their authenticated duplicate-payment case verifies the loan-covered bill guard. The uncredentialed duplicate call in the live browser harness only establishes step-up denial; it is not evidence of that deeper guard by itself.

## Editing and verification

The formal edit removes waiting and uses actual recorded frames. Review shots retain the recorded click and resulting state where practical; stable frames may be held for the narration. No fabricated product screens or substituted AI responses are used. The uncut role recordings preserve the full operations.

The final student authorization was brief in the automated recording. Its actual masked-password frame at 536.800 seconds of the student recording is held while that step is narrated; the following shot shows the recorded confirmed result. This frame is extracted from the accepted raw video.

Full decoding passed. Audio/video endpoint difference: 0.008000 s. Maximum measured narration placement difference: 0.000 s. Every caption matches the narration text and stays inside its corresponding shot. Provider word timing is mapped through local tempo changes; waveform checks verify encoding placement, not independent phonetic alignment. Contact sheets and selected full-resolution frames were reviewed.

The [offline speech check](speech-check.json) recovered all spoken amounts. Recognition differences are not a human listening score; no audio was uploaded for this local check.

[Edit manifest](edit-manifest.json) · [Source-frame alignment](source-alignment.json) · [Production archive](production-assets.zip) · [Production hashes](production-manifest.json)

Reproduce from the repository root with `studyFlow/Scripts/python.exe -B -X utf8 scripts/run_formal_demo.py <new-take>`. This needs configured live-model credentials and PostgreSQL, and creates its own test database. For media reproduction, extract the production archive into `output/formal-film-production/`, then run `produce.py prepare --take evidence/demo-current-live-20261015/take-07`, `produce.py render`, and `verify.py` using the project interpreter. Speech MP3s and provider word events are included; no new external speech call is needed to reproduce the edit.

Earlier films are in git history.

SHA-256: `e5073650dd35eabaeb3f52c9b8729fe19c19152584e643a7548ab4bbe54ba34a`
