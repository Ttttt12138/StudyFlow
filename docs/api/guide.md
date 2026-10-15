> Current student flow (2026-10-15): [shared contract](../student-loan-contract.md). User-entered loan amount, mandatory application, automatic simulated admission notice, DRAFT/CONFIRMED only. Older descriptions of family funding, budgets, bookkeeping, enrollment and no-loan confirmation below are historical platform documentation.

# Backend API integration guide

Base: http://127.0.0.1:8000/api/v2/
Header: Authorization: Token YOUR_LOCAL_TOKEN
JSON: Content-Type: application/json
Workflow POST header: Idempotency-Key: a-unique-action-key

The operator is a local staff user representing a controlled mock adapter.
It can review/decide applications, verify beneficiaries, and report adapter outcomes.
A student cannot invoke those commands, even if an AI recommends the action.
All list/detail data is owner-scoped. Operator commands can target a student's object
and record the operator's actor ID in that student's audit history.

## Response conventions

New workflow commands/detail: {"data": {"id": "...", "is_simulated": true, ...}}
Lists: {"count": 1, "next": null, "previous": null, "results": [...]}
Create/action success: 201; identical idempotency replay: 200.
400: malformed input, policy/transition failure, mismatched idempotency body.
401/403: authentication/role denial. 404: absent or inaccessible object.
409: stale financial-state version. 503: readiness failure.
Every unsupported/read-only request field is rejected.

Error bodies: {"detail": ..., "code": "STEP_UP_REQUIRED", "message": "localized text"}.
Match on `code`. `detail` is kept for compatibility: a plain string for policy
denials and 409 conflicts, a one-element list such as ["INSUFFICIENT_BALANCE"] for
business-rule 400s. `message` follows Accept-Language (en or zh-Hans; others fall
back to English; Content-Language says which). Field errors stay {"field": ["..."]}.
403 can also be a policy denial with an extra `policy` object (see Step-up below).
429: rate limit; wait for Retry-After.

Existing state and forecast responses retain their original structure.
POST state/ requires expected_version and a full validated snapshot.
State versions start at 1. POST forecasts/ requires the current state_version.

## Budgets, FX, funding

| Method | Route | Function |
|---|---|---|
| GET/POST | fx-quotes/ | List/create explicit mock source-currency-to-THB quotes |
| GET | fx-quotes/{id}/ | Quote snapshot |
| GET/POST | scenarios/ | List/create essential, expected, or higher_cost revisions |
| GET | scenarios/{id}/ | Version-bound calculation and inputs |
| GET | scenarios/{id}/calendar/ | Dated events and assumptions |
| GET/POST | funding-sources/ | Stable economic source identity and availability |
| GET | funding-sources/{id}/ | Funding source |
| POST | funding-sources/{id}/receive/ | Operator: settle a non-loan source once |
| GET/POST | funding-plans/ | Combine allocations; deterministic feasibility |
| GET | funding-plans/{id}/ | Saved funding calculation |

FX request fields: source_currency, target_currency=THB, rate, sender_fee,
receiver_fee, settlement_days, expires_at. Fees and delay must be explicit.
Rate means THB per one source unit. Quotes expire within the next 30 days.
Funding net = (allocated source amount - sender fee) * rate - receiver fee.
Expense budget = (foreign expense amount + sender fee) * rate + receiver fee.
No spread is added separately. Rounding is half-up to THB cents.
JPY inputs must be whole units.

Scenario request:
    {
      "state_version": 1, "kind": "expected", "end_date": "2026-10-31",
      "include_estimates": true,
      "overrides": [
        {"event_id":"living","amount":"9400.00","currency":"THB","certainty":"estimated"}
      ]
    }

An override references an existing expense. It cannot silently change an income.
Foreign expense overrides additionally require fx_quote_id.
For unknown amounts use null and certainty=missing; incomplete data remains visible.
To add expenses, confirm a new state version first.

Funding source request:
    {
      "economic_key":"family-october-2026", "kind":"family", "currency":"USD",
      "amount":"300.00", "available_on":"2026-10-10",
      "certainty":"confirmed", "already_in_opening":false
    }

