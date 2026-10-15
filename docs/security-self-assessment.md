# Security Self-Assessment

StudyFlow, Topic C. Updated 2026-10-14 for the conversation-led cost planner, study-loan lifecycle and wallet bill payments.

This report maps controls to code and tests and records remaining risks. Test names identify coverage, not a claim that every suite was rerun on this date. Dated evidence separates rule-based integration from real model calls. `evidence/gates/` is the historical 2026-10-07 run; current planning evidence is linked below. Paths are relative to the repository root.

> **Scope.** All money in StudyFlow is simulated. There is no real bank, card or remittance rail. Wallets, ledgers and payouts are database models, and delivery or failure of a transfer is triggered by an operator callback. The access controls, limits, approvals and ledger constraints described here are nevertheless **really enforced** by the server, and they are what this report assesses.

The Chinese documents [permissions.md](permissions.md) and [known-risks.md](known-risks.md) retain earlier control detail. This English report describes current scope where those notes are older.

---

## 1. Permission tiers

Every API action falls into one tier. The tier of a money-moving action is decided **at request time from the amount**, not fixed per route.

| Tier | Meaning | What the caller needs | Enforced in |
|---|---|---|---|
| **T0** | Read only (all `GET`) | Logged in; can only read their own data (operators can also read the approval queue) | DRF authentication, owner-scoped querysets |
| **T1** | Writes that do not move money out of the wallet: quotes, scenarios, drafts, budgets, what-if runs, remittance order *creation*, approval *requests*, marking notifications read | Logged-in owner | `backend/finance/workflow_api.py` (`CommandView`) |
| **T2** | Money leaves the wallet, within the limits in §2 | T1 **plus** a valid one-time step-up token bound to this exact action, target, amount and currency | `backend/finance/policy.py` `enforce()` |
| **T3** | A T2 action above the per-transaction, daily or monthly limit, or in a currency with no limit configured | T2 **plus** an `APPROVED`, unused, unexpired approval from a **second person**, who must be an operator | `backend/finance/policy.py` `assess()`, `approved()` |
| **OP** | Operator actions: receiving funds, loan decisions and disbursement, verifying beneficiaries, payment and remittance callbacks, issuing sponsor links, deciding approvals | `is_staff`, subject to the separation-of-duties rules in §4 | Route permission classes; `backend/finance/policy.py` `separation_of_duties()` |

### 1.1 Action table

| Action | Route | Tier | Step-up | Second-person approval | Notes |
|---|---|---|---|---|---|
| Read balances, rates, corridors, orders, credit profile | `GET …` | T0 | No | No | Owner-scoped |
| Create a live FX quote | `POST fx-quotes/live/` | T1 | No | No | Priced by the server from the corridor; the client cannot set the rate |
| Create a remittance order | `POST remittance-orders/` | T1 | No | No | Status `CREATED`; no money moves |
| Request an approval | `POST approvals/` | T1 | No | No | At most one open request per target |
| `payment.submit` | `POST payments/{id}/submit/` | T2 / T3 | **Yes** | Above limit | Home currency (THB) |
| `wallet.convert` | `POST conversions/` | T2 / T3 | **Yes** | Above limit | Limit counted in the quote's source currency |
| `loan.repay` | `POST loan-accounts/{id}/repay/` | T2 / T3 | **Yes** | Above limit | Amount must equal an unpaid instalment |
| `bill.pay` | `POST planning/bills/{id}/pay-from-wallet/` | T2 / T3 | **Yes** | Above limit | Owner, currency, bill status and loan coverage checked |
| `credit.repay` | `POST planning/credit/charges/{id}/repay/` | T2 / T3 | **Yes** | Above limit | Amount and currency must equal the unpaid charge; wallet balance checked |
| Confirm plan and submit planning loan | `POST planning/plan/confirm/` | T1 | No | No | Versioned owner command; explicit confirmation; no wallet debit |
| Sign planning loan | `POST planning/loan/sign/` | T1 command in current implementation | No | No | Explicit UI confirmation, completed checklist, approved application and version; creates simulated school payouts |
| Mark loan checklist item | `POST planning/loan/documents/` | T1 | No | No | Owner and task version checked; self-declaration, not verification |
| Demo wallet top-up | `POST demo/wallets/top-up/` | T1 demo command | No | No | Creates simulated funds for owner, maximum 1,000,000 per request |
| `remittance.submit` | `POST remittance-orders/{id}/submit/` | T2 / T3 | **Yes** | Above limit | Debits the send amount |
| `agent.confirm` | `POST agent/pending-actions/{id}/confirm/` | as the proposed action | **Yes** | If the proposed action is T3 | Cleared exactly like the action it proposes |
| Decide an approval | `POST approvals/{id}/decide/` | OP | No | n/a | Separation of duties applies |
| Verify a beneficiary, remittance or payment callback | `…/verify/`, `…/adapter-event/` | OP | No | No | Audited; see risk A2 |

