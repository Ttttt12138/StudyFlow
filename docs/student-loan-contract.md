# Student loan flow: shared frontend/backend contract

Effective 2026-10-15. This supersedes earlier student-flow descriptions involving family funding, available funds, a computed funding gap, monthly bookkeeping or enrollment confirmation. All loans, notices and payments are simulations.

## Flow

Price lookup → compare whole-course costs → choose a school → enter a positive loan amount → choose product, term and repayment method → estimate → confirm plan and submit application → automatic simulated admission notice and approval → complete other documents → explicitly sign → scheduled school payouts → repay installments.

There is no no-loan confirmation branch. Estimates do not write wallet balances. Submission does not sign or disburse. The school payee must be verified for signing and tuition payouts.

## Inputs and responses

All planning routes use `/api/v2/`. Responses are wrapped in `data`; writes require authentication, CSRF for session clients and `Idempotency-Key`. Amounts are decimal strings. Revision conflicts return 409; an invalid loan amount returns 400.

| Route | Current contract |
| --- | --- |
| `GET planning/assessment/` | `plan`, `inputs`, `version`, `plan_version`, `draft`, `stale`, `estimate`, `products`, `limit`, `quotes`, `loan_stage`, `lifecycle`, `is_simulated`. Missing plan returns version 0 and null inputs. |
| `POST planning/assessment/` | `{expected_version, plan_version, inputs, draft}`. `inputs` contains only `borrower` and `loan`. Draft mode saves edits without creating a quote. |
| `POST planning/loan-preview/` | `{principal, months, product, method}`. Calculates installments without persisting a quote or application. |
| `POST planning/plan/confirm/` | `{expected_version, plan_version, quote_id}`. Required non-null current quote; submits application and sets the plan to `CONFIRMED` atomically. Same-key replay returns the stored result. |
| `POST planning/loan-applications/` | Lower-level compatibility submission of an existing quote. Requires the same three identifiers; retains current-quote validation and application deduplication. The student UI uses `plan/confirm/` to finalize the plan as well. |
| `POST planning/loan/documents/` | `{task_id, done, expected_version}`. Automatic notice cannot be edited (`LOAN_DOCUMENT_AUTOMATIC`). |
| `POST planning/loan/sign/` | `{application_id, expected_version}`. Requires approved application, completed documents and verified school payee. Creates school payout schedule and actual simulated loan account. |
| `GET planning/life/` | `today`, `items`, `upcoming`, `attention_count`, `unread_count`, simulation markers. No budget, funding forecast or credit line. |
| `POST planning/life/actions/` | Versioned task/bill reminder actions. Loan repayments use their original protected loan-account action. |

`loan` fields: `principal` (null until entered), `product`, `months`, `method`, `annual_rate`, `fees`, `first_due_date`. `borrower` selects student with parent co-borrower or parent borrower and changes required income proof wording; it does not create family support. Custom product offers 24/36/48-month amortization. The study-loan example adds 60 months and interest-only while studying.

Older assessment input keys (`available_funds`, `funds_currency`, `reserve`, `supports`, `repayment`, date/horizon and cost overrides) are discarded. Old stored revisions are normalized on read. Responses no longer expose `prequal`, `forecast`, `conditional_forecast` or `suggested_principal`.

The maximum principal is the catalog full-course cost converted to THB. Fees do **not** increase the cap. Unknown cost lines remain marked missing: the current conservative cap is the known total, not an assertion that missing costs are zero. Without a usable total/rate the application cannot be auto-approved. Fees must be less than principal; due dates must be valid and future. No income-based or family-funds-based affordability decision runs in this student flow.

`loan_stage.documents[]` includes `auto`. The `loan_doc:admission` item is created completed and labeled simulated at submission. Other documents remain incomplete until explicitly marked ready. There is no real offer upload or admission certification.

## State and migration

| Plan state | Student tools |
| --- | --- |
| No plan / `DRAFT` | Price lookup, comparison, school drafts and loan panel |
| `CONFIRMED` | Submitted application plus to-dos, bills, wallet, FX and remittance |

The AI asks the user to submit the loan application before wallet/FX/remittance requests. Changing school before signing cancels the unsigned application and returns to `DRAFT`; signed loans cannot change schools. Loan application/account/payout states remain separate from plan state.

Migration `0035_simplify_student_loan_flow`:

- Converts legacy `ENROLLED` to `CONFIRMED` where a submitted loan exists. Old confirmed/enrolled plans without a submitted application return to `DRAFT`, with their existing bill records retained.
- Expires outstanding `plan.enroll` and legacy `plan.confirm` proposals, completes and relabels the automatic notice, and removes open duplicate admission checklist items.
- Drops `FamilyLink`, `StudyMonthBudget`, `ExpenseEntry`, `CreditCharge`; drops available funds/currency and enrolled date fields from plans and funds fields from school drafts.
- Preserves loan applications, loan accounts, installments, payouts, bill payments, wallet balances and audit events. Historical credit-repayment ledger entries retain their original UUID in `retired_credit_charge`. Migration temporarily disables the ledger update trigger within the atomic migration solely to copy that origin, then restores it; monetary values stay unchanged.

Back up the target database before deployment because deleted feature data cannot be reconstructed by reversing the schema migration. Validation uses isolated test databases; the user's development database is not migrated by this change's test commands.

## Deletion boundary

Removed planning endpoints: `family-links/`, `in-school/`, `expenses/`, `expenses/record/`, `life/budget/`, `life/undo-expense/`, `credit/`, `credit/pay/`, `credit/repay/` (all under `planning/`). Removed conversation tools: enrollment/legacy confirmation, expense recording, spending summary and on-time profile. Removed student UI: family support/linking, credit line and independent on-time record, budget/expenses/spending analysis, enrollment gate and previously unmounted standalone modules.

Underlying legacy B/C platform APIs (readiness, consumption, copilot, sponsor operations, credit statements) remain for existing backend contracts and historical verification; they are not mounted in the student product or used to approve these planning loans. Actual loan repayment and financial audit remain supported. Old student deep links resolve to a retained panel or the conversation; `stage=school` maps to the submitted-application preview.

## Preview and verification

`python backend/manage.py test auto_test.fixture_plan_preview` records both languages through real API calls with the rule planner in Django's test database. Each stage stores its own conversation and assessment; life records are captured in the same transaction. Stages are `plan` and `prepare`. The `prepare` notice is checked and every mutation is disabled in preview.

See [verification record](verification-student-loan-20261015.md) for current results. Earlier evidence remains historical and does not establish live-model or real-money acceptance of this flow.