Kinds: family, scholarship, external_savings, loan.
Loan sources require loan_id, exact net proceeds/currency from the quote,
and certainty=estimated. Availability is an explicit estimate, not a guaranteed B receipt date. Approval never makes a loan current available money.
Same-currency mock source receipt fees are zero; foreign receipts require a quote.
Money already in opening funds or already received cannot be added again.

Funding plan request:
    {
      "scenario_id":"UUID",
      "allocations":[{"source_id":"UUID","amount":"300.00","fx_quote_id":"UUID"}]
    }

Each source occurs once, with a positive allocation no larger than its capacity.
Results distinguish feasible, feasible_under_assumptions, incomplete, and funding_gap.
A sufficient final balance does not erase an earlier gap.
Loan-backed plans include the FULL associated repayment schedule, not a prorated debt.
Old scenarios/plans are rejected after state changes or quote expiry.

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

## Payment and reconciliation

| Method | Route | Function |
|---|---|---|
| POST | demo/initialize/ | Seed wallet once from current opening snapshot |
| GET | demo/wallets/ | Balance, available balance after holds, demo date |
| POST | demo/clock/ | Advance demo date monotonically |
| GET/POST | beneficiaries/ | List/create immutable mock destinations |
| GET | beneficiaries/{id}/ | Destination and verification flag |
| POST | beneficiaries/{id}/verify/ | Operator: mock verification/revocation |
| GET/POST | payments/ | List/create task bound to plan and expense |
| GET | payments/{id}/ | Status, authorization expiry and receipt |
| POST | payments/{id}/authorize/ | Student: exact state-bound authorization |
| POST | payments/{id}/cancel/ | Student: cancel/revoke before submission |
| POST | payments/{id}/submit/ | Recheck policy and reserve settled funds |
| POST | payments/{id}/adapter-event/ | Operator: settled, failed, unknown |
| POST | payments/{id}/reconcile/ | Match settled receipt to expense reference |
| GET | ledger/ | Immutable signed demo entries, ordered sequence |
| GET | audit/ | Owner-scoped append-only audit events |
| GET | state/history/ | Historical financial snapshots |
| GET | forecasts/history/ | Prior calculation runs |

Before creating a payment:
1. Create a beneficiary and obtain controlled mock verification.
2. Confirm that beneficiary_id on the relevant expense through POST state/.
3. Create a scenario and feasible funding plan for that NEW state version.
4. Submit payments/ with plan_id, beneficiary_id, event_id.

Authorization requires state_version and optional expires_in_seconds (60-3600).
Amount/currency/beneficiary are derived from the confirmed task, not editable
authorization text. The mock payment fee is fixed at zero.
No separate chatbot permission can override these checks.

Submission checks state, plan, quote validity, recipient verification, deadline,
settled balance, other holds, and minimum reserve.
Pending/unknown tasks reserve funds; timeout does not show success or release funds.
Do not resubmit with a new task. Read the same task and resolve the original outcome.
Failure releases its hold; settlement replaces the hold with one negative ledger entry.
Reconciliation additionally matches the receipt's expense/beneficiary/amount reference.

Approval, authorization, submission, settlement, and reconciliation are separate.
After an inflow or payment settlement, fetch the new state version and recalculate.
Actual observed same-day events follow ledger sequence; future same-day expenses
conservatively precede unobserved income. Ledger-backed events cannot be rewritten.
Opening balance/currency/as_of are fixed after demo initialization.

## Step-up and approvals (T2/T3)

| Method | Route | Function |
|---|---|---|
| POST | auth/token/ | Public: username/password -> {"token"} (no data envelope) |
| POST | auth/step-up/ | Password re-check -> single-use 5-minute token for one action/target/amount/currency |
| GET/POST | approvals/ | List (?status=) / student request for a T3 action |
| GET | approvals/{id}/ | Approval status and version |
| POST | approvals/{id}/decide/ | Operator: approve/reject with expected_version |
| GET | policy/limits/ | Own effective limits (base × credit multiplier) and daily/monthly usage per currency |

T2 routes (money leaves the wallet) and the subject each one is cleared for:

| Route | action | target_id | amount, currency |
|---|---|---|---|
| payments/{id}/submit/ | payment.submit | payment id | payment amount, THB |
| conversions/ | wallet.convert | body quote_id | body source_amount, quote source currency |
| loan-accounts/{id}/repay/ | loan.repay | account id | the installment's amount, THB |
| remittance-orders/{id}/submit/ | remittance.submit | order id | send_amount, send_currency |
| agent/pending-actions/{id}/confirm/ | the pending action's action | its target_id | its amount, currency |