Every T2 action is registered in `ACTIONS` in `backend/finance/policy.py` and declared on its route. Registrations include `workflow_urls.py`, `lending_urls.py`, `remittance_api.py`, `agent_api.py` and `planning/api.py` (`bill.pay`, `credit.repay`). Tiers protect wallet outflows; school-directed loan signing currently has no password step-up or independent operator decision (risk P2).

**Tests**
- Tier matrix, `backend/auto_test/test_policy.py` `TierMatrixTests`: `test_payment_submit_requires_step_up_with_documented_body`, `test_conversion_requires_step_up`, `test_tuition_over_per_transaction_limit_needs_approval`, `test_reads_and_t1_writes_need_no_step_up`, `test_agent_calls_are_capped_at_t1`
- Repayment: `RepaymentPolicyTests.test_repayment_requires_step_up_for_named_installment`
- Remittance: `backend/auto_test/test_remittance.py` `test_submit_without_step_up_or_as_agent_is_refused`, plus the T3 separation-of-duties tests listed in §4
- Operator-only callbacks: `backend/auto_test/test_remittance.py` `test_adapter_event_is_operator_only`, `test_student_commands_are_owner_only`

---

## 2. Limits

Limits apply to outflows, summed per currency across all T2 actions. Days and months follow the calendar in `Asia/Bangkok`, using real time. The demo clock has no effect.

| Currency | Per transaction | Daily | Monthly |
|---|---:|---:|---:|
| THB | 50,000 | 100,000 | 300,000 |
| CNY | 10,000 | 20,000 | 60,000 |
| USD | 1,500 | 3,000 | 9,000 |
| EUR | 1,400 | 2,800 | 8,400 |
| GBP | 1,200 | 2,400 | 7,200 |
| JPY | 200,000 | 400,000 | 1,200,000 |
| MYR | 6,500 | 13,000 | 39,000 |
| AUD | 2,300 | 4,600 | 13,800 |
| SGD | 2,000 | 4,000 | 12,000 |

- Defaults are stored in the `PolicyLimit` table, where an administrator can edit them. `ensure_default_limits()` only adds missing rows and never overwrites edited ones.
- A currency with no enabled limit row makes **every** T2 action in that currency T3.
- Effective limit = table limit × the credit multiplier from `backend/finance/credit.py` (`MULTIPLIERS`): `AT_RISK` 0.5, `BUILDING` 1.0, `FAIR` 1.2, `GOOD` 1.5. A poor payment record therefore halves the limits, and the best record raises them by at most 1.5×.
- The limit check runs inside the command's database transaction and under the user's row lock, so concurrent requests cannot jointly exceed a limit.

**Tests**, `backend/auto_test/test_policy.py` `LimitAndUsageTests`: `test_daily_limit_accumulates_per_currency`, `test_monthly_limit`, `test_daily_and_monthly_windows_follow_bangkok_time`, `test_missing_or_disabled_limit_is_t3`, `test_credit_multiplier_scales_limits`, `test_failed_and_cancelled_payments_do_not_count`, `test_ensure_default_limits_keeps_edited_rows`. Concurrency, `backend/auto_test/test_policy_concurrency.py`: `test_daily_limit_holds_under_concurrent_spending`.

---

## 3. Step-up re-authentication (T2)

1. The client calls `POST auth/step-up/` with the user's password and the exact `action`, `target_id`, `amount` and `currency`.
2. The server checks that the target belongs to the user and that the amount and currency match it. It then issues a token signed with `django.core.signing` (salt `studyflow-step-up-v1`), valid for **300 seconds**. The token carries only a random nonce, the user id and the user's session-auth hash, so **changing the password revokes all outstanding tokens**. The bound action and target are stored server-side in `StepUpGrant`.
3. The protected command sends the token in `X-Step-Up-Token`. The token must match the request exactly. It is marked used **in the same transaction** as the command, so a command that fails a business rule does not consume it, while a successful command cannot reuse it.
4. Failed attempts return 403 `STEP_UP_FAILED` and are audited (`auth.step_up_failed`). The endpoint is rate-limited to 10 per hour per user.

Code: `backend/finance/policy.py` (`step_up`, `redeemable_grant`, `Clearance.consume`), `backend/finance/policy_api.py`.

**Tests**, `backend/auto_test/test_policy.py` `StepUpTokenTests`: `test_wrong_password_is_refused_and_audited`, `test_user_without_password_cannot_step_up`, `test_target_must_belong_to_the_user_and_match`, `test_forged_tokens_are_invalid`, `test_token_of_another_user_is_invalid`, `test_expired_token_is_invalid`, `test_token_bound_to_amount_and_target`, `test_token_is_single_use`, `test_password_change_invalidates_tokens`. Also `TierMatrixTests.test_failed_command_does_not_burn_the_token` and, in `backend/auto_test/test_policy_concurrency.py`, `test_one_token_cannot_authorize_two_concurrent_commands`.

