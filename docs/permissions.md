# Permission Tiers, Limits and Production Hardening

StudyFlow sorts endpoints into four tiers, T0–T3, by action risk, plus operator (OP) actions. Actions that move money require step-up re-authentication, and anything above the per-currency limits requires approval by an operator (separation of duties). All money operations are simulated, but the permission controls are really enforced.

## 1. Tiers

| Tier | Scope | Requirement |
|---|---|---|
| T0 | Read-only: all GETs | Signed in; can read only own data (operators can read the approval queue) |
| T1 | Writes that do not move money out of the wallet: quotes, plans, drafts, notifications read, approval requests; also budgets, scenarios, what-if and sponsor requests (retired from the product on 2026-10-15; backend only) | Signed-in owner |
| T2 | Money leaves the wallet (within limits): see the table below | T1 + a valid step-up token |
| T3 | A T2 action above the per-transaction, daily or monthly limit, or in a currency with no limit configured | T2 + an approved, unused approval |
| OP | Operator actions: funds received, loan decision and disbursement, beneficiary verification, payment callbacks, approval decisions; sponsor link issuance (retired from the product on 2026-10-15; backend only) | `is_staff`; separation-of-duties rules apply |

Calls initiated by the agent (W4) are capped at T1; T2 and above can only create pending actions that the user confirms personally.

### T2 action catalog

| Action `action` | Route | Target `target_id` | Amount and currency |
|---|---|---|---|
| `payment.submit` | `POST payments/{id}/submit/` | Payment id | Payment amount, home currency |
| `wallet.convert` | `POST conversions/` | Quote id (`quote_id`) | `source_amount`, quote source currency |
| `loan.repay` | `POST loan-accounts/{id}/repay/` | Loan account id | Amount due for installment `installment_number`, home currency |
| `remittance.submit` | W3 remittance order submission | Order id | Send amount and currency |
| `bill.pay` | `POST planning/bills/{id}/pay-from-wallet/` | Plan bill id | Bill amount and currency |

`credit.repay` (`POST planning/credit/charges/{id}/repay/`) was removed from the action catalog together with the independent credit page (retired from the product on 2026-10-15).

New T2 actions must be registered in the action catalog in `backend/finance/policy.py` (`ACTIONS`: target model, subject resolution, request validation) and declared on the route (`command(..., policy="payment.submit")`, `resource(..., "wallet.convert")`). `remittance.submit` is declared on the submit route in `backend/finance/remittance_api.py`; the confirm route for agent proposals declares `agent.confirm` and is checked as the underlying action it stands for.

Calls that do not move money out of the wallet skip the policy check and go straight to business rules: re-submitting an already submitted payment (returned unchanged), repaying a settled installment, a target that does not exist or is not the caller's (the business layer returns 404/400). Agent-initiated calls must carry the header `X-StudyFlow-Agent`; T2 routes always answer them with `AGENT_TIER_EXCEEDED`.

## 2. Limits

Limits apply to "outflows" and sum all T2 actions per currency; calendar days and months are computed in `Asia/Bangkok` (real time, not the demo clock).

| Currency | Per transaction | Daily | Monthly |
|---|---|---|---|
| THB | 50,000 | 100,000 | 300,000 |
| CNY | 10,000 | 20,000 | 60,000 |
| USD | 1,500 | 3,000 | 9,000 |
| EUR | 1,400 | 2,800 | 8,400 |
| GBP | 1,200 | 2,400 | 7,200 |
| JPY | 200,000 | 400,000 | 1,200,000 |

- Defaults live in code and are stored in the global table `PolicyLimit(action="outflow", currency, per_transaction, daily, monthly, enabled)`, adjustable by an administrator; `ensure_default_limits()` only fills missing rows and never overwrites existing values.
- Used amount = payments submitted in the window (`Payment.submitted_at` in the window and status not failed/cancelled) + negative ledger entries created in the window that do not come from payments (conversion debits, repayments, remittance debits).
- If a currency has no enabled limit row, every T2 action in that currency is treated as T3.
- Effective limit = table limit × `finance.credit.limit_multiplier(owner)` (set by the on-time record level, default 1; see [Credit building](credit.md)). The credit page is retired from the product, but this on-time-record multiplier is still live (`limits_for` in `backend/finance/policy.py`).
- Students can read, per currency, their base limit, effective limit and daily/monthly usage from `GET /api/v2/policy/limits/` (T0); the frontend "Permissions and audit" page displays it. The policy check at command time is always the server's live calculation (see [API reference](api/reference.md#get-apiv2policylimits)).

## 3. Step-up re-authentication

