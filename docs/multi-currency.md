# Multi-Currency Wallet and Corridors

StudyFlow's loans and tuition settlement use the home currency THB (budgets also used it; retired from the product on 2026-10-15; backend only). The wallet can hold simulated balances in several currencies at once and convert between the student's own balances using corridors and reference rates. All money operations are simulated.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `STUDYFLOW_HOME_CURRENCY` | `THB` | Home currency. FinancialState snapshots, budgets and loans are denominated in it. The lending core B supports only THB, so any other value fails startup |
| `STUDYFLOW_SUPPORTED_CURRENCIES` | `THB,USD,EUR,CNY,GBP,JPY,AUD,SGD,MYR` | Currencies available to the wallet, quotes and corridors. Must include the home currency; currencies with more than 2 decimal places (such as KWD) are rejected at startup |

Amount precision follows ISO 4217 (Babel): JPY has 0 decimal places, the rest 2. Amounts beyond the precision are rejected (`AMOUNT_PRECISION_INVALID`) rather than silently rounded; conversion results are rounded ROUND_HALF_UP to the target currency precision.

## Data model

- `DemoWallet.balance`: home-currency balance (original field kept for backward compatibility). Database constraint `demo_wallet_balance_nonnegative`.
- `WalletBalance(owner, wallet, currency, balance)`: non-home-currency balances, one row per owner per currency (`wallet_balance_owner_currency_unique`), `balance ≥ 0` (`wallet_balance_nonnegative`). The home currency is never written to this table.
- `DemoLedgerEntry.currency`: entry currency; historical entries were backfilled as THB. Invariant: for each owner and currency, the sum of entry amounts = that currency's balance (for the home currency, `DemoWallet.balance − opening_balance`, i.e. the opening balance is not posted).
- `CurrencyConversion`: one conversion between own balances, referencing a unique quote (`quote` one to one; a quote can be used only once), producing two entries: negative in the source currency and positive in the target currency, with the same `conversion` and different currencies (`ledger_conversion_leg_unique`). Immutable (immutability trigger).
- `Corridor`: global corridor configuration (not user data), fields `code, provider, tier, source_currency, target_currency, enabled, min_amount, max_amount, fee_fixed, fee_percent, fx_margin_bps, settlement_min_days, settlement_days`. Seeds: CNY/USD/EUR→THB and THB→CNY, each with express / standard / economy.
- `FXQuote` additions: `corridor` (nullable), `rate_source` (`manual` / `frankfurter` / `fixture`), `mid_rate`, `rate_date`, `consumed_at`, `quoted_amount`. `target_currency` can be any supported currency (defaults to the home currency).
- `FxRateSnapshot`: reference rate snapshot, see [FX rates](fx-rates.md).

### Two kinds of quotes

| Quote source | How it is created | Usable for |
|---|---|---|
| Manual (`manual`) | `POST fx-quotes/`, student enters the rate and fees | Read-only estimates: budget scenarios (retired from the product on 2026-10-15; backend only), comparisons; funds receipts confirmed by an operator |
| Server-priced (`frankfurter` / `fixture`) | `POST fx-quotes/live/`, priced from the corridor, reference mid rate and margin | All of the above, plus conversion between own balances |

Conversion between own balances accepts only server-priced quotes (`QUOTE_NOT_EXECUTABLE`). Otherwise a student could create balance out of thin air with a self-chosen rate.

## Single write path for balances

`finance.wallets.post(wallet, currency, amount, origin)` is the only function that changes a balance. It first locks the owner's user row (entry sequence numbers increase across currencies, so writes must be serialized), then locks the balance row, validates currency and precision, checks `0 ≤ new balance ≤ 9999999999999999.99` (`INSUFFICIENT_BALANCE_OR_PRECISION`), and writes the entry with the owner's next `sequence`. Payment settlement, funds receipt, disbursement, repayment and conversion all go through it.

## Endpoints (all under `/api/v2/`)

In the planning chat, wallet and conversion tools are available only after the loan application is submitted (plan `CONFIRMED`); before that they are refused server-side with `APPLICATION_REQUIRED` (see [Agent](agent.md)). The "Wallet and payments" tool in the app opens at the same point.

