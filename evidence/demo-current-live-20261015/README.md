# StudyFlow — Current Formal English Demo

[Watch the formal video](StudyFlow_Demo_EN.mp4) · [English subtitles](StudyFlow_Demo_EN.srt) · [Verification](verification.json)

Runtime: **04:28** (268.133 seconds), 1920 × 1080, 30 fps. **54 feature shots, all from take-08**, in 8 connected narration paragraphs. Microsoft `en-US-AvaNeural`, synthesis `-10%`, local tempo `1.20`; key amount sentences use `1.12`. Updated on 17 October 2026. The existing single video entry is retained; earlier films remain in Git history.

## Current acceptance and provenance

The film uses **take-08**, recorded on **2026-10-17** against the working tree based on commit `641432a84969c8fbfd27ee5ff93eb6bdeedac39e`. Its frozen source archive and file hashes identify the actual recorded version. [Delivery source check](delivery-source-check.json) verified all **990** snapshot files against the current working tree. Later tracked additions in the application/tooling directories are two evaluation scripts; runtime source is unchanged. This media update does not change business APIs or runtime code.

**19 completed live-AI user turns**, **13 passed scenario checks**, **82 audit events exported in full**. Call modes: `{"deterministic": 10, "live": 48, "system": 1}`; **57 provider attempts**. Every conversational request invoked the external model; deterministic server replies are counted separately. No rule or mock fallback occurred. Model: `openai/gpt-6-luna`; prompt `planning-2.6`. These figures were read from take-08, not copied from the previous film. This is a live browser acceptance run, not a frozen model benchmark or comprehensive security audit.

[Complete audit log](take-08/financial-audit.json) · [Uncut role recordings](take-08/raw/) · [Conversation and tool results](take-08/turns.json) · [Model trace](take-08/model-trace.json) · [Scenario assertions](take-08/coverage.json) · [Frozen source](take-08/accepted-source.zip) · [Post-run source check](take-08/source-check.json) · [Evidence hashes](take-08-provenance.json)

All wallets, loans, university notices, payments and approvals are simulated in a disposable PostgreSQL test database. FX is fixture-based; school costs are sourced sample data and estimates. The student, payee verifier and approver are separate synthetic accounts. Actual UI interactions and server persistence are exercised; approval simulation is disabled so the separate staff account decides. Setup includes a CNY 30,000 simulated top-up, a synthetic housing payee and a THB 10,000 repayment top-up. These setup API calls are not described as AI actions.

**Previously recorded regression on this runtime (17 Oct 2026):** Django 632 tests (2 opt-in live recordings skipped), C package 481, frontend 81 unit and 54 mocked browser tests ([logs](regression-20261017/)). These suites were not rerun for this media-only update. The [10 earlier financial regression tests](financial-regression.txt) exercise wallet-bill and operations permissions. Their authenticated duplicate-payment case verifies the loan-covered bill guard; the uncredentialed duplicate call in the live harness establishes step-up denial only.

## Complete feature coverage

The 54 shots retain costs and sources; four-school and THB/CNY/USD comparison; missing-data disclosure; school selection; borrowing amount, alternative loans, monthly-payment/interest tradeoffs and study-period payments; manual loan controls; pause/resume and stale-quote rejection; explicit application, simulated notice, documents and signing; school-directed payouts; reminders with completion and undo; split tuition and password-authorized wallet payment; exchange, wrong-password denial, remittance and delivery; loan repayment; over-limit rejection, payee verification, separation of duties, independent approval and final student submission.

The exchange record debits **CNY 500.00** and credits **THB 2,290.81 after fees** (`wallet.conversion_settled`, quote `a9ec5804-548b-4dc3-a046-0e8ba59b3c70`). The proposal displays a CNY 0.75 fee and the net THB amount. The assistant's proposal text also repeats the economy route's quoted arrival (by 22 October); a wallet conversion itself settles when the student confirms, as the ledger entry dated 17 October shows. Shot 36 retains the wrong-password rejection; shot 37 shows the confirmed conversion. Approval does not move money: separate staff review is followed by the student's password authorization and confirmed transfer.