Step-up request (no Idempotency-Key; throttled 10/hour per user, failures included):

    {"password":"...","action":"remittance.submit","target_id":"UUID","amount":"1000.00","currency":"CNY"}

Response 200, not wrapped in data:

    {"token":"...","expires_in_seconds":300,"action":"remittance.submit","target_id":"UUID","amount":"1000.00","currency":"CNY"}

Send it as `X-Step-Up-Token` on the T2 POST. It works once, for this user, for this
exact subject, for 300 seconds, and dies on a password change. A command that fails a
business rule rolls back without consuming it. Wrong password: 403 STEP_UP_FAILED.
Target missing/not owned: 404. Amount/currency not matching the target: 400
POLICY_SUBJECT_MISMATCH. action=agent.confirm: 400 ACTION_NOT_AVAILABLE.

An uncleared T2 call returns 403 with `policy`:

    {"detail":"APPROVAL_REQUIRED","code":"APPROVAL_REQUIRED","message":"...",
     "policy":{"action":"remittance.submit","tier":"T3","target_id":"UUID","amount":"12000.00",
       "currency":"CNY","limits":{"per_transaction":"10000.00","daily":"20000.00","monthly":"60000.00"},
       "usage":{"daily":"0.00","monthly":"0.00"},"requires":["step_up","approval"]}}

Checked in this order: AGENT_TIER_EXCEEDED (X-StudyFlow-Agent header present),
STEP_UP_INVALID (bad/used/expired/mismatched token), APPROVAL_REQUIRED (T3 without an
approved approval), STEP_UP_REQUIRED (no token). T3 = amount above the effective
per-transaction limit, or today's/this month's usage plus amount above the daily/monthly
limit, or no enabled limit for the currency. Effective limit = configured limit x the
credit limit_multiplier. Days/months are Asia/Bangkok real time, not the demo clock.
Calls that would move no money (already submitted, unknown target) skip the policy
and get the business answer. Idempotent replays skip it too.

T3 flow:
1. The T2 call returns 403 APPROVAL_REQUIRED; copy action/target_id/amount/currency
   from `policy`.
2. POST approvals/ with those four fields plus reason -> 201 PENDING, expires in 24 hours.
   A second open request for the same action+target returns 409 APPROVAL_ALREADY_OPEN
   (there is no idempotency key; look it up with GET approvals/?status=PENDING).
3. A different staff user POSTs approvals/{id}/decide/
   {"decision":"approve","note":"...","expected_version":1} -> 200.
   Not staff: 403. Requester/owner, or (payments and beneficiary remittances) the staff
   user who verified the beneficiary: 403 SEPARATION_OF_DUTIES. Wrong version: 409.
   Not PENDING (incl. expired): 409 APPROVAL_NOT_PENDING.
4. The student polls GET approvals/{id}/ until APPROVED, then steps up and retries the
   T2 call with a NEW Idempotency-Key. Success marks the approval USED.

Approval states: PENDING -> APPROVED -> USED; PENDING -> REJECTED;
PENDING/APPROVED -> EXPIRED. Students see their own approvals; staff see all.

## Finance agent

| Method | Route | Function |
|---|---|---|
| GET/POST | agent/sessions/ | List / run a session from a goal (synchronous) |
| GET | agent/sessions/{id}/ | Session with steps, final answer, pending actions |
| POST | agent/pending-actions/{id}/confirm/ | Student: execute a proposal (T2, step-up) |
| POST | agent/pending-actions/{id}/reject/ | Student: discard a proposal |

The agent reads data (T0) and creates live quotes and CREATED remittance orders (T1,
at most 4 per session) by itself. It can never move money: submit_remittance_order
and convert_balance (T2) only create a pending action, valid for 15 minutes, which the
student confirms with a step-up token for the underlying action. All funds are
simulated; the final answer must not be read as "money sent" while a proposal is
pending.

End-to-end flow:

1. Run the session (Idempotency-Key required; locale optional, defaults from
   Accept-Language; throttled 30/hour):

       POST agent/sessions/
       {"goal":"Send 5000 CNY to my THB wallet using the cheapest route"}

   201 {"data": {"status":"COMPLETED","final_answer":"...","steps":[...],"pending_actions":[...]}}.
   Same key and body again: 200 with the current session.

