# Remittance Orders

A student can send money out of one currency balance in the wallet along a configured corridor: to themselves (credited to their own balance in the target currency on arrival), or to a verified beneficiary (such as a school or a family account at home). Orders have a full state machine, a fee breakdown, per-corridor minimum and maximum amounts, and the T2/T3 checks from the permission tiers. All money and channels are simulated.

Difference from [conversion between own balances](multi-currency.md): a conversion completes instantly; a remittance is a cross-border transfer with a settlement period that can fail or end in an unknown state and must be tracked step by step.

## State machine

```
CREATED ──submit──▶ SUBMITTED ──dispatched──▶ IN_TRANSIT ──delivered──▶ DELIVERED ──reconcile──▶ RECONCILED
   │                    │  └──delivered──────────────────────────────▶ DELIVERED
   ├─cancel─▶ CANCELLED  ├──failed──▶ REFUNDED (returned in the source currency)
   └─(quote expired)─▶ EXPIRED └──unknown──▶ UNKNOWN ──delivered/failed──▶ DELIVERED / REFUNDED
                         IN_TRANSIT can also go failed / unknown
```

| Action | From | To | Who |
|---|---|---|---|
| Create | — | CREATED | Student (T1) |
| `cancel` | CREATED | CANCELLED | Student |
| `submit` | CREATED | SUBMITTED | Student (T2 `remittance.submit`; T3 above limits) |
| `dispatched` | SUBMITTED | IN_TRANSIT | Operator (simulated channel callback) |
| `delivered` | SUBMITTED, IN_TRANSIT, UNKNOWN | DELIVERED | Operator |
| `failed` | SUBMITTED, IN_TRANSIT, UNKNOWN | REFUNDED | Operator |
| `unknown` | SUBMITTED, IN_TRANSIT | UNKNOWN | Operator |
| `reconcile` | DELIVERED | RECONCILED | Student |
| Expire | CREATED with an expired quote | EXPIRED | Triggered by any command on the order |

Additional rules:

- **Replay**: when the order is already in the target state of an action or later, the action is a replay and returns the current order without checking `expected_version` and without posting again. Examples: reporting `delivered` again on a DELIVERED or RECONCILED order, or calling `submit` again on a submitted order.
- **Quote reservation**: once a quote is taken by an order (one to one), it cannot be used for any other order, conversion or funds receipt, even if the order is later cancelled or expires (`QUOTE_IN_USE`).
- **No snapshot for foreign currencies**: when neither the source nor the target currency is the home currency, the money movement is not written to the home-currency state snapshot.
- **FX margin cost rounding**: `fx_margin_cost` is rounded ROUND_HALF_UP to the source currency precision.

Transitions not in the table are rejected (`INVALID_TRANSITION`); terminal states are CANCELLED, EXPIRED, REFUNDED and RECONCILED. Every transition checks `expected_version` (409 on mismatch), increments the version, writes an immutable `RemittanceStatusEvent` (from, to, actor, time, note) and is audited. Re-sending an outcome that has already taken effect (for example `delivered` on a DELIVERED order) returns the current order without posting again.

## Money movements

- **Submit**: debits `send_amount` (including the sender fee) from the source currency balance; ledger origin `remittance_order`, leg `debit`; the quote is marked used at this point. When the source currency is the home currency, the home-currency available balance after submission must also stay at or above the snapshot `reserve` (`RESERVE_REQUIRED`).
- **Failure**: refunds `send_amount` in the source currency (leg `refund`), moves straight to REFUNDED and records `failure_reason`.
- **Delivery**: when the recipient is SELF, `receive_amount` is credited to the student's own target-currency balance (leg `credit`); for an external recipient the wallet does not change.
- A database constraint allows at most one ledger entry per leg type per order.

## Fees and limits

Orders can only be created from a server-priced corridor quote (`POST fx-quotes/live/`); `send_amount` equals the quote's `quoted_amount`. Fee breakdown in the response:

| Field | Meaning |
|---|---|
| `sender_fee` | Corridor fixed fee + percentage fee, source currency |
| `rate` / `mid_rate` | Executed rate / reference mid rate |
| `fx_margin_cost` | FX margin expressed as a source-currency cost = (`send_amount` − `sender_fee`) × (`mid_rate` − `rate`) / `mid_rate` |
| `total_cost` | `sender_fee` + `fx_margin_cost`, source currency |
| `receive_amount` | Amount the recipient receives, target currency |

Submission re-checks: the corridor is still enabled, the amount is within the corridor's minimum and maximum, the balance is sufficient (`INSUFFICIENT_BALANCE`), the beneficiary is still verified (`BENEFICIARY_NOT_VERIFIED`), and the per-transaction, daily and monthly limits of the permission tiers.

## Endpoints (`/api/v2/`, every POST requires `Idempotency-Key`)

| Method and path | Request body |
|---|---|
| `POST remittance-orders/` | `{"quote_id", "recipient": "SELF"|"BENEFICIARY", "beneficiary_id"?, "purpose": "tuition"|"living"|"family_support"|"other", "reference"?, "deadline"?}` |
| `GET remittance-orders/`, `GET remittance-orders/{id}/` | Details include `history` (list of status events) and the fee breakdown |
| `POST remittance-orders/{id}/cancel/` | `{"expected_version"}` |
| `POST remittance-orders/{id}/submit/` | `{"expected_version"}`; header `X-Step-Up-Token` |
| `POST remittance-orders/{id}/adapter-event/` | Operator: `{"outcome": "dispatched"|"delivered"|"failed"|"unknown", "expected_version", "note"?}` |
| `POST remittance-orders/{id}/reconcile/` | `{"expected_version"}` |

Validation on create:
- The quote belongs to the caller, is server-priced, unused, unexpired, and has a `quoted_amount`.
- `BENEFICIARY` requires a verified beneficiary owned by the caller; `SELF` must not carry `beneficiary_id`.
- `deadline` is optional; if given, it must be between the demo-clock date and 366 days after it (`DEADLINE_OUT_OF_RANGE`). On delivery, `delivered_on` (demo-clock date) is recorded and, when there is a deadline, `on_time` is derived.

Recommended flow: price quotes for every corridor tier of the same currency pair with `fx-quotes/live/`, compare them with `remittance-comparisons/`, then create the order from `recommended_quote_id`.

In the planning chat, remittance tools are available only after the loan application is submitted (plan `CONFIRMED`); before that they are refused server-side with `APPLICATION_REQUIRED` (see [Agent](agent.md)).

## Related behavior

- Orders in REFUNDED or UNKNOWN enter the Review Queue; the entry closes when the order recovers.
- Delivered orders to a verified beneficiary with a deadline count toward the on-time record in [Credit building](credit.md): `delivered_on ≤ deadline` counts as on time, otherwise as completed late. Orders to oneself do not count. The credit page is retired from the product (2026-10-15), but the on-time record still scales outflow limits.
- The demo command `manage.py demo_remittance --runs 3` runs the full HTTP flow: corridor quotes → comparison → order → step-up submission → channel callback → reconciliation; it also includes one failed refund and one approval above the limits.