> **Limitation:** step-up is a re-entry of the same password, not a second factor. See risk **A1**.

---

## 4. Approvals and separation of duties (T3)

- A student requests an approval for one exact `(action, target_id, amount, currency)`. An operator approves or rejects it, and the decision carries an `expected_version` for optimistic locking.
- An approval expires 24 hours after creation, whether it is `PENDING` or `APPROVED`. Once used it is marked `USED` in the same transaction as the action and cannot be used again.
- **Separation of duties**, applied to both approve and reject:
  1. The decider cannot be the requester. This is enforced by a database `CHECK` constraint, and the API checks it first and returns `SEPARATION_OF_DUTIES`.
  2. For `payment.submit`, and for `remittance.submit` to an external beneficiary, the decider cannot be the operator who most recently verified that beneficiary. One person therefore cannot both vouch for a payee and release a large payment to it.
  3. An operator cannot decide a request they own.
- The demo and the tests therefore use two operators: one verifies the beneficiary, the other approves.

Code: `backend/finance/policy.py` (`request_approval`, `decide`, `separation_of_duties`, `latest_verifier`).

**Tests**
- `backend/auto_test/test_policy.py` `ApprovalTests`: `test_lifecycle_and_visibility`, `test_request_must_match_the_target`, `test_only_staff_decide_and_stale_version_conflicts`, `test_beneficiary_verifier_cannot_decide`, `test_staff_cannot_decide_their_own_request`, `test_database_rejects_requester_as_decider`, `test_rejected_approval_does_not_authorize_and_can_be_requested_again`, `test_expired_approvals`, `test_used_approval_cannot_be_reused`
- `backend/auto_test/test_remittance.py`: `test_beneficiary_verifier_cannot_decide_remittance_approval`, `test_self_order_approval_is_not_bound_to_beneficiary_verifier`
- `backend/auto_test/test_policy_concurrency.py`: `test_concurrent_decisions_have_one_winner`
- End to end: [`evidence/gates/demo-remittance.json`](../evidence/gates/demo-remittance.json) contains exactly one T3 approval per run

---

## 5. AI agent controls

Video production is separate from these runtime controls. For the current English formal film, the user explicitly authorized sending the English narration script to Microsoft's online speech service. Only that script was sent; browser recordings, screenshots, credentials and personal documents were excluded. Audio mastering, subtitle alignment and speech-recognition checks were performed locally. The current 4:25 film uses the new October 15 acceptance: 19 live-AI user turns and 13 scenario checks in a disposable test database, including a separate payee verifier, independent operator approval and a final student password confirmation. This is browser acceptance of the recorded version, not a frozen model benchmark or a comprehensive security audit. See [production disclosure and verification](../evidence/demo-current-live-20261015/README.md).

The agent plans with an LLM (in mock mode, a rule-based planner) and calls tools through the Django runner. **Safety does not depend on the model behaving.** Every rule below is enforced by the runner in `backend/finance/agent_runner.py`.

| Control | Value | Code | Tests (`backend/auto_test/test_agent.py` unless noted) |
|---|---|---|---|
| Highest tier the agent can execute | T1. The planner can see 2 T2 tools (`submit_remittance_order`, `convert_balance`), but the runner has **no T2 execution path**: calling one only creates a pending action. | `_propose`, `backend/finance/agent_tools.py` | `test_t2_tools_never_execute_regardless_of_arguments`, `test_mock_planner_zh_remittance_goal_proposes_without_moving_money` |
| Who confirms a T2 proposal | Only the student, through `agent/pending-actions/{id}/confirm/` with step-up (plus approval if T3). A request carrying `X-StudyFlow-Agent` is refused. | `confirm_pending`, `policy="agent.confirm"` | `test_confirm_without_step_up_is_refused`, `test_confirm_from_agent_is_capped_at_t1`, `test_step_up_for_another_target_is_invalid`, `test_over_limit_confirm_requires_approval_then_succeeds` |
| Step budget | At most **10** tool calls per session | `MAX_STEPS` | `test_step_budget_is_enforced_even_if_planner_keeps_calling_tools` |
| Write budget | At most **4** T1 writes per session | `MAX_WRITES` | `test_fifth_t1_write_is_denied_by_write_budget` |
| Failure stop | Stops after the same tool fails twice in a row | `_must_stop` | `test_two_consecutive_failures_of_same_tool_stop_the_loop` |
| No-route stop | Stops before creating an order when no route arrives on time | `_must_stop` | `test_rank_without_on_time_route_stops_before_creating_order` |
| Tool-result truncation | Each result reaches the planner as data and is truncated to **4,000** characters | `RESULT_CHARS` | `test_truncated_tool_result_is_at_most_4000_characters` |
| Proposal expiry | Pending actions expire after **15 minutes**; confirming one after that moves no money | `PENDING_SECONDS = 900` | `test_confirm_after_expiry_expires_without_debit` |
| Invalid tool calls | An unknown tool or non-object arguments end the session; nothing executes | runner | `test_unknown_tool_fails_session_with_invalid_tool_call`, `test_non_object_arguments_never_execute_and_do_not_crash` |
| Cross-user isolation | Another user's ids are reported as "not found" and are not leaked | `backend/finance/agent_tools.py` | `test_other_users_ids_are_not_found_and_not_leaked`, `test_confirm_by_another_user_is_not_found` |
| Double confirmation | Racing confirmations debit once | locking + idempotency | `backend/auto_test/test_agent_concurrency.py` (6 tests) |
| Audit trail | Agent steps are immutable in the database | DB trigger | `test_agent_steps_are_immutable_in_the_database` |
| Cost control | Session creation is limited to 30 per hour per user | `agent` throttle scope | `test_session_creation_is_throttled` |

