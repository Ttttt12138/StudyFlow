# Task A contract comparison (before integration)

Inspected final backend HEAD e45d5d8 and uploaded ZIP (declared source ee577dc; ZIP has no Git metadata to independently verify the commit). No existing frontend package exists. Adapt connected UI into frontend/; keep Django finance and C workflows authoritative.

| ZIP request/field | Current implementation | Integration decision |
|---|---|---|
| Token header / local token form | config/settings.py supports TokenAuthentication and SessionAuthentication; config/urls.py exposes DRF session login | Replace token entry with existing Django session login, same-origin cookies and CSRF. Add read-only identity/CSRF endpoint; preserve permissions. |
| templates; semester create/detail; state | readiness/api.py envelopes commands/readiness reads in data; SemesterInput uses template key/version, room, reserve, opening_balance, as_of | Compatible; null reserve retained. |
| profile | readiness/contracts.py Profile extends C SemesterProfile | Include country/student_type corrections as well as school/campus/program/dates/semester. |
| draft costs | C CostItem plus B Cost; stable IDs, decimal strings/null, applicability reason, confidence, evidence, source_refs | Preserve fields; top-level reserve only (reserve category prohibited by B Draft). |
| multipart imports, detail, transcribe, confirm | UploadInput/ConfirmationInput; asynchronous jobs; proposed merged draft separate from original extraction | Compatible. Select merged conflict costs even when source_refs absent. Corrected selected costs need explicit resolution even without initial merge conflict. |
| versions | Versions checks state/budget and optional analysis; 409 VersionConflict | Send available analysis_version; preserve unsaved edits on conflict and surface failure to reload. |
| budgets/forecasts/recommendations/funding-plans | data envelope; histories are arrays (last 50), runs carry analysis_version | Compare run semester/state/budget/analysis; local dirty edits must prevent current claim; restore budget history. |
| funding-sources/loans/applications | ResourceView paginated results; owned records | Compatible; follow pagination and surface failures rather than silently using empty histories. |
| source creation | SourceInput economic_key; IdempotencyRecord compares full payload | Generate stable economic_key across retries of same fields. |
| loan quote | loan_engine supplies repayments and schedule; net_proceeds/total_repayment/total_interest | Display B result only; no arithmetic. |
| affordability-profile | ProfileInput expected_version, monthly nullable money fields | Compatible; restore saved profile. |
| application create/action | quote_id; expected_version/action submit; B owns assessment/status | Compatible; preserve simulation labels, no operator decisions or payments. |
| OCR | per-file consent + notice version; service/policy flags | Preserve consent/manual transcription; do not enable paid OCR for integration testing. |

Production: serve frontend build and /api (including /api/auth/login and session route) under one origin; Django handles login/session and CSRF. Development proxy must preserve browser Origin/Host for CSRF rather than rewriting it to port 8000. Session login redirects back to frontend origin. No production token form, browser token storage, financial calculations, or authentication bypass.

Implementation and validation results: [frontend-integration.md](frontend-integration.md). Additional missing controls found during integration: nullable payment status and editable top-level reserve were added; NOT_APPLICABLE reasons and unknown periods remain distinct. Saved plan freshness and application-to-quote selection were corrected.

## Latest team branch reconciliation

The final remote check found newer team commits. The existing checkout was fast-forwarded to remote `feature/bc-integration` HEAD **3be0eb79c7a04e852da74efd337d458ce3862ea1**, preserving Task A edits and resolving the README to retain both teams’ documentation. Contracts were rechecked before the final rerun.

- Added `verified_at` and `planned_overrides` cost metadata is preserved unchanged; locked/verified saved costs are read-only in expense editing. C original evidence is still immutable.
- Readiness routes/serializers, command `data` envelopes, list pagination, stable IDs and state/budget/analysis versions remain compatible. Forecast responses add `reserve`; no local computation substitutes for it.
- `inputs.calculation_context` is extra run metadata and is preserved by the backend; no frontend request includes or modifies it.
- API errors now include stable `detail`, `code`, and localized `message`; 409 status remains authoritative. English UI requests use backend English messages where supplied, retaining raw diagnostics in expandable details.
- New database-backed throttles require `manage.py createcachetable`; this was executed and added to startup/CI instructions. No rate limits or policy checks are disabled.
- Current token issuance is available at `/api/v2/auth/token/`, but existing Django session authentication is supported and was exercised. Money-moving T2/T3 routes are outside this student-journey scope; the frontend never invokes or bypasses their step-up/approval policies.
- Multi-currency/remittance, copilot and agent additions were retained in the latest backend; this Task A integration does not add screens or decisions for unrelated workflows.
