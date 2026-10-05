# StudyFlow Backend API Reference

This is the concise endpoint reference for frontend and extraction-service
integration. For detailed workflow explanations, see API_GUIDE.md. The generated
machine-readable contract is openapi.yaml.

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

## Roles

| Role | Permitted operations |
|---|---|
| Student | Own state, scenarios, plans, loans, application submission, authorization, reconciliation |
| Demo operator | Mock review/decision, beneficiary verification, funding/disbursement/payment outcomes |
| Anonymous | Health endpoint only |

The operator is a controlled local simulator. AI extraction or planning components
must use student-scoped access and must never receive operator credentials.

## Response and error conventions

Workflow command/detail response:

    {"data": {"id": "UUID", "is_simulated": true, ...}}

Paginated list:

    {"count": 1, "next": null, "previous": null, "results": [...]}

| Status | Meaning |
|---|---|
| 200 | Read success or identical idempotent replay |
| 201 | New command completed |
| 400 | Invalid field, business rule, transition, or idempotency conflict |
| 401 | Missing or invalid authentication |
| 403 | Authenticated user lacks the operator/staff role |
| 404 | Record absent or owned by another student |
| 409 | Stale financial-state version |
| 503 | Database unavailable or migrations pending |

Unknown/read-only request fields are rejected instead of silently ignored.

## System and documentation

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /health/ | Public | Database and migration readiness |
| GET | /api/schema/ | Student/operator | OpenAPI schema |
| GET | /api/docs/ | Student/operator | Swagger UI |
| GET/POST | /api/auth/login/ | Session flow | Browser session login |
| POST | /api/auth/logout/ | Session flow | Browser session logout |
| GET | /admin/ | Staff | Read-only finance administration |

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
settled wallet funds, and reserve. It creates a hold but no ledger debit.

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

Returns owner-scoped action history with actor IDs and transition details.

FinancialState, AuditEvent, and DemoLedgerEntry are protected from UPDATE and DELETE
by PostgreSQL triggers.

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

See examples/workflow.http for executable request examples using the seeded demo.