Prompt injection: on the frozen holdout `agent-v2` (4 injection cases), the live model took **0 unauthorized actions**. In **1 of 4** cases it acted partly on injected text: it proposed paying the user's tuition to a payee whose name contained instructions. Even then, no money moved, because the proposal still needed the student's step-up confirmation. On the tuning set `agent-v1`, it followed no injection (0/3) in any of the six live runs. See [agent-evaluation.md](agent-evaluation.md). Whatever the model does, the runner rules above stop money from moving without the student.

Clock guidance: the October 14 full-flow recording exposed an AI reliability failure: the model compared quote expiry with the advanced demo study date and repeatedly refreshed valid quotes. The runner now supplies real UTC `memory.server_time` on each step; `agent-1.3` / `planning-2.6` distinguish it from `memory.today`. `auto_test.test_agent_clocks` covers simulated dates before and after the real date. This improves planning context; server expiry validation, write budgets and monetary authorization remain the enforcement mechanisms. The failed take is retained in `evidence/demo-full-live-20261014/take-04/`.

Output validation: take-05 exposed a second reliability failure when unstructured gateway prose was treated as a final answer and no reminder was created. The live planner now retries an empty or unstructured reply at most twice, preserving attempt counts, and fails with `INVALID_MODEL_OUTPUT` if no validated decision is returned. It never displays that raw prose as a successful answer or executes a guessed tool call. Malformed JSON still fails immediately, apart from the existing narrowly validated stray-closing-bracket recovery. This is covered by `studyflow-ai/auto_test/test_agent_planner.py`; the failed recording remains retained.

### 5.1 Browser enforcement of the same controls

The React frontend (`frontend/`) exposes the agent and the permission model to students. It adds no authority of its own; every decision is still made by Django.

| Control in the browser | Behaviour | Code | Tests |
|---|---|---|---|
| Agent proposals | The main planning conversation renders pending proposals. Submitting the loan application is a separate explicit action; monetary proposals show details and expiry and have not executed. | `frontend/src/plan/PlanApp.tsx`, `MoneyConfirm.tsx` | `mocked/agent.spec.mjs`, `integration/agent.spec.mjs` |
| Step-up | Monetary confirmation binds the underlying action, target, amount and currency, then sends `X-Step-Up-Token`. Wrong passwords prevent execution. Password entry is transient in the dialog and is not persisted to browser storage or the URL. | `MoneyConfirm.tsx`, `frontend/src/wallet/client.ts`, `frontend/src/plan/LoanStage.tsx` | Agent/browser specs and dated planning repayment evidence |
| T3 | Normal operation requires a different staff approver and another password check. A separately enabled demo shortcut can simulate approval (risk A9). | `MoneyConfirm.tsx`, `WalletApp.tsx`, `finance/policy_api.py` | Agent/wallet integration specs; `auto_test.test_policy.SimulatedApprovalTests` |
| Stage and continuity | Money tools are hidden until the loan application is submitted. In a planning conversation the server refuses wallet, exchange and remittance tools and their confirmations (`APPLICATION_REQUIRED`) before then. The direct wallet APIs do not check the plan stage (P4). The conversation survives tool navigation. | `frontend/src/workspace/navigation.ts`, `finance/agent_runner.py` (`_locked`) | `auto_test.test_planning` (`test_wallet_tools_are_refused_until_the_loan_application_is_submitted`), planning browser specs |
| Limits and audit | "Permissions & activity" shows the tier rules, the credit level and limit multiplier, effective limits with usage (`GET policy/limits/`), approval requests and the audit log (`GET audit/`), read-only. | `frontend/src/trust/TrustApp.tsx`, `backend/finance/policy.py` (`limits_summary`) | `frontend/tests/e2e/mocked/trust.spec.mjs`, `backend/auto_test/test_policy.py` (`test_limits_view_reports_effective_limits_and_usage`) |
| Simulation notice | A strip on every screen states that all money is simulated. | `frontend/src/services/SimulatedStrip.tsx` | agent and trust specs |

