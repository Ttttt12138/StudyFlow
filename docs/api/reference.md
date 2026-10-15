# StudyFlow Backend API Reference

This is the concise endpoint reference for frontend and extraction-service
integration. For detailed workflow explanations, see [guide.md](guide.md). The generated
machine-readable contract is [openapi.yaml](../../backend/openapi.yaml).

## Student planning workspace

The authoritative [shared contract](../student-loan-contract.md) lists fields, routes, migration and removed endpoints. `inputs` contains `borrower` and `loan`; `loan.principal` is entered by the user. `GET planning/assessment/` returns products, full-course cap, quotes, documents and loan lifecycle. `POST planning/plan/confirm/` requires a current `quote_id` and submits the application atomically with plan confirmation. There is no no-loan branch, savings input or gap forecast.

`POST planning/loan-preview/` performs a read-only calculation. Automatic approval compares principal with the course cost in THB; fees do not increase the maximum. The simulated admission notice arrives completed with `auto: true`. Other documents and signing remain explicit. To-dos and wallet tools open when plan status is `CONFIRMED`; `ENROLLED` was removed.

The remaining sections document retained platform APIs, including legacy modules not mounted in the student app.

## Connection

Local base URL:

    http://127.0.0.1:8000/api/v2/

Authentication:

    Authorization: Token YOUR_LOCAL_TOKEN

All workflow POST requests also require:

    Idempotency-Key: UNIQUE-ACTION-KEY
    Content-Type: application/json

Use one key for one logical action. Repeating the same key and body safely returns
the saved response. Reusing the key with a different body returns HTTP 400.

The original POST state/ and POST forecasts/ APIs do not use Idempotency-Key.
State writes instead use expected_version.