### `GET demo/wallets/balances/`
```json
{"data": {"home_currency": "THB", "balances": [
  {"currency": "THB", "balance": "1000.00", "available_balance": "900.00", "is_home": true},
  {"currency": "CNY", "balance": "500.00", "available_balance": "500.00", "is_home": false}
], "is_simulated": true}}
```
The home currency is always listed; foreign currencies are listed only if a balance row exists. Home available balance = balance − payments in pending/unknown status. Each row also has `indicative_home_value` and `valuation` (`rate`, `rate_date`, `source`, `stale`), computed only from saved rate snapshots, so read requests make no external calls; `null` when there is no snapshot. Returns 400 if the wallet is not initialized.

### `GET corridors/`
Lists enabled corridors, filterable with `?source_currency=CNY&target_currency=THB`.

### `POST fx-quotes/` (extended)
`target_currency` may be any supported currency (defaults to the home currency); `source_currency ≠ target_currency` (`SAME_CURRENCY_QUOTE`). Optional `corridor_id`: the currencies must match the corridor (`CORRIDOR_CURRENCY_MISMATCH`) and the corridor must be enabled (`CORRIDOR_DISABLED`). Fee precision: `sender_fee` uses the source currency, `receiver_fee` the target currency.

### `POST funding-sources/{id}/receive/` (extended, operator; funding sources and sponsor confirmation are retired from the product on 2026-10-15; backend only)
Adds `hold_in_source_currency` (default false). When true: the funding source currency must not be the home currency (`HOLD_REQUIRES_FOREIGN_CURRENCY`), no `fx_quote_id` may be supplied (`HOLD_WITHOUT_QUOTE`), the amount is credited to `WalletBalance` in the original currency, and no home-currency snapshot event is appended (foreign holdings do not count toward home-currency cash flow until converted). Other checks (sponsor confirmation, arrival date) are unchanged.

### `POST conversions/`
Header `Idempotency-Key`.
```json
{"quote_id": "<uuid>", "source_amount": "500.00", "state_version": 7}
```
- The quote belongs to the caller, is unexpired (`QUOTE_EXPIRED`), unused (`QUOTE_CONSUMED`), and is a server-priced corridor quote (`QUOTE_NOT_EXECUTABLE`).
- The corridor is still enabled (`CORRIDOR_DISABLED`) and the amount is within its minimum and maximum (`CORRIDOR_AMOUNT_OUT_OF_RANGE`). When the quote has a `quoted_amount`, the conversion amount must equal it (`QUOTE_AMOUNT_MISMATCH`), because the percentage fee was computed on that amount.
- Amount precision follows the source currency; `source_amount > sender_fee`; the result `(source_amount − sender_fee) × rate − receiver_fee > 0`, rounded to the target currency precision (`CONVERSION_NOT_POSITIVE`).
- The source balance is sufficient (`INSUFFICIENT_BALANCE`). When the source is the home currency, `home available balance − source_amount ≥ snapshot reserve` is also required (`RESERVE_REQUIRED`).
- `state_version` must be the current version (otherwise 409). When the target is the home currency an income event `conversion:<id>` is appended; when the source is the home currency an expense event `conversion:<id>` is appended; both carry `settled_sequence`, and the `conversion:` prefix is reserved for the ledger.
- Writes `CurrencyConversion` and two entries, sets the quote's `consumed_at`, audits `wallet.conversion_settled`.
- Response `data`: `id, quote_id, source_currency, source_amount, target_currency, target_amount, rate, sender_fee, receiver_fee, effective_on, debit_sequence, credit_sequence, is_simulated`.

### A quote settles only once
Once a quote has been used by a conversion or a funds receipt (`receive` with `fx_quote_id`), it cannot be used for any further settlement (`QUOTE_CONSUMED`). Budget scenarios and comparisons are read-only estimates and may still reference a used quote.

### Migration
`0015_multicurrency` does not reference application code: corridor seed data and defaults are frozen inside the migration file. Rollback is refused when foreign-currency or conversion entries exist, because the old schema cannot represent them.

## Invariants (must be covered by tests)

1. After any sequence of operations, for each currency: sum of entries = balance (home currency minus the opening balance); balance ≥ 0.
2. Migration: pre-migration home balances and entry amounts are unchanged, and historical entries have currency THB.
3. Concurrency: concurrent conversions/payments by the same user never produce a negative balance or reuse a quote.
4. A failed command leaves no entries, no balance change and no consumed quote.