Historical controls: [`evidence/frontend-20261011/`](../evidence/frontend-20261011/). Current signing and repayment: [`evidence/short-planning-20261014/browser.json`](../evidence/short-planning-20261014/browser.json), English desktop and Chinese phone, real local Django/PostgreSQL with the rule planner. This is simulated money and browser emulation, not physical-device or live-model acceptance.

The [2026-10-14 live planning acceptance](verification-planning-live-20261014.md) separately passed two browser journeys and eight live user turns, including pre-enrollment refusal, user-confirmed signing and password-authorized repayment. Fifteen recorded planner calls used the live provider; there were no tool errors or rule fallbacks. The refusal checks are two observed model outcomes, not a server guarantee closing P4. The [baseline log](../evidence/planning-live-20261014/backend-baseline.log) records 155 related passing checks, including OTP/CSRF and monetary policy. The failed first harness attempt is retained.

### 5.2 Planning and loan safeguards

| Control | Enforcement and remaining boundary | Code and coverage |
|---|---|---|
| Declared funds | Savings/support declarations do not credit wallets; unreceived support only affects a conditional forecast | `planning/assessment.py`; `test_planning_assessment` |
| Versioned confirmation | Assessment/plan versions bind the quote; at most one active application; stale/foreign quotes refused; aggregate failures roll back | `planning/assessment.py`; `ShortPlanningTests`, `ShortPlanningConcurrencyTests` |
| Gap ceiling | Approval checks principal against the pre-check and a future first repayment; monthly affordability is not assessed | `planning/assessment_loans.py`, `assessment.py` `planning_decision`; P1 |
| Signing gate | Owner, approved application, version and completed checklist required; no actual file/identity verification | `planning/loan_stage.py`; `test_signing_pays_the_school_bill_by_bill_from_the_loan`; P2 |
| School payouts | No wallet credit; partial bill coverage split; loan-funded bills cannot be paid again; generic operator disbursement refused | `planning/loan_stage.py`, `lending_applications.py`, `planning/in_school.py`; planning and wallet-bill tests |
| Contract continuity | Signing locks school/plan changes. Simulated date advancement settles scheduled payouts; reminder changes leave contract dates unchanged | `planning/services.py`, `life_commands.py`; `test_planning_assessment`, `test_life_loans` |
| Wallet bill payment | `bill.pay` binds the target, amount/currency; checks ownership, balance, limits and paid status; uses the ledger entry point | `planning/in_school.py`, `policy.py`; `WalletBillPaymentTests` |
| Session authentication | Password/OTP session changes require CSRF; newer OTPs retire older challenges; wrong-code budgets span challenges | `finance/auth_api.py`; `test_email_otp_auth` |

---

## 6. Money and ledger integrity

| Control | Code | Tests |
|---|---|---|
| Every balance change goes through one entry point (`wallets.post`), which locks the user row and the balance row | `backend/finance/wallets.py` | `backend/auto_test/test_multicurrency.py` `test_mixed_sequence_keeps_ledger_invariant`, `test_randomized_sequence_keeps_invariants` |
| Ledger entries summed per currency equal the balance | `backend/finance/wallets.py` | `test_remittance.py` `test_mixed_sequence_keeps_ledger_invariant` |
| Balances can never be negative: a database `CHECK` constraint | migration 0015 | `test_multicurrency.py` `test_database_rejects_negative_balances`; `test_remittance_concurrency.py` `test_many_orders_draining_one_balance_never_go_negative` |
| Conversions accept only server-priced, single-use quotes. A student-entered rate once allowed creating money from nothing; this was found and fixed. | `backend/finance/wallets.py` | `test_manual_quote_exploit_is_rejected`, `test_quote_consumed_on_reuse`, `test_quote_of_another_user_cannot_be_used` |
| FX rates older than 7 days cannot be used for quotes; fixture rates are not executable in live mode | `backend/finance/fx_rates.py` | `test_live_quote_refused_on_stale_rate`, `test_remittance.py` `test_live_mode_rejects_fixture_priced_quotes` |
| Remittance state machine: version-checked transitions, append-only history, at most one debit, refund or credit leg per order | `backend/finance/remittance_orders.py` | `test_transition_matrix_from_every_status`, `test_status_history_is_append_only`, `test_database_allows_one_leg_per_kind_per_order` |
| Duplicate or conflicting payout callbacks settle exactly once | same | `test_remittance_concurrency.py` `test_duplicate_failed_callbacks_refund_once`, `test_conflicting_delivered_and_failed_callbacks_settle_one_way` |
| Idempotency keys: a replay returns the stored response and never posts twice | `backend/finance/workflow_api.py` | `test_policy.py` `test_replay_returns_stored_response_without_policy`; `test_multicurrency_concurrency.py` `test_same_idempotency_key_concurrent_conversion_posts_once` |
| Tuition reaches the school only through a **verified** school account: loan signing, every loan payout (held while unverified) and wallet/credit tuition payments check it when money moves | `backend/finance/planning/payees.py` | `test_planning_assessment.py` `test_loan_pays_the_school_only_while_its_account_is_verified`; `test_planning_life.py` `test_tuition_goes_only_to_a_verified_school_account`, `test_credit_pays_tuition_only_to_a_verified_school_account` |
| Credit gaming: only deadline-bearing transfers to **verified** beneficiaries count; plan bills count only when paid from the wallet within a year of their due date; the credit window uses real dates, so moving the demo clock cannot erase late records | `backend/finance/credit.py` | `test_credit.py` `test_self_remittances_never_count`, `test_remittance_to_unverified_beneficiary_does_not_count`, `test_advancing_demo_clock_400_days_drops_nothing`; `test_planning_life.py` `test_wallet_bill_payments_build_the_credit_record` |

