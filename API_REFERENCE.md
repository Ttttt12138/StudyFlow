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

For kind=loan, also send loan_id. Amount, currency, and available date must exactly
match the simulation's net proceeds and disbursement date. An undisbursed loan must
be estimated and cannot be opening funds.

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

## Loan simulations

### GET /api/v2/loans/
### GET /api/v2/loans/{id}/

List or inspect simulations and their full repayment schedules.

### POST /api/v2/loans/

Request:

    {
      "product_name": "Mock student loan",
      "currency": "THB",
      "principal": "20000.00",
      "annual_rate_percent": "8.0000",
      "repayment_months": 12,
      "grace_months": 0,
      "withheld_fee": "1600.00",
      "disbursement_date": "2026-10-02",
      "monthly_income": null,
      "monthly_essential_expenses": null,
      "income_confirmed": false
    }

Repayment months: 1-360. Grace months: 0-24.
Withheld fee must be explicit. Currency precision rules apply.

Affordability values:

- insufficient_information
- affordable_under_assumptions
- unaffordable

### POST /api/v2/loans/compare/

Request:

    {"loan_ids": ["UUID-1", "UUID-2"]}

Accepts two to ten unique owned simulations. It returns comparable totals and basis
information but no automatic recommendation.

## Simulated applications

### GET /api/v2/applications/
### GET /api/v2/applications/{id}/
### POST /api/v2/applications/

Create request:

    {"loan_id": "UUID"}

### POST /api/v2/applications/{id}/action/

Student request:

    {"action": "submit"}

or:

    {"action": "cancel"}

### POST /api/v2/applications/{id}/decision/

Operator-only:

    {"action": "review", "reason": "Explicit mock review"}

Then:

    {"action": "approve", "reason": "Demo approval only"}

or reject. Approval schedules a THB disbursement but does not change balances.

Application states:

    draft -> submitted -> under_review -> approved
                                      \-> rejected
    draft/submitted/under_review -> cancelled

## Disbursements

### GET /api/v2/disbursements/
### GET /api/v2/disbursements/{id}/

Read owned simulated disbursements.

### POST /api/v2/disbursements/{id}/action/

Operator-only requests:

    {"action": "process"}
    {"action": "unknown"}
    {"action": "settle"}
    {"action": "fail"}

States:

    scheduled -> processing -> settled
                           \-> failed
                           \-> unknown -> settled/failed

Settlement creates one credit using net proceeds. Retrying cannot add a second
ledger entry.

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
funding/disbursements; negative entries are payments. Each owner also has a
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