`POST /api/v2/auth/step-up/` (signed in, throttle `step_up`):
```json
{"password": "...", "action": "payment.submit", "target_id": "<uuid>", "amount": "9000.00", "currency": "THB"}
```
On success it returns 200 `{"token", "expires_in_seconds": 300, "action", "target_id", "amount", "currency"}`. The token is signed with `django.core.signing` (salt `studyflow-step-up-v1`); its payload contains only the random nonce of a single-use `StepUpGrant`, the user id and the user's session auth hash (a password change invalidates the token immediately); the action, target, amount and currency are stored on the `StepUpGrant`, valid for 5 minutes. A wrong password returns 403 `STEP_UP_FAILED` and is audited (`auth.step_up_failed`); users without a usable password cannot complete step-up. A successful grant is audited as `auth.step_up_granted` (without the token).

The request only checks that the target belongs to the caller and that the currency and amount match the target (payments use the payment amount; repayments must equal the amount of an unpaid installment on that account; conversions use the quote source currency, and the amount is only checked against currency precision). It does not check the target's status, which the business rules decide at execution time. A missing or foreign target returns 404; a mismatch returns 400 `POLICY_SUBJECT_MISMATCH`.

Protected commands carry the token in the header `X-Step-Up-Token`. The token must match the request's action, target, amount and currency exactly. It is marked used in the same transaction as the successful command; reuse returns `STEP_UP_INVALID`. If the command fails on a business rule (transaction rolled back), the token is not consumed and can be retried within its lifetime. Idempotent replays of the same target are not re-checked.

## 4. Approvals (T3)

- `POST /api/v2/approvals/` (student, T1): `{"action", "target_id", "amount", "currency", "reason"}`; `reason` is optional (may be empty). Validation is the same as for step-up requests (target belongs to the caller, amount and currency match the target). Creates `PENDING` and returns 201 `{"data": {...}}`. Only one `PENDING` or `APPROVED` approval may exist per `(owner, action, target_id)` at a time; otherwise 409 `APPROVAL_ALREADY_OPEN`.
- `POST /api/v2/approvals/{id}/decide/` (OP): `{"decision": "approve"|"reject", "note", "expected_version"}`, returns 200 `{"data": {...}}`. Non-operators get 403; a version mismatch gets 409; an approval that is not `PENDING` (including expired) gets 409 `APPROVAL_NOT_PENDING`.
- `POST /api/v2/approvals/{id}/simulate/` (student, demo only): once the caller's own `PENDING` approval is `STUDYFLOW_SIMULATED_APPROVAL_SECONDS` old (defaults to 10 seconds in development with `DJANGO_DEBUG=True`, and to 0, i.e. off, elsewhere; off by default in the compose deployment), the built-in simulated operator account `studyflow-simulated-operator` (operator identity, cannot sign in) approves it, audited as `approval.approved` with `simulated: true`. Too early returns 409 `APPROVAL_STILL_IN_REVIEW`; not `PENDING` returns 409 `APPROVAL_NOT_PENDING`; when set to 0 it is off and returns 403 `APPROVAL_SIMULATION_OFF`. After approval the student still has to step up with their password to execute. Approvals carry `simulated_after_seconds` (0 when off). When it is 0 the frontend shows no countdown and simply waits for an operator; otherwise, after submission the frontend approval panel shows "An operator may contact you to confirm details" and a 10-second countdown, calls this endpoint automatically when the countdown ends, and then moves to password confirmation.
- Approvals expire 24 hours after creation, for both `PENDING` and `APPROVED`; expired approvals are marked `EXPIRED` when read, requested or decided, after which a new one can be requested.
- Executing a T3 action requires, in addition to the step-up token, an `APPROVED`, unexpired approval matching `(action, target_id, amount, currency)`; after the action succeeds it is marked `USED` in the same transaction (version incremented). Actions executed only as T2 do not consume approvals.
- `GET approvals/` (paginated, filterable by `?status=`), `GET approvals/{id}/`: students see their own, operators see all; records include `owner`, `requested_by`, `decided_by`.

### Separation-of-duties rules

1. The approver cannot be the requester (database CHECK constraint; the API layer returns 403 `SEPARATION_OF_DUTIES` first).
2. Payment and remittance approvals (`payment.submit`, and `remittance.submit` to an external recipient): the approver cannot be the operator who most recently verified that beneficiary (determined from the `actor_id` of the audit event `beneficiary.mock_verification`; `SEPARATION_OF_DUTIES`).
3. Operators cannot approve approvals they own (`SEPARATION_OF_DUTIES`).