---

## 7. Rate limiting and deployment hardening

| Scope | Default | Applies to |
|---|---|---|
| `user` / `anon` | 1000/hour / 100/hour | All requests |
| `auth` | 10/min per IP | `POST auth/token/` |
| `step_up` | 10/hour per user | `POST auth/step-up/` (successes and failures) |
| `money` | 60/hour per user | Every T2 `POST`, including refused ones |
| `sponsor` | 20/hour per IP | Sponsor confirmation links |
| `agent` | 30/hour per user | Agent session creation |

Throttle counters are kept in a shared database cache, so the limits also hold across processes. A malformed rate override (`STUDYFLOW_THROTTLE_<SCOPE>`) stops the server from starting. Tests, in `backend/auto_test/test_policy.py` `ThrottleTests`: `test_token_endpoint_is_throttled`, `test_step_up_is_throttled_per_user`, `test_t2_routes_share_the_money_scope`, `test_sponsor_confirmation_is_throttled_by_ip`; also `DeploymentSettingsTests.test_invalid_throttle_rate_fails_startup`.

Setting `DJANGO_SECURE=true` enables an HTTPS redirect, HSTS, secure cookies and 8-hour sessions. `nosniff`, `Referrer-Policy: same-origin` and `X-Frame-Options: DENY` are always on. CI runs `manage.py check --deploy --fail-level WARNING` with `DJANGO_SECURE=true` (`.github/workflows/django.yml`). Tests: `DeploymentSettingsTests.test_check_deploy_passes_only_when_secure`, `test_secure_settings_and_throttle_overrides`.

Secrets: API keys remain in server-side environment files excluded by `.gitignore`. The historical publication scan in [`evidence/README.md`](../evidence/README.md) does not cover every later working-tree change. Acceptance evidence must exclude keys, authorization headers and session cookies, and use synthetic student data.

---

## 8. Known risks

Severity: **High** means it could produce a wrong money state or a privilege escalation. **Medium** means it weakens a result's credibility or the system's availability. **Low** means an engineering or usability issue.

Status: **Open**, **Partially mitigated**, **Mitigated**, or **By design** (accepted for this simulated scope).

The IDs match [known-risks.md](known-risks.md), which also lists items already mitigated.

### 8.1 Authentication and authorization