Tokens can be obtained with `POST /api/v2/auth/token/` (`{"username", "password"}`,
throttled). Money-moving (T2) commands — payments/{id}/submit/, conversions/,
loan-accounts/{id}/repay/, remittance-orders/{id}/submit/ and
agent/pending-actions/{id}/confirm/ — additionally need `X-Step-Up-Token` from
`POST /api/v2/auth/step-up/`, and above the per-currency limits (T3) an approved
`approvals/` request decided by a second operator. See
[Authentication, step-up and approvals](#authentication-step-up-and-approvals) below;
docs/permissions.md has the design background.

Optional on every request:

    Accept-Language: zh-Hans   (or en; unsupported languages fall back to English)

It selects the language of error `message` texts and of agent answers when no
`locale` is given. All money in these APIs is simulated.

## Roles

| Role | Permitted operations |
|---|---|
| Student | Own state, scenarios, plans, loans, application submission, authorization, reconciliation; T2 commands after step-up; approval requests; agent sessions and confirming/rejecting own agent proposals; credit profile, snapshots and statements |
| Demo operator | Mock review/decision, beneficiary verification, funding/disbursement/payment outcomes, approval decisions (not for payees they verified, nor their own requests) |
| Anonymous | Health, auth/token/, /api/auth/session/, credit/statements/verify/ and sponsor confirmation only |

The operator is a controlled local simulator. AI extraction or planning components
must use student-scoped access and must never receive operator credentials.

## Response and error conventions

Workflow command/detail response:

    {"data": {"id": "UUID", "is_simulated": true, ...}}

Paginated list:

    {"count": 1, "next": null, "previous": null, "results": [...]}

| Status | Meaning |
|---|---|
| 200 | Read success or identical idempotent replay; also `auth/step-up/`, `approvals/{id}/decide/` and `credit/statements/verify/` success |
| 201 | New command completed |
| 400 | Invalid field, business rule, transition, or idempotency conflict |
| 401 | Missing or invalid authentication |
| 403 | Authenticated user lacks the operator/staff role, or a policy denial (`STEP_UP_REQUIRED`, `STEP_UP_INVALID`, `APPROVAL_REQUIRED`, `AGENT_TIER_EXCEEDED`, `SEPARATION_OF_DUTIES`, `STEP_UP_FAILED`) |
| 429 | Rate limit exceeded; retry after the `Retry-After` header |
| 404 | Record absent or owned by another student |
| 409 | Stale version (financial state, approval `expected_version`, ...), `APPROVAL_ALREADY_OPEN`, `APPROVAL_NOT_PENDING` |
| 503 | Database unavailable or migrations pending |

Unknown/read-only request fields are rejected instead of silently ignored.

Error body. Every error with a single message carries three keys:

    {"detail": "APPROVAL_REQUIRED", "code": "APPROVAL_REQUIRED", "message": "<localized text>", "policy": {...}}

| Key | Meaning |
|---|---|
| detail | Original value. Policy denials (403) and 409 conflicts use a plain string. Business-rule 400s from service checks use a one-element list, e.g. `["PENDING_ACTION_CLOSED"]`. Older routes may put an English sentence here |
| code | Machine-readable code: equal to the detail text when that is an UPPER_SNAKE code, otherwise the DRF category (`invalid`, `not_found`, `permission_denied`, `not_authenticated`, `stale_version`, `throttled`, ...). Match on this field |
| message | Human-readable text in the negotiated language (`Content-Language` response header says which) |
| policy | Only on policy denials; see [Policy denial body](#policy-denial-body) |

Field validation errors keep the DRF shape `{"field": ["..."]}` without `code`/`message`.

## System and documentation

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /health/ | Public | Database and migration readiness |
| GET | /api/schema/ | Student/operator | OpenAPI schema |
| GET | /api/docs/ | Student/operator | Swagger UI |
| GET/POST | /api/auth/login/ | Session flow | Browser session login |
| POST | /api/auth/logout/ | Session flow | Browser session logout |
| GET | /api/auth/session/ | Public | `{"authenticated", "username", "csrf_token"}` for the current browser session (`username` is null when signed out); `Cache-Control: no-store` |
| GET | /admin/ | Staff | Read-only finance administration |

## Authentication, step-up and approvals

### POST /api/v2/auth/token/

Public. Throttled per IP (`auth`, default 10/min). No Idempotency-Key.

    {"username": "student", "password": "..."}

Response 200 (no `data` envelope):

    {"token": "..."}

Wrong credentials return 400. Send the token as `Authorization: Token <token>`.

### POST /api/v2/auth/step-up/

Re-authenticates the signed-in user and issues a single-use token for exactly one
money-moving action. No Idempotency-Key. Throttled per user (`step_up`, default
10/hour; failures count too), so request it only when the user is about to submit.

Request:

    {
      "password": "the user's own password",
      "action": "remittance.submit",
      "target_id": "UUID",
      "amount": "1000.00",
      "currency": "CNY"
    }

| action | Protected route | target_id | amount and currency |
|---|---|---|---|
| payment.submit | POST payments/{id}/submit/ | payment id | the payment amount, THB |
| wallet.convert | POST conversions/ | the body's `quote_id` | the body's `source_amount`, the quote's source currency |
| loan.repay | POST loan-accounts/{id}/repay/ | loan account id | the amount of the installment being paid, THB |
| remittance.submit | POST remittance-orders/{id}/submit/ | order id | the order's `send_amount` and `send_currency` |
| (same as the proposal) | POST agent/pending-actions/{id}/confirm/ | the pending action's `target_id` | the pending action's `amount` and `currency`; `action` is the pending action's `action` (remittance.submit or wallet.convert) |

`agent.confirm` appears in the schema's action enum but is refused with 400
`ACTION_NOT_AVAILABLE`; always ask for the underlying action.

Response 200 (no `data` envelope; `amount` always has two decimals):

    {
      "token": "...",
      "expires_in_seconds": 300,
      "action": "remittance.submit",
      "target_id": "UUID",
      "amount": "1000.00",
      "currency": "CNY"
    }

| Error | Cause |
|---|---|
| 403 `STEP_UP_FAILED` | Wrong password, or the account has no usable password. No `policy` key. Audited as `auth.step_up_failed` |
| 404 | Target does not exist or belongs to someone else |
| 400 `POLICY_SUBJECT_MISMATCH` | Currency/amount do not match the target (payment: THB and the payment amount; repayment: THB and the amount of an unpaid installment of that account; conversion: the quote's source currency; remittance: the order's send amount and currency) |
| 400 `ACTION_NOT_AVAILABLE` | `action` is `agent.confirm` |
| 400 `CURRENCY_NOT_SUPPORTED`, `AMOUNT_PRECISION_INVALID`, `Amount must be positive.` | Invalid money value (JPY has no decimals) |
| 429 | Step-up rate limit |

The target's status is not checked here; the protected command checks it.

Using the token: send it as the `X-Step-Up-Token` header on the protected POST
(together with its usual Idempotency-Key). It is valid for 300 seconds, for one user,
and only for the exact action, target_id, amount and currency it was issued for. A
password change invalidates it. It is consumed in the same transaction as a
successful command; if the command fails a business rule the transaction rolls back
and the token stays usable until it expires. An identical idempotent replay (same
key and body) returns the stored response without any policy check.

### Policy denial body

A protected command that is not cleared returns 403:

    {
      "detail": "STEP_UP_REQUIRED",
      "code": "STEP_UP_REQUIRED",
      "message": "<localized text>",
      "policy": {
        "action": "remittance.submit",
        "tier": "T2",
        "target_id": "UUID",
        "amount": "1000.00",
        "currency": "CNY",
        "limits": {"per_transaction": "10000.00", "daily": "20000.00", "monthly": "60000.00"},
        "usage": {"daily": "0.00", "monthly": "0.00"},
        "requires": ["step_up"]
      }
    }

| policy field | Meaning |
|---|---|
| action, target_id, amount, currency | The subject to request step-up (and approval) for. On an agent confirm this is the underlying action, never `agent.confirm` |
| tier | `T2` (step-up only) or `T3` (step-up plus approval) |
| limits | Effective limits for the currency (configured limit x credit `limit_multiplier`), or null when the currency has no enabled limit (then always T3) |
| usage | Outflow already used today and this month in that currency, excluding this request |
| requires | `["step_up"]` for T2, `["step_up", "approval"]` for T3 |

`detail` values, in the order they are checked:

1. `AGENT_TIER_EXCEEDED`: the request carried a non-empty `X-StudyFlow-Agent` header.
   Calls made on behalf of an agent never pass a T2 route.
2. `STEP_UP_INVALID`: a token was sent but is expired, forged, already used, issued
   to another user, issued for a different subject, or predates a password change.
3. `APPROVAL_REQUIRED`: tier T3 and there is no `APPROVED`, unexpired approval with
   the same action, target_id, amount and currency.
4. `STEP_UP_REQUIRED`: no token was sent.

Tier rule: T2 when an enabled limit exists and amount <= per_transaction,
usage.daily + amount <= daily and usage.monthly + amount <= monthly; otherwise T3.
Days and months are Asia/Bangkok calendar periods in real time (not the demo clock).
Default limits before the credit multiplier:

| Currency | Per transaction | Daily | Monthly |
|---|---|---|---|
| THB | 50,000 | 100,000 | 300,000 |
| CNY | 10,000 | 20,000 | 60,000 |
| USD | 1,500 | 3,000 | 9,000 |
| EUR | 1,400 | 2,800 | 8,400 |
| GBP | 1,200 | 2,400 | 7,200 |
| JPY | 200,000 | 400,000 | 1,200,000 |

A call that would not move money (for example resubmitting an already submitted
payment, or a target that does not exist) skips the policy check and gets the normal
business answer. Every POST to a T2 route, including denied ones, counts against the
per-user `money` rate limit (default 60/hour).

### POST /api/v2/approvals/

Student request for dual control of a T3 action. No Idempotency-Key.

    {
      "action": "remittance.submit",
      "target_id": "UUID",
      "amount": "12000.00",
      "currency": "CNY",
      "reason": "Spring tuition, above the single-transfer limit"
    }

Copy action, target_id, amount and currency from the `APPROVAL_REQUIRED` denial's
`policy`. `reason` is required (max 500 characters). Validation and errors are the
same as for step-up (404, `POLICY_SUBJECT_MISMATCH`, `ACTION_NOT_AVAILABLE`, ...).

Response 201:

    {
      "data": {
        "id": "UUID",
        "type": "approvalrequest",
        "created_at": "2026-10-11T02:00:00Z",
        "action": "remittance.submit",
        "target_id": "UUID",
        "amount": "12000.00",
        "currency": "CNY",
        "reason": "Spring tuition, above the single-transfer limit",
        "status": "PENDING",
        "requested_by": 7,
        "decided_by": null,
        "decided_at": null,
        "decision_note": "",
        "expires_at": "2026-10-12T02:00:00Z",
        "used_at": null,
        "version": 1,
        "owner": 7
      }
    }

`owner`, `requested_by` and `decided_by` are integer user IDs. 409
`APPROVAL_ALREADY_OPEN` when a `PENDING` or `APPROVED` request already exists for the
same action and target_id (whatever its amount). Because there is no idempotency key,
a retried POST also gets 409; find the existing request with
`GET approvals/?status=PENDING`.

Approval states:

    PENDING -> APPROVED -> USED
            \-> REJECTED
    PENDING/APPROVED -> EXPIRED (24 hours after creation)

Expiry is applied when approvals are read, requested or decided. After `EXPIRED` or
`REJECTED` a new request can be made. `USED` is set (and `version` incremented) in
the same transaction as the successful T3 command. A command that clears as T2 does
not use an approval.

### GET /api/v2/approvals/
### GET /api/v2/approvals/{id}/

Paginated list (newest first, optional `?status=PENDING|APPROVED|REJECTED|EXPIRED|USED`)
or one `{"data": {...}}` record. Students see their own requests; staff see all.

### POST /api/v2/approvals/{id}/decide/

Staff only. No Idempotency-Key; `expected_version` protects against double decisions.

    {"decision": "approve", "note": "Checked invoice", "expected_version": 1}

`decision` is approve or reject; `note` is optional (max 500). Response 200
`{"data": {...}}` with `status`, `decided_by`, `decided_at`, `decision_note` and
`version` updated.

| Error | Cause |
|---|---|
| 403 (`permission_denied`) | Caller is not staff |
| 404 | No such approval |
| 403 `SEPARATION_OF_DUTIES` | Decider is the requester or the owner, or (for `payment.submit`, and `remittance.submit` to a beneficiary) the staff member who last verified that beneficiary |
| 409 (`stale_version`) | `expected_version` differs from the current version |
| 409 `APPROVAL_NOT_PENDING` | Already decided, used or expired |

These rules apply to approve and reject alike, so a demo needs two staff users: one
verifies beneficiaries, the other decides approvals.

### GET /api/v2/operations/queue/

Staff only (403 for students). Read-only work queue across all students, used by the
operations console (`/?ops=1`). Each list holds at most 100 items, oldest first.

    {"data": {
      "operator": {"id": 8, "username": "demo-approver"},
      "approvals": [...],          // PENDING, with owner_username, requested_by_username,
                                   // can_decide, blocked_reason (OWN_REQUEST | VERIFIED_PAYEE | null)
                                   // and target: the payment or remittance order it would release
                                   // (incl. payee_verified_by), or null
      "recent_decisions": [...],   // last 20 decided approvals, with decided_by_username
      "payments": [...],           // status pending | unknown: waiting for payments/{id}/adapter-event/
      "remittance_orders": [...],  // SUBMITTED | IN_TRANSIT | UNKNOWN: remittance-orders/{id}/adapter-event/
      "beneficiaries": [...],      // verified=false: beneficiaries/{id}/verify/
      "applications": [...],       // UNDER_REVIEW | APPROVED, with a quote summary:
                                   // applications/{id}/decision/ and applications/{id}/disburse/
      "sponsor_requests": [...],   // PENDING (incl. computed EXPIRED) and CONFIRMED-not-received:
                                   // sponsor-requests/{id}/issue-link/, funding-sources/{id}/receive/
      "is_simulated": true}}

`can_decide` mirrors the separation-of-duties rule so the console can explain it before
an attempt; `approvals/{id}/decide/` still enforces it.

### GET /api/v2/policy/limits/

T0, signed-in student. The caller's own effective outflow limits and current usage, so a
client can show why an action will be T2 or T3 before trying it. Response 200:

    {"data": {"credit_level": "BUILDING", "limit_multiplier": "1.0",
              "window_zone": "Asia/Bangkok", "is_simulated": true,
              "limits": [{"currency": "CNY",
                          "base": {"per_transaction": "10000.00", "daily": "20000.00", "monthly": "60000.00"},
                          "effective": {"per_transaction": "10000.00", "daily": "20000.00", "monthly": "60000.00"},
                          "usage": {"daily": "5000.00", "monthly": "5000.00"}}]}}

`effective` is `base` × `limit_multiplier` (from the credit level, see
[credit profile](#get-apiv2creditprofile)); amounts are two-decimal strings, as in the
policy denial body. Only enabled `PolicyLimit` rows are listed; a currency missing from
`limits` has no limit, so every T2 action in it is T3. `usage` counts the same outflows
that enforcement counts, with days and months in `window_zone` real time (not the demo
clock). The values are read at request time and can change before a command runs; the
command's own policy check is authoritative.

## Source metadata

### GET /api/v2/sources/

Lists owned source metadata.

### POST /api/v2/sources/

Registers metadata only.

Request:

    {
      "title": "University fee schedule",
      "kind": "official_url",
      "url": "https://university.example/fees",
      "note": "Optional context"
    }

Kinds: upload, official_url, import.

This endpoint does not fetch the URL, upload file content, run extraction, or prove
that the source is official.

## Financial state

### GET /api/v2/state/

Returns the latest financial-state version.

### POST /api/v2/state/

Appends a confirmed state version.

Request:

    {
      "expected_version": 0,
      "snapshot": {
        "currency": "THB",
        "as_of": "2026-10-02",
        "opening_balance": "80000.00",
        "reserve": "15000.00",
        "events": [
          {
            "id": "tuition",
            "label": "Tuition",
            "kind": "expense",
            "amount": "65000.00",
            "date": "2026-10-15",
            "certainty": "confirmed",
            "source_id": null,
            "beneficiary_id": null,
            "evidence_note": ""
          }
        ]
      }
    }

Event kind: income or expense.
Certainty: confirmed, estimated, or missing.
Missing values use null and certainty=missing.
Amounts are decimal strings and dates are YYYY-MM-DD.

To execute a payment, beneficiary_id must be confirmed on the expense before a
scenario and funding plan are created.

### GET /api/v2/state/history/

Returns immutable state versions newest first.

## Forecasts

### POST /api/v2/forecasts/

Calculates and saves a dated forecast.

Request:

    {
      "state_version": 1,
      "end_date": "2026-10-31",
      "include_estimates": false
    }

Returns timeline, ending/minimum balance, cash shortfall, reserve gap, first gap
date, missing data, excluded estimates, and assumptions.

### GET /api/v2/forecasts/history/

Lists saved CalculationRun records.

## FX quotes

### GET /api/v2/fx-quotes/
### GET /api/v2/fx-quotes/{id}/

List or inspect owned mock quote snapshots.

### POST /api/v2/fx-quotes/

Request:

    {
      "source_currency": "USD",
      "target_currency": "THB",
      "rate": "35.0000000000",
      "sender_fee": "1.00",
      "receiver_fee": "5.00",
      "settlement_days": 1,
      "expires_at": "2026-10-05T12:00:00+07:00"
    }

Supported source currencies: USD, EUR, CNY, GBP, JPY.
Target is THB. Fees and settlement delay must be explicit, including zero.
Expiry must be in the future and no more than 30 days away.

## Budget scenarios

### GET /api/v2/scenarios/
### GET /api/v2/scenarios/{id}/

List or inspect immutable scenario revisions.

### POST /api/v2/scenarios/

Request:

    {
      "state_version": 1,
      "kind": "expected",
      "end_date": "2026-10-31",
      "include_estimates": true,
      "overrides": [
        {
          "event_id": "living",
          "amount": "9400.00",
          "currency": "THB",
          "certainty": "estimated"
        }
      ]
    }

Kinds: essential, expected, higher_cost.
A foreign-currency override additionally requires fx_quote_id.
An override may change an existing expense for a scenario; it cannot create an
expense or alter an income event.

### GET /api/v2/scenarios/{id}/calendar/

Returns the scenario timeline, bound state version, and calculation assumptions.

## Funding sources

### GET /api/v2/funding-sources/
### GET /api/v2/funding-sources/{id}/

List or inspect owned funding sources.

### POST /api/v2/funding-sources/

Request:

    {
      "economic_key": "family-october-2026",
      "kind": "family",
      "currency": "USD",
      "amount": "300.00",
      "available_on": "2026-10-10",
      "certainty": "confirmed",
      "already_in_opening": false
    }

Kinds: family, scholarship, external_savings, loan.

For kind=loan, also send loan_id. Amount and currency must match the quote's net proceeds.
Availability is an explicit estimate, not a guaranteed receipt date. An undisbursed
loan must be estimated and cannot be opening funds.

### POST /api/v2/funding-sources/{id}/receive/

Operator-only mock settlement for non-loan funding.

Request for THB:

    {}

Request for foreign currency:

    {"fx_quote_id": "UUID"}

The source is credited once on or after availability plus settlement delay.

## Funding plans

### GET /api/v2/funding-plans/
### GET /api/v2/funding-plans/{id}/

List or inspect immutable validation results.

### POST /api/v2/funding-plans/

Request:

    {
      "scenario_id": "UUID",
      "allocations": [
        {
          "source_id": "UUID",
          "amount": "300.00",
          "fx_quote_id": "UUID"
        }
      ]
    }

Omit fx_quote_id for THB. Each source may appear once. Opening or already received
funds cannot be counted again.

Feasibility values:

- feasible
- feasible_under_assumptions
- incomplete
- funding_gap

## B loans inside Django (replacement contract)

B now owns lending calculations and transitions. This is a breaking replacement of the former Django lending payloads. There is no /api/v1 compatibility service.

| Method | Route | Function |
|---|---|---|
| GET/POST | loans/ | Immutable B quotes (THB, 1–60 months) |
| GET | loans/{id}/ | Quote inputs and exact full schedule |
| POST | loans/compare/ | Compare 2–10 owned quotes without ranking |
| GET/POST | affordability-profile/ | Read/fully replace versioned monthly budgets |
| GET/POST | applications/ | List/create DRAFT using quote_id |
| GET | applications/{id}/ | Status, version and assessment |
| POST | applications/{id}/action/ | submit/cancel with expected_version |
| POST | applications/{id}/decision/ | Operator re-evaluation with expected_version and reason |
| POST | applications/{id}/disburse/ | Operator-only simulated receipt with expected_version |
| GET | loan-accounts/ or loan-accounts/{id}/ | Outstanding principal, version and installments |
| POST | loan-accounts/{id}/repay/ | Pay the earliest due installment in full |
| GET | applications/{id}/c-context/ | Owner-scoped C quote/application/source contracts |
| POST | applications/{id}/explain/ | C mock explanation for owned, current scenario_id |
| GET | disbursements/ or disbursements/{id}/ | Historical receipt records |

Quote request:

```json
{"currency":"THB","principal":"30600.00","annual_rate":"0.12","fees":"600.00","months":12,"first_due_date":"2026-11-01"}
```

`annual_rate` is a fraction: 0.12 = 12%. B uses monthly annuity calculations, withheld fees, half-up cents and a final installment that clears principal. Due dates follow the first due day, clamp at month end and restore the original day later. JSON floats/bools for amounts/rates are rejected. The Django shared money contract limits amounts to 16 total digits including 2 decimals; computed installments outside that storage limit are rejected before a quote is saved. The B pure calculation core retains its original 18-digit input model.

Profile request:

```json
{"expected_version":0,"months":[{"month":"2026-11","income":"10000.00","living_expenses":"4000.00","existing_repayments":"1000.00"}]}
```

Supply every repayment month; null/missing means unknown, explicit zero means none. `existing_repayments` means external debt only. Other approved/disbursed unpaid B installments are counted automatically. Quote-time income fields were removed. `affordability_status` on a saved quote is historical/insufficient_information; authoritative current decisions are the application's `assessment` or C context.

Create with `{"quote_id":"UUID"}`. Submit `{"action":"submit","expected_version":1}`. B automatically selects APPROVED / REJECTED / UNDER_REVIEW. After missing inputs are supplied, the operator calls decision with `{"expected_version":2,"reason":"Inputs supplied"}`; it cannot force approve/reject. A quote can create only one application. Cancellation is allowed until DISBURSED, including rejected/approved applications. First due date must still be in the future when quoting, applying, submitting, reviewing and disbursing.

Disbursement rechecks affordability; if no longer affordable it returns the application to UNDER_REVIEW and creates no money or account. Success records net proceeds, a DISBURSED application, ACTIVE account, installments, state revision, ledger and audit atomically. Approval itself creates no funds. Old disbursements/{id}/action process/unknown/settle commands were removed; payment adapter status resolution remains unchanged.

Repay with `{"expected_version":1,"installment_number":1}`. Only the earliest unpaid, due installment can be paid; pending/unknown payment holds cannot be spent. No partial, early, automatic repayments or penalties. The last payment closes the account; the application remains DISBURSED. General payments cannot execute loan repayment events. Supplemental demo cash uses the existing operator-controlled funding-sources/{id}/receive route and the same wallet/ledger.

For loans, profiles, applications and repayments, idempotency keys share a namespace per authenticated actor. Same request/key returns the original result; reuse for another body or lending operation is rejected. Replays are snapshots; GET again for current state. All commands use the Django owner lock and a database transaction. Version conflicts return 409; other input/transition conflicts return 400 under the Django convention.

C exports exact B numbers, marks unreceived funding date unknown, and reports received money with allocatable=0. C explanations use a persisted Django scenario, not a fixed synthetic budget. A single scenario is not a complete low/base/high readiness analysis, so complete=false and candidates remain PENDING unless invalid. No model call approves or transfers funds.

## Demo wallet and clock

### POST /api/v2/demo/initialize/

    {"state_version": 1}

Creates the wallet once from the opening state.

### GET /api/v2/demo/wallets/

Returns balance, available_balance after pending/unknown holds, and demo date.

### POST /api/v2/demo/clock/

    {"date": "2026-10-03"}

The clock can move forward only, by no more than 730 days per request.

## Beneficiaries

### GET /api/v2/beneficiaries/
### GET /api/v2/beneficiaries/{id}/
### POST /api/v2/beneficiaries/

Create request:

    {
      "name": "Mock University",
      "destination_label": "MOCK-UNIVERSITY"
    }

### POST /api/v2/beneficiaries/{id}/verify/

Operator-only:

    {"verified": true}

Verification may also be revoked with false. A verified beneficiary still requires
student confirmation on the expense and a separate payment authorization.

## Payments

### GET /api/v2/payments/
### GET /api/v2/payments/{id}/
### POST /api/v2/payments/

Create request:

    {
      "plan_id": "UUID",
      "beneficiary_id": "UUID",
      "event_id": "tuition"
    }

### POST /api/v2/payments/{id}/authorize/

Student authorization:

    {
      "state_version": 3,
      "expires_in_seconds": 900
    }

### POST /api/v2/payments/{id}/cancel/

Student request:

    {}

Only draft or authorized tasks may be cancelled.

### POST /api/v2/payments/{id}/submit/

Student request:

    {}

Submission rechecks authorization, state, plan, quote, recipient, deadline, holds,
settled wallet funds, and reserve. It creates a hold but no ledger debit. It is a T2
action: send `X-Step-Up-Token` (and hold an approved approval when above the limits).

### POST /api/v2/payments/{id}/adapter-event/

Operator-only:

    {"outcome": "unknown"}

or failed/settled. Unknown preserves the hold. Failed releases it. Settled records
one debit and simulated receipt.

### POST /api/v2/payments/{id}/reconcile/

Student request:

    {}

Reconciliation requires a settled receipt matching the expense, beneficiary,
amount, and ledger entry.

Payment states:

    draft -> authorized -> pending -> settled -> reconciled
                          \-> unknown -> settled/failed
                          \-> failed
    draft/authorized -> cancelled

## Ledger and audit

### GET /api/v2/ledger/

Returns signed simulated ledger entries newest first. Positive entries are
funding/disbursements; negative entries are payments or loan repayments. Each owner also has a
monotonic settlement sequence for reconstructing actual event order.

### GET /api/v2/audit/

Returns owner-scoped action history with actor IDs and transition details:
the events whose owner is the authenticated user, newest first, paginated (50 per
page, `?page=N`). There is no detail route and no filter parameter. Events an
operator causes on a student's objects belong to the student (the operator's ID is in
`details.actor_id`); a staff user's own audit list contains only events it owns.

    {
      "count": 1, "next": null, "previous": null,
      "results": [
        {
          "id": "UUID",
          "type": "auditevent",
          "created_at": "2026-10-11T02:00:00Z",
          "action": "auth.step_up_granted",
          "entity_id": "UUID",
          "details": {"actor_id": 7, "action": "remittance.submit", "target_id": "UUID",
                      "amount": "1000.00", "currency": "CNY"}
        }
      ]
    }

`details.actor_id` (integer user ID) is always present; the other keys depend on
`action`. Actions written by the step-up, approval, agent and credit features:

| action | entity_id | Extra details |
|---|---|---|
| auth.step_up_granted | step-up grant id | action, target_id, amount, currency (never the token) |
| auth.step_up_failed | the requested target_id | action |
| approval.requested | approval id | action, target_id, amount, currency |
| approval.approved, approval.rejected | approval id | action, target_id; actor_id is the deciding staff user |
| agent.action_confirmed, agent.action_rejected | pending action id | action |
| credit.snapshot_created, credit.statement_issued | snapshot id | level |

Other workflows write their own names (for example `state.confirmed`,
`payment.authorized`, `remittance.created`, `wallet.conversion_settled`,
`beneficiary.mock_verification`); treat unknown names as displayable text.

FinancialState, AuditEvent, and DemoLedgerEntry are protected from UPDATE and DELETE
by PostgreSQL triggers.

## Finance agent

The agent turns a one-sentence goal into tool calls on the student's own data. Read
tools (T0) and non-money writes such as live quotes and CREATED remittance orders (T1)
run directly. Money-moving tools (T2) only create a pending action; nothing leaves the
wallet until the student confirms it with a step-up token. All funds are simulated.

### POST /api/v2/agent/sessions/

Headers: Idempotency-Key (1-100 characters). Optional Accept-Language.

    {"goal": "Send 5000 CNY to my THB wallet using the cheapest route", "locale": "en"}

`goal` is required (max 2000 characters). `locale` is `zh` or `en`; when omitted it
is `zh` if the negotiated language starts with zh, otherwise `en`.

The session runs synchronously to its end (at most 11 planner calls, which can take a
while in live mode) and returns 201 `{"data": <session>}`. Repeating the same key
with the same goal and locale returns 200 with the session's current record. The same
key with a different goal or locale returns 400 `Idempotency key was used with a
different request.`. POST is throttled by the per-user `agent` scope (default
30/hour) in addition to the global user rate.

Session:

    {
      "data": {
        "id": "UUID",
        "type": "agentsession",
        "created_at": "2026-10-11T02:00:00Z",
        "goal": "Send 5000 CNY to my THB wallet using the cheapest route",
        "locale": "en",
        "mode": "mock",
        "status": "COMPLETED",
        "final_answer": "...",
        "error_code": "",
        "write_count": 2,
        "updated_at": "2026-10-11T02:00:04Z",
        "steps": [ ... ],
        "pending_actions": [ ... ],
        "is_simulated": true
      }
    }

| Field | Meaning |
|---|---|
| mode | Planner mode of the backend (`mock` or `live`) |
| status | `COMPLETED`, `FAILED`, or `RUNNING` (only seen if a run was interrupted by a server error) |
| final_answer | The answer to show. On `FAILED` it is a fixed fallback text in the session locale |
| error_code | Empty unless `FAILED`: `INVALID_TOOL_CALL`, `STEP_BUDGET_EXHAUSTED`, or a provider error code in live mode |
| write_count | T1 writes used (maximum 4) |
| steps | All steps, ordered by `number` |
| pending_actions | Proposals made in this session, newest first |

Step:

    {
      "id": "UUID", "created_at": "...", "number": 5,
      "tool": "submit_remittance_order", "tier": "T2",
      "arguments": {"order_id": "UUID"},
      "rationale": "Propose submitting the order for the student to confirm.",
      "status": "PROPOSED",
      "result": { ... },
      "call": {"provider": "...", "purpose": "plan", "model": "...", "mode": "mock", ...}
    }

| status | result |
|---|---|
| OK | The tool output. Larger than 4000 characters: `{"truncated": true, "preview": "..."}` |
| ERROR | `{"error": ...}`: a code string, a list of messages (e.g. `["QUOTE_EXPIRED"]`) or a field-to-messages object. Planner failures have empty `tool`/`tier` and `{"error": "<code>"}`, plus `refused_tool` for `INVALID_TOOL_CALL`/`STEP_BUDGET_EXHAUSTED` |
| DENIED | `{"error": "WRITE_BUDGET_EXHAUSTED"}`: a fifth T1 write was refused |
| PROPOSED | A T2 proposal, see below |
| FINAL | `{"answer": "..."}`; `tool` and `tier` are empty |

`call` is planner call metadata (provider, purpose, model, mode, prompt_version,
duration_ms, input/output tokens, attempts, error_code, request_id) for diagnostics.

PROPOSED result:

    {
      "pending_action_id": "UUID",
      "action": "remittance.submit",
      "target_id": "UUID",
      "currency": "CNY",
      "amount": "5000.00",
      "expires_at": "...",
      "details": {"order_id": "UUID", "recipient": "SELF", "receive_currency": "THB",
                  "receive_amount": "..."},
      "executed": false,
      "requires": ["student_confirmation", "step_up"]
    }

For a remittance, `details` also contains `beneficiary` (`id`, `name`,
`destination_label`) when the order pays a beneficiary. For a conversion, `details`
is `{"quote_id", "source_amount"}`. `requires` does not show whether an approval will
also be needed; that is only known when confirming (`APPROVAL_REQUIRED`).

Pending action (in `pending_actions`, and the `data` of confirm/reject):

    {
      "id": "UUID",
      "type": "agentpendingaction",
      "created_at": "...",
      "session": "UUID",
      "step": "UUID",
      "action": "remittance.submit",
      "tool": "submit_remittance_order",
      "arguments": { ...same as details... },
      "target_id": "UUID",
      "amount": "5000.00",
      "currency": "CNY",
      "status": "PENDING",
      "expires_at": "...",
      "decided_at": null,
      "result": {},
      "version": 1
    }

| action | target_id | amount, currency |
|---|---|---|
| remittance.submit | remittance order id | order send amount and currency |
| wallet.convert | live FX quote id | source amount and the quote's source currency |

`status`: `PENDING`, `CONFIRMED`, `REJECTED`, `EXPIRED` (`FAILED` exists in the
schema but is not currently set). A proposal expires 900 seconds after it is made.
After confirmation `result` holds the executed command's record: the remittance order
(with its `status`) or the conversion. Only one PENDING proposal can exist per action
and target; proposing the same target again yields an ERROR step `ALREADY_PROPOSED`.

Tool catalog:

| Tool | Tier | Arguments | Effect |
|---|---|---|---|
| get_balances | T0 | none | Wallet balances per currency |
| get_fx_rate | T0 | base, quote | Reference rate with date and source |
| list_corridors | T0 | source_currency?, target_currency? | Enabled corridors |
| list_beneficiaries | T0 | none | Own beneficiaries with `verified` |
| get_credit_profile | T0 | none | Credit profile without evidence |
| list_remittance_orders | T0 | none | Latest 10 orders |
| rank_quotes | T0 | quote_ids (2-6), deadline? | Ranked quotes and `recommended_quote_id` |
| create_live_quote | T1 | corridor_id, send_amount | Same as POST fx-quotes/live/ (quote valid 10 minutes) |
| create_remittance_order | T1 | quote_id, recipient, beneficiary_id?, purpose, reference?, deadline? | Same as POST remittance-orders/ (status CREATED) |
| submit_remittance_order | T2 | order_id | Proposal only |
| convert_balance | T2 | quote_id, source_amount | Proposal only |

Loop limits: at most 10 tool calls and 4 T1 writes per session; the planner is told
to finish after the same tool fails twice in a row or `rank_quotes` finds no on-time
quote. Operator tools are never available to the agent.

### GET /api/v2/agent/sessions/
### GET /api/v2/agent/sessions/{id}/

Paginated list of own sessions (newest first, each with steps and pending actions) or
one `{"data": <session>}`. Another student's session returns 404. Re-read a session
to refresh its pending action statuses.

### POST /api/v2/agent/pending-actions/{id}/confirm/

Headers: Idempotency-Key, `X-Step-Up-Token`. Body `{}`.

The token must be issued for the pending action's `action`, `target_id`, `amount` and
`currency` (not for `agent.confirm`). A T3 amount additionally needs an approved
approval for the same subject. Denials use the [policy denial body](#policy-denial-body)
with the underlying action in `policy`.

| Situation | Result |
|---|---|
| PENDING, not expired, cleared | Runs the same service as POST remittance-orders/{id}/submit/ (at the order's current version) or POST conversions/ (at the current state version). 201 with `status: "CONFIRMED"`, `decided_at`, `result`, `version: 2`. Token (and approval) consumed; audited `agent.action_confirmed` |
| Business rule fails (e.g. `INSUFFICIENT_BALANCE`, `RESERVE_REQUIRED`, `QUOTE_EXPIRED`, `QUOTE_CONSUMED`, `BENEFICIARY_NOT_VERIFIED`) | 400; everything rolls back, the action stays PENDING and the token is not consumed |
| Expired (past `expires_at`) | No token needed. 201 with `status: "EXPIRED"`; nothing executed |
| Already CONFIRMED | 201 (new key) or 200 (same key) with the CONFIRMED record; nothing runs twice |
| REJECTED or EXPIRED | 400 `PENDING_ACTION_CLOSED` |
| Another student's action | 404 |

For a remittance whose order is no longer CREATED, or whose 10-minute quote has
expired, nothing would be debited, so no token is demanded and the submit service
answers: an expired quote turns the order `EXPIRED` and the pending action still
becomes `CONFIRMED` with `result.status` = `EXPIRED`; a cancelled or expired order
gives 400 `INVALID_TRANSITION`. Always check `result.status` after confirming.

### POST /api/v2/agent/pending-actions/{id}/reject/

Headers: Idempotency-Key. Body `{}`. No step-up.

201 with `status: "REJECTED"` (repeating on a REJECTED action returns it again);
CONFIRMED or EXPIRED returns 400 `PENDING_ACTION_CLOSED`. Audited
`agent.action_rejected`. After rejection the agent may propose the same target again.

## Credit building (simulated)

An internal on-time record built from the student's own loan installments, settled
payments, and delivered remittances to verified beneficiaries with a deadline. It is
not a credit score and is never reported to or obtained from a bureau. Its level
scales the T2 limits.

### GET /api/v2/credit/profile/

Computed live; nothing is stored.

    {
      "data": {
        "level": "FAIR",
        "on_time": 4, "late": 0, "overdue": 0,
        "as_of": "2026-10-11",
        "limit_multiplier": "1.2",
        "factors": [{"code": "ON_TIME_RECORDS", "effect": "positive", "count": 4}],
        "next_level": {"level": "GOOD", "on_time_needed": 2, "late_records_must_age_out": false},
        "evidence": [
          {"source": "loan_installment", "id": "UUID", "due_on": "2026-09-01",
           "completed_on": "2026-08-30", "status": "ON_TIME"}
        ],
        "is_simulated": true,
        "disclaimer": "Simulated on-time record inside StudyFlow. ..."
      }
    }

| Level | Condition (first match wins) | limit_multiplier |
|---|---|---|
| AT_RISK | Any overdue item, or 2+ late | 0.5 |
| GOOD | 6+ on time and 0 late | 1.5 |
| FAIR | 3+ on time and at most 1 late | 1.2 |
| BUILDING | Everything else, including no history | 1.0 |

- `as_of` is today's real date; completed items count when completed within the last
  365 days; unresolved overdue items always count. Overdue is judged against the
  later of today and the demo clock.
- `evidence[].source`: `loan_installment`, `payment`, `remittance_order`;
  `status`: `ON_TIME`, `LATE`, `OVERDUE` (`completed_on` is null for overdue).
- `factors[].code`: `ON_TIME_RECORDS` (positive), `LATE_RECORDS` (negative),
  `OVERDUE_RECORDS` (negative), each only when its count is above 0; `THIN_HISTORY`
  (neutral, `count` = on-time count) whenever on_time < 3.
- `next_level`: GOOD → null; FAIR → `{"level": "GOOD", "on_time_needed",
  "late_records_must_age_out"}`; BUILDING → `{"level": "FAIR", "on_time_needed"}`;
  AT_RISK → `{"level": "BUILDING", "action"}` with `RESOLVE_OVERDUE` or
  `WAIT_FOR_LATE_RECORDS_TO_AGE_OUT`.

### POST /api/v2/credit/snapshots/

Headers: Idempotency-Key. Body `{}`. Stores the current profile as an immutable
snapshot. Response 201:

    {
      "data": {
        "id": "UUID", "type": "creditsnapshot", "created_at": "...",
        "level": "FAIR", "on_time": 4, "late": 0, "overdue": 0,
        "factors": [...], "evidence": [...], "as_of": "2026-10-11",
        "limit_multiplier": "1.2", "next_level": {...}, "disclaimer": "..."
      }
    }

### GET /api/v2/credit/snapshots/
### GET /api/v2/credit/snapshots/{id}/

Paginated list or one `{"data": {...}}` of own snapshots. Stored records contain
`id`, `type`, `created_at`, `level`, `on_time`, `late`, `overdue`, `factors`,
`evidence` and `as_of` only.

### POST /api/v2/credit/statements/

Headers: Idempotency-Key.

    {"snapshot_id": "UUID"}

Response 201:

    {"data": {"statement": "<signed string>", "expires_in_days": 90,
              "snapshot_id": "UUID", "level": "FAIR", "is_simulated": true}}

The snapshot must be the caller's own (otherwise 404). The signed statement contains
the snapshot ID, holder username, level, the three counts, `as_of` and `issued_at`;
no transaction details.

### POST /api/v2/credit/statements/verify/

Public: no authentication, no Idempotency-Key (anonymous rate limit applies).

    {"statement": "<signed string>"}

Always 200 for a string (or missing/null) `statement`:

    {"data": {"valid": true, "snapshot_id": "UUID", "holder": "student", "level": "FAIR",
              "on_time": 4, "late": 0, "overdue": 0, "as_of": "2026-10-11",
              "issued_at": "...", "is_simulated": true, "disclaimer": "..."}}

    {"data": {"valid": false, "reason": "INVALID_SIGNATURE"}}

`reason`: `INVALID_SIGNATURE` (missing, empty, longer than 4000 characters, tampered
or malformed), `EXPIRED` (issued more than 90 days ago), `SNAPSHOT_MISMATCH` (the
snapshot no longer exists or differs). Unknown body fields, or a `statement` that is an
object, array or boolean, are rejected with 400.

## Recommended integration sequence

    C registers source metadata
      -> C/A presents extracted events
      -> student confirms POST state/
      -> A creates three scenarios
      -> A creates and validates funding sources/plans
      -> optional loan simulation/application
      -> operator settles actual simulated funding
      -> A reads new state version and creates a fresh plan
      -> student authorizes payment
      -> operator reports adapter outcome
      -> student reconciles receipt

See [backend/examples/workflow.http](../../backend/examples/workflow.http) for executable request examples using the seeded demo.

## Study life: in-app reminders and monthly budget

All routes below use `/api/v2/`, session authentication and existing CSRF rules. POST commands require `Idempotency-Key` and use the existing transactional command/audit pipeline.

| Method / path | Purpose / body |
| --- | --- |
| `GET planning/life/` | Read-only projection of tasks, estimated bills, explicit enrollment reminder and next unpaid installment of each actual loan account; top three upcoming items, unread count, current-month budget, dated planning forecast |
| `POST planning/life/tasks/` | `title`, optional `due_date`, `amount`, `currency`, `source_text`; requires an existing plan |
| `POST planning/life/actions/` | `source_key`, `expected_token`, `action`: acknowledge / snooze / reschedule / complete / reopen; date required for snooze or reschedule |
| `POST planning/life/budget/` | `month` YYYY-MM, `amount`, `expected_version`; enrolled student only, zero means explicitly zero |
| `POST planning/life/undo-expense/` | Owned `expense_id`; soft-void the entry without moving funds |
| `POST planning/life/clock/` | `date`; advance shared simulated date by 0–730 days, never back; no wallet is created |

Reminder tokens cover the original record, current reminder stage and preference version; stale writes return 409. Reading does not create notifications or mutate records. Acknowledgement does not complete a task. Snoozing does not change its deadline. Reminder date overrides do not alter original plan/bill snapshots; loan due dates cannot be overridden. Actual loan repayment and enrollment must use their original confirmed commands. Bill completion records the student's declaration only and does not execute a payment.

Budget responses include `budget_known`, `budget_source`, `budget_version` and `unconverted`; incomplete estimates remain unknown in the life panel. A recorded budget never updates financial state or wallet balances. Agent tools `create_study_task` (T1) and `get_study_life` (T0) support the same conversation.