2. Show `final_answer` and the steps. A PROPOSED step's `result` and the matching
   `pending_actions[]` entry carry what to confirm:

       {"id":"PENDING_ID","action":"remittance.submit","target_id":"ORDER_ID",
        "amount":"5000.00","currency":"CNY","status":"PENDING","expires_at":"...",
        "arguments":{"order_id":"ORDER_ID","recipient":"SELF","receive_currency":"THB","receive_amount":"..."}}

   Show amount, currency, recipient and receive_amount before asking to confirm.

3. Step up for the UNDERLYING action, copying action/target_id/amount/currency from the
   pending action (never action=agent.confirm):

       POST auth/step-up/
       {"password":"...","action":"remittance.submit","target_id":"ORDER_ID","amount":"5000.00","currency":"CNY"}

4. Confirm:

       POST agent/pending-actions/PENDING_ID/confirm/
       Idempotency-Key: confirm-PENDING_ID
       X-Step-Up-Token: <token>
       {}

   201 {"data": {"status":"CONFIRMED","result":{...order or conversion record...},"version":2}}.
   Check result.status (a remittance whose quote expired is confirmed as an EXPIRED
   order with nothing debited).

5. If step 4 returns 403 APPROVAL_REQUIRED, follow the T3 flow above with the
   `policy` subject, then repeat steps 3-4 with a new Idempotency-Key.

Other outcomes of confirm: no/invalid token 403 STEP_UP_REQUIRED/STEP_UP_INVALID
(policy.action is the underlying action); business failure (INSUFFICIENT_BALANCE,
QUOTE_EXPIRED, RESERVE_REQUIRED, ...) 400 with the action still PENDING and the token
unused; past expires_at 201 with status EXPIRED; already rejected/expired 400
PENDING_ACTION_CLOSED. Reject: POST .../reject/ with {} and an Idempotency-Key -> 201
REJECTED.

A session ends COMPLETED or FAILED (error_code INVALID_TOOL_CALL,
STEP_BUDGET_EXHAUSTED or a provider code; final_answer is then a fallback text).
Limits: 10 tool calls, 4 T1 writes, tool results truncated above 4000 characters.
Field-level details are in reference.md.

## Credit building (simulated)

| Method | Route | Function |
|---|---|---|
| GET | credit/profile/ | Live level, counts, factors, next_level, evidence, limit_multiplier |
| GET/POST | credit/snapshots/ | List / store the current profile (POST body {}) |
| GET | credit/snapshots/{id}/ | Stored snapshot |
| POST | credit/statements/ | Signed statement for an owned snapshot_id (valid 90 days) |
| POST | credit/statements/verify/ | Public: check a statement; always 200 with valid true/false |

This is an internal on-time record (loan installments, settled payments, delivered
remittances to verified beneficiaries with a deadline), not a bureau score.
Levels: AT_RISK (overdue, or 2+ late; x0.5), GOOD (6+ on time, 0 late; x1.5), FAIR
(3+ on time, at most 1 late; x1.2), BUILDING (otherwise; x1.0). The multiplier scales
the T2/T3 limits immediately. Snapshot and statement POSTs need Idempotency-Key;
verify needs neither authentication nor a key. Invalid reasons: INVALID_SIGNATURE,
EXPIRED, SNAPSHOT_MISMATCH.

## Audit log

GET audit/ returns the caller's own append-only events, newest first, 50 per page:

    {"id":"UUID","type":"auditevent","created_at":"...","action":"approval.approved",
     "entity_id":"UUID","details":{"actor_id":9,"action":"remittance.submit","target_id":"UUID"}}

details.actor_id identifies who acted (an operator's ID on operator actions against the
student's objects). No filters or detail route. Action names include
auth.step_up_granted, auth.step_up_failed, approval.requested/approved/rejected,
agent.action_confirmed/rejected, credit.snapshot_created, credit.statement_issued and
the workflow names (state.confirmed, payment.authorized, ...).

## Existing source integration

GET/POST sources/ handles metadata only.
Attach an owned source_id and evidence_note to state events.
Evidence parsing, official-site retrieval, and model extraction remain C's integration.
Confirmed in this API means student-confirmed, not independently bank-verified.