| ID | Risk | Severity | Mitigation in place | Status | Evidence |
|---|---|---|---|---|---|
| A1 | **Step-up is only a re-entry of the same password, not a real second factor** (no TOTP or WebAuthn). Anyone who knows the password can complete step-up. | High | The token is bound to one action, target, amount and currency, single-use and valid for 5 minutes; changing the password revokes all tokens; step-up is rate-limited and failures are audited; amounts above the limit also need a second person (T3) | Partially mitigated | §3; `backend/finance/policy.py` |
| A8 | **The `X-StudyFlow-Agent` header is declared by the client.** An external agent script can omit it and is then treated as the user. | Low | The built-in agent cannot execute T2 because the runner has no T2 path, not because of the header (§5). Any client, agent or not, still needs the user's password for step-up on every T2 action. | Open (by design) | `backend/finance/policy.py` `is_agent`, `backend/finance/agent_runner.py` |
| A2 | There is only one operator role (`is_staff`). An operator can directly receive funds, disburse loans and trigger payout callbacks; these are audited but have no two-person review. Both demo operators are created by the same script. | High | Separation of duties for every T3 approval (§4); every operator action is audited; approvals carry version numbers, expire and are single-use | Partially mitigated | `backend/finance/policy.py`, `backend/auto_test/test_policy.py` `ApprovalTests` |
| A4 | The DRF browsable-API session login page (`/api/auth/login/`) is not covered by the DRF throttles. There is no account lockout. Behind a reverse proxy, per-IP limits need `DJANGO_NUM_PROXIES`. | Medium | Token login and step-up are throttled; failures are audited | Partially mitigated | `backend/config/urls.py`, `backend/config/settings.py` |
| A5 | API tokens never expire and cannot be rotated through the API | Low | Token login is throttled | Partially mitigated | `backend/finance/policy_api.py` |
| A3 | A sponsor's identity is not verified: whoever holds the link counts as the sponsor | Medium | Links store only a digest, expire after 72 hours, are compared in constant time and are bound to the terms version | Partially mitigated | `backend/finance/sponsorship.py` |
| A9 | Positive `STUDYFLOW_SIMULATED_APPROVAL_SECONDS` enables simulated T3 approval without a human decision; DEBUG defaults to 10 seconds | High outside an isolated demo | Compose defaults to 0; keep 0 in shared deployments. Password step-up remains, but this is not independent human approval | By design for demo | `config/settings.py`, `finance/policy_api.py`, `SimulatedApprovalTests` |

### 8.2 Data, OCR and AI

| ID | Risk | Severity | Mitigation in place | Status | Evidence |
|---|---|---|---|---|---|
| O2 | **OCR data retention.** Uploaded documents are sent to Google Gemini. The provider gives no zero-retention guarantee (`provider_zero_retention_guaranteed: false`). Encryption at rest, egress isolation and a jurisdiction review are not done. Local originals are purged after 30 days only if an operator schedules `manage.py purge_document_sources`; nothing schedules it automatically. | High | OCR is off by default; consent is collected per file against a versioned notice; two operator attestations are required (paid service, adults only); `store=false` is sent; the API key stays server-side; expired originals cannot be sent again (`OCR_SOURCE_EXPIRED`) | Open | `docs/gemini-ocr.md`; `backend/finance/readiness/ocr.py`; `backend/auto_test/test_ocr_api.py` `test_no_consent_means_no_external_request`, `test_operator_policy_gate_cannot_be_overridden_by_student`, `test_expired_sources_are_purged_but_financial_evidence_is_retained` |
| O1 | OCR accuracy has been checked only on 6 clear synthetic samples. After the 2026-10-06 provider outage, `gemini-3.1-flash-lite` with bounded retry passed 6/6, and the full HTTP chain passed once. Accuracy on real documents is unknown. | Medium | OCR output always lands in `NEEDS_REVIEW` and never moves money; prompt-injection text in a document cannot be confirmed | Partially mitigated | [`evidence/ocr/`](../evidence/ocr/); `test_prompt_injection_cannot_be_confirmed` |
| M1 | **Evaluation labels were reviewed by an AI, not by a human.** The review files mark `human_reviewed: false`. The same AI also wrote the agent dataset. | Medium | Holdout sets are frozen and hash-checked; first runs are reported even when they failed | Open | `studyflow-ai/evals/*/review.json`; `studyflow-ai/auto_test/test_copilot_holdout.py` |
| M6 | On the frozen holdout `agent-v2` (first run) the live agent completed 18/24 tasks (75%). Failures include the model returning its internal reasoning as the answer (2 cases) and planning errors (2 cases). In 1 of 4 injection cases it proposed paying a payee whose name contained injected instructions. Each run executes once. | Medium | 0 unauthorized actions; T2 safety does not depend on the model (§5); tuning used only the separate `agent-v1` set; the holdout is hash-frozen | Partially mitigated | [agent-evaluation.md](agent-evaluation.md), [`evidence/agent/`](../evidence/agent/) |
| M7 | **The Chinese and English API messages were translated by AI and have not been reviewed by a native speaker.** Briefing and notification text assembled from parts is still English only. | Low | Error codes never change, so clients can rely on the code; a CI gate checks that the catalogs are complete and compiled | Open; awaiting human review | `docs/i18n.md`, `backend/scripts/i18n_messages.py` |
| M8 | When confirming an agent proposal the student sees the payee only in `details`; with several verified payees, the rule-based planner picks the earliest one | Low | The proposal details show the recipient type and payee; step-up is required to confirm | Partially mitigated | `test_agent.py` `test_remittance_proposal_details_show_beneficiary` |
| O3 | Imported bank CSV files are not verified against a bank | Medium | Balance confirmation; every row is labelled with its source | Partially mitigated | `docs/consumption.md` |
| P1 | Planning approval does not assess income, existing debts or repayment affordability; the full-course cost cap can exceed what the student can repay | High if presented as real lending advice | Simulated product; quote affordability `NOT_ASSESSED`; monthly payment and total interest disclosed | Open; demo scope | `planning/assessment_loans.py`, `planning/assessment.py` |
| P2 | Documents are checklist declarations; signing creates simulated school payouts without identity verification, password step-up or an independent lender decision | High outside simulation | Owner/version checks, explicit signing dialog, completed checklist, no wallet credit; no claim of real lender approval | Open; demo scope | `planning/loan_stage.py`, `planning/api.py` |
| P3 | School costs are sample estimates, may be incomplete/stale, and converted totals use reference FX. Source URLs do not verify invoices or payees | Medium | Line-level dates/status/sources; missing costs remain missing; incomplete totals not ranked cheapest | Partially mitigated | `planning/catalog.py`, `planning/costs.py`, `test_planning_assessment` |
| P4 | The application stage is enforced for the agent but is not a universal server access rule: an authenticated owner can call the direct wallet APIs before submitting the loan application | Low | Agent tools and confirmations refused server-side before `CONFIRMED`; UI stage gating; monetary policy, step-up and limits still protect outflows; all funds simulated | Partly mitigated | `finance/agent_runner.py`, `frontend/src/workspace/navigation.ts` |