## Narration and editing

All eight original paragraph MP3s and original provider TTS JSON files are retained byte-for-byte. Only this approved sentence was sent to Microsoft's authorized speech service for the update:

> After password confirmation, five hundred yuan is debited, and the quoted amount in Thai baht is credited after fees.

The sentence uses the same Ava voice and `-10%` synthesis rate, then local tempo `1.12`. It replaces shot 37 inside chapter 6 at quiet pauses. The replacement gain is matched locally. Original decoded PCM before and after the replaced sentence is identical; all seven other mastered paragraph WAV hashes are also unchanged. New composite word timing is stored separately from original provider metadata. [Audio preservation and splice record](audio-preservation.json) documents sample positions, hashes, gain and both joins.

The edit uses actual take-08 raw video frames, trims waiting and holds stable recorded views. Seven review/action ranges retain their click and result; short ranges are locally sped up where needed to fit the sentence and hold the result. No product screens or model responses are fabricated. The brief final student password modal is held from **521.800 seconds** of take-08's student recording, followed by its confirmed result. This location and action-range adjustments are stored under take-08 in `source-cuts.json` inside the production archive, rather than a cross-take fixed timestamp in the editor.

## Verification

Full decoding passed with **0 errors**. The film contains **8044 frames** at 30 fps and is below 300 seconds. Audio/video endpoint difference: **0.005333 seconds**, below one frame. Maximum measured narration placement difference: **0.000 seconds**. Integrated loudness: **-16.36 LUFS**; true peak: **-1.36 dBFS**; no clipped PCM samples.

All 91 caption groups match the new script, do not overlap and remain within their corresponding shot. All 54 starting frames, 47 stable endings and seven action endings were checked; every shot's header and side panel were checked. All five contact sheets and selected full-resolution frames were visually reviewed, including the fee-adjusted quote, wrong-password denial, approval roles, final masked-password modal and confirmed result. [Visual review](visual-review.json) · [Start-frame checks](start-frame-check.json) · [Layout checks](matte-check.json)

[Offline speech check](speech-check.json) covers all eight mastered paragraphs and recovers all spoken amounts. An [independent offline check of the new sentence and both joins](replacement-speech-check.json) uses the local Whisper model. Its unprompted result renders "Thai baht" as "Tybot" while recovering the amount and debit/credit meaning; a second pass given only the currency vocabulary recovers "Thai baht" and all four checked phrases. Both results are retained. These are automated recognition checks, not a human listening score. Provider word timing is mapped through actual local tempo regions; waveform comparison verifies encoding placement rather than independent phonetic timing. No audio, recordings, screenshots or credentials were uploaded for these checks.

[Edit manifest](edit-manifest.json) · [Source-frame alignment](source-alignment.json) · [Production archive](production-assets.zip) · [Production hashes](production-manifest.json) · [English narration and shot list](../../docs/demo-video-en.md)

## Reproduction

Extract `production-assets.zip` into `output/formal-film-take08/`. From the repository root, use `studyFlow/Scripts/python.exe -B -X utf8` to run `output/formal-film-take08/produce.py prepare --take evidence/demo-current-live-20261015/take-08`, then `produce.py render`, `verify.py` and `qa_frames.py` from that same directory. Review the regenerated contact sheets and action endings before publishing. The archive includes the original MP3s/provider metadata, replacement MP3/provider metadata, patch/composite timing, source cuts, production code and focused splice tests. Reproduction needs no external speech call. `synthesize_replacement.py` is the isolated optional command for the already-authorized one-sentence request, not part of normal reproduction.

To record a genuinely new live run, use `studyFlow/Scripts/python.exe -B -X utf8 scripts/run_formal_demo.py <new-take>`; that separate operation needs live-model credentials and PostgreSQL and creates a disposable database. This delivery reuses the already accepted take-08 recording.

No Chinese review copy is included or uploaded. Original take-08 recordings, accepted source and complete audit logs are unchanged.

SHA-256: `6e7f14380a4c6d0a7d75a6bc524653180a76796dcad38f690808bf83de3b1be3`