All three rules apply to both approve and reject. Demos and tests therefore need at least two operators: one verifies beneficiaries and another approves.

## 5. Denial responses

A policy denial returns 403:
```json
{"detail": "STEP_UP_REQUIRED", "policy": {"action": "payment.submit", "tier": "T2",
  "target_id": "...", "amount": "9000.00", "currency": "THB",
  "limits": {"per_transaction": "50000.00", "daily": "100000.00", "monthly": "300000.00"},
  "usage": {"daily": "0.00", "monthly": "0.00"}, "requires": ["step_up"]}}
```
Following the [i18n](i18n.md) convention, the response also contains `code` (same as `detail`) and a localized `message`. `detail` values: `STEP_UP_REQUIRED`, `STEP_UP_INVALID` (token expired, forged, used, or not matching the request), `APPROVAL_REQUIRED` (T3, `requires` contains `approval`), `AGENT_TIER_EXCEEDED`. `limits` is the effective limit after the credit multiplier, or `null` when the currency has no enabled limit; `usage` excludes the current amount.

Check order: agent call → invalid token supplied → T3 missing approval → no token supplied. A T3 action obtains its approval before requesting the 5-minute token, so a missing approval returns `APPROVAL_REQUIRED` first.

When `STUDYFLOW_READINESS_ENABLED` is on, a denial produces an explanation trace (`X-StudyFlow-Trace-ID`, policy layer). Idempotent replays (same key, same body) return the stored result directly without re-checking policy.

## 6. Throttling

| Scope | Default | Applies to |
|---|---|---|
| `user` | 1000/hour | All signed-in requests (global, per user) |
| `anon` | 100/hour | All anonymous requests (global, per IP) |
| `auth` | 10/min | `POST auth/token/` (per IP) |
| `step_up` | 10/hour | `POST auth/step-up/` (per user, successes and failures both count) |
| `money` | 60/hour | POSTs to all T2 routes (per user, including denied requests) |
| `sponsor` | 20/hour | Sponsor confirmation GET/POST (anonymous, per IP; sponsor flow retired from the product on 2026-10-15; backend only) |
| `agent` | 30/hour | `POST agent/sessions/` (per user; see [Agent](agent.md)) |

Exceeding a rate returns 429 with `Retry-After`. `/health/` is not throttled. Per-IP counting uses the connection address by default and does not trust a client-supplied `X-Forwarded-For`; behind a reverse proxy, set `DJANGO_NUM_PROXIES` to the number of trusted proxy hops (DRF `NUM_PROXIES`). Rates can be overridden with `STUDYFLOW_THROTTLE_<SCOPE>` (e.g. `STUDYFLOW_THROTTLE_STEP_UP=5/hour`); a malformed value fails startup. Throttle counters live in a shared database cache (`DatabaseCache`, table `studyflow_cache`, created with `manage.py createcachetable`), so they also hold under multi-process deployments.

Demo commands run months of activity in seconds: each run uses its own counter prefix, `demo_bc` temporarily raises `step_up` to 30/hour (12 repayments each need a step-up), and the actual rates are written to the report's `throttling` field. In tests, only the dedicated long-sequence cases raise rates.

`POST /api/v2/auth/token/`: `{"username", "password"}` exchanges credentials for an API token and returns 200 `{"token"}`; bad credentials return 400.

## 7. Production hardening

`DJANGO_SECURE=true` enables: HTTPS redirect (except `/health/`, so load balancers can probe over HTTP), HSTS (`DJANGO_HSTS_SECONDS`, default 3600; raise to 31536000 once verified; `DJANGO_HSTS_INCLUDE_SUBDOMAINS` defaults to true; no preload by default, enabled only with `DJANGO_HSTS_PRELOAD=true`), Secure session cookie, Secure CSRF cookie, and 8-hour session expiry. Behind a reverse proxy set `DJANGO_SECURE_PROXY_SSL_HEADER=true` (trusts `X-Forwarded-Proto`; enable only if the proxy overwrites that header).

Always on: HttpOnly/SameSite=Lax session cookie, `CSRF_TRUSTED_ORIGINS` (`DJANGO_CSRF_TRUSTED_ORIGINS`, comma-separated), `SECURE_CONTENT_TYPE_NOSNIFF`, `SECURE_REFERRER_POLICY=same-origin`, `X_FRAME_OPTIONS=DENY`. `backend/.env.example` defaults to `DJANGO_DEBUG=False`.

CI runs `manage.py check --deploy --fail-level WARNING` with `DJANGO_SECURE=true` and a randomly generated strong secret key. Without preload, `security.W021` is silenced (a preload submission is hard to undo and is the deployer's decision).
