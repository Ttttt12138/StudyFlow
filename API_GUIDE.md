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
Loan sources require loan_id, exact net proceeds/currency/date from the simulation,
and certainty=estimated. Approval never makes a loan current available money.
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

## Loans and simulated applications

| Method | Route | Function |
|---|---|---|
| GET/POST | loans/ | List/create immutable loan simulations |
| GET | loans/{id}/ | Inputs and entire repayment schedule |
| POST | loans/compare/ | Compare 2-10 owned simulations without automatic ranking |
| GET/POST | applications/ | List/create a draft for one simulation |
| GET | applications/{id}/ | Application state |
| POST | applications/{id}/action/ | Student: submit or cancel |
| POST | applications/{id}/decision/ | Operator: review, approve, reject |
| GET | disbursements/ | List scheduled/processing/settled outcomes |
| GET | disbursements/{id}/ | Disbursement status |
| POST | disbursements/{id}/action/ | Operator: process, unknown, settle, fail |

Loan request:
    {
      "product_name":"Mock loan", "currency":"THB", "principal":"20000.00",
      "annual_rate_percent":"8.0000", "repayment_months":12, "grace_months":0,
      "withheld_fee":"1600.00", "disbursement_date":"2026-10-02",
      "monthly_income":null, "monthly_essential_expenses":null,
      "income_confirmed":false
    }

Fixed nominal annual percentage / 12; monthly grace interest capitalizes.
Monthly dates clamp to month end using the original disbursement day.
Last installment clears the balance exactly at the currency's precision.
Incomplete/unconfirmed income returns insufficient_information.
Otherwise the result is affordable_under_assumptions or unaffordable, not approval.

Application: draft -> submitted -> under_review -> approved/rejected.
Cancellation is allowed before decision. Approval creates a scheduled disbursement
but no ledger entry. For a new loan/date/term, create a new simulation.
Disbursement: scheduled -> processing -> settled/failed; processing -> unknown
requires status resolution. It cannot settle before its scheduled demo date.
Only THB loan simulations can be approved into this settlement demo.

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

## Existing source integration

GET/POST sources/ handles metadata only.
Attach an owned source_id and evidence_note to state events.
Evidence parsing, official-site retrieval, and model extraction remain C's integration.
Confirmed in this API means student-confirmed, not independently bank-verified.