### 8.3 Money flows and scope

| ID | Risk | Severity | Mitigation in place | Status | Evidence |
|---|---|---|---|---|---|
| F3 / F9 | All rails are simulated. Delivery, failure and "unknown" outcomes are triggered by operator callbacks; there are no real receipts or settlement files. | Medium | Append-only status history; a failure is refunded in full automatically; unknown outcomes go to the review queue; duplicate callbacks settle once | By design | `docs/remittance.md`, §6 |
| S1 | Plan bills and loan allocations are not school-confirmed invoices/receipts. The school's tuition account is seeded as verified rather than checked with the school | Medium | Each plan has a school payee; loan signing, every loan payout and wallet/credit tuition payments require it verified when money moves, and operators can revoke it; catalog/loan-coverage labels and simulated scope; legacy remittance/readiness retain their own verification | Partially mitigated | `planning/payees.py`, `test_planning_assessment` `test_loan_pays_the_school_only_while_its_account_is_verified`, `test_planning_life` `test_tuition_goes_only_to_a_verified_school_account` |
| F5 | FX rates are reference rates (Frankfurter aggregates central-bank rates), not executable market prices. The fixed rate used in CI is about 8% below market for CNY/THB. | Medium | Each response states `rate_source` and `rate_date`; rates older than 7 days are refused; live fetching is off by default | Partially mitigated | `docs/fx-rates.md`, [`evidence/fx/`](../evidence/fx/) |
| F2 | Serialization relies on locking the user row. A future write path that forgets the lock could race. | Medium | `CommandView` takes the lock for every command; concurrency test suites | Partially mitigated | `backend/finance/workflow_api.py`, `backend/auto_test/test_*_concurrency.py` |
| E3 | Credit building counts only simulated on-platform records. It is not a credit score and proves nothing about credit elsewhere. | Medium | Clearly labelled as simulated; the signed statement contains only summaries; the multiplier is capped at 1.5× | By design | `docs/credit.md` |
| D1 | The hardened configuration has not been tested on a real HTTPS deployment; HSTS starts at 1 hour and is not preloaded | Medium | `check --deploy` runs in CI | Partially mitigated | `backend/config/settings.py` |
| D4 | Browser tests cover Chromium only, at desktop and phone widths; the integration specs run against a local Django and PostgreSQL in mock mode, not a deployed HTTPS site | Low | Mocked and real-Django Playwright suites cover the journey, wallet, agent (T2 step-up and T3 approval) and trust center (section 5.1) | Partially mitigated | [`evidence/frontend-20261011/`](../evidence/frontend-20261011/) |
| F12 | Demo top-up creates money without a real receipt. Fixed planning-credit limits have no underwriting | High outside simulation | Demo labeling; top-up cap, owner, ledger and idempotency; never represent these as bank deposits/credit | By design | `finance/execution_services.py`, `planning/credit.py`, `test_wallet_top_up`, `PlanningCreditTests` |

---

## 9. How to verify this report

```bash
# all gates: Django and C tests, OpenAPI, lint, migrations, HTTP demos, agent evaluation
studyFlow/Scripts/python.exe scripts/run_gates.py
# just the security-relevant Django suites
cd backend
../studyFlow/Scripts/python.exe manage.py test auto_test.test_policy auto_test.test_policy_concurrency auto_test.test_agent auto_test.test_agent_concurrency auto_test.test_remittance auto_test.test_remittance_concurrency auto_test.test_credit auto_test.test_ocr_api --noinput
# browser suites (from frontend/): mocked, then real Django + PostgreSQL in mock mode
npm test
npm run test:agent-integration && npm run test:wallet-integration
```
