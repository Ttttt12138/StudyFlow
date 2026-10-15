# FX Rates

Django fetches reference rates through the C module's existing Frankfurter adapter (`studyflow_ai.readiness.fx.FxAdapter`) to price corridor quotes and estimate the home-currency value of foreign balances. Frankfurter v2 aggregates reference rates from multiple central banks and official institutions (sources observed on 2026-10-07 include ECB, the Bank of Thailand (BOT), the China Foreign Exchange Trade System (CFETS) and others, 41 in total), updated on business days; these are not executable live rates, and quotes and responses label them honestly with `rate_source` and `rate_date`. Remittance execution remains simulated.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `STUDYFLOW_FX_LIVE` | `false` | When `true`, calls Frankfurter; otherwise uses built-in fixed rates (`fixture`). CI and tests use fixed rates |
| `STUDYFLOW_FX_CACHE_SECONDS` | `900` | Within this period the saved rate for the same currency pair is reused instead of fetching again |

Fixed rates (`fixture`, THB per unit): USD 33.00, EUR 36.50, CNY 4.60, GBP 42.00, JPY 0.22; cross rates are derived through THB. Fixture mode makes no network requests. These values are for tests and demos only and differ from market rates (on 2026-10-07 the observed CNY/THB was 5.0187, so the fixture is about 8% low); do not use them to estimate real costs.

Live record: `backend/scripts/verify_live_fx.py` fetches real rates for all 4 currency pairs and prices one quote for each of the 12 corridors (rolled back inside a transaction), writing the report to `output/verification-live-fx.json`. Run on 2026-10-07: all 4 pairs returned same-day rates with no stale flag, and the fees, margins and received amounts of the 12 quotes matched hand calculation from the formulas.

## Data

`FxRateSnapshot(base, quote, rate, rate_date, fetched_at, source, basis)`: one row saved per successful fetch (global data, not user data). A rate date more than 7 days old is stale (`STALE_FX_RATE`, same rule as the C module).

Snapshots are reused only within the same source: with `STUDYFLOW_FX_LIVE=true` only `frankfurter` snapshots are read, otherwise only `fixture` snapshots; in live mode, fixed-rate quotes cannot be used for conversions or remittances either (found in the security review: running the demo on a live deployment could mix fixed rates into real quotes).

Lookup order: latest snapshot within the cache period → external fetch (saved on success) → on fetch failure, fall back to the most recent snapshot flagged `FX_FETCH_FAILED` → with no snapshot at all, return 503 `FX_RATE_UNAVAILABLE`.

## Endpoints (`/api/v2/`)

### `GET fx-rates/?base=CNY&quote=THB`
```json
{"data": {"base": "CNY", "quote": "THB", "rate": "4.6500000000", "rate_date": "2026-10-06",
  "fetched_at": "...", "source": "fixture", "stale": false, "issues": [], "is_reference_rate": true}}
```
Optional parameter `amount` (positive, with `base` currency precision): the response additionally returns `amount` and `converted` (converted to the `quote` currency at the reference rate and rounded to its precision); for example `?base=CNY&quote=THB&amount=5000.00` returns `"converted": "23000.00"`. For planning reference only (the frontend used it to convert a foreign opening balance to the home currency when creating a semester; that budget flow is retired from the product on 2026-10-15; backend only); it is not an executable quote and cannot be used for conversions or remittances. Invalid amounts return 400 `AMOUNT_INVALID` / `AMOUNT_PRECISION_INVALID`.

### `POST fx-quotes/live/`
Header `Idempotency-Key`. `{"corridor_id": "<uuid>", "send_amount": "1000.00"}`
- The corridor must be enabled, `send_amount` must be within the corridor's minimum and maximum (`CORRIDOR_AMOUNT_OUT_OF_RANGE`), with source-currency precision.
- Executed rate = mid rate × (1 − `fx_margin_bps`/10000), kept to 10 decimal places; `sender_fee` = `fee_fixed` + `send_amount` × `fee_percent`, rounded to the source currency precision; `receiver_fee` = 0; settlement days come from the corridor; expires after 10 minutes.
- Refuses to create a quote (409) when the rate is stale (`STALE_FX_RATE`) or only an old snapshot is available.
- Returns a normal `FXQuote` record (`quoted_amount` = `send_amount`), plus `corridor_id`, `rate_source`, `mid_rate`, `rate_date`, and `net_received` for that amount. Only these quotes can be used for conversions between own balances and for remittance orders.

### Balance valuation
In `GET demo/wallets/balances/`, every foreign balance carries `indicative_home_value` and `valuation` (`rate`, `rate_date`, `source`), using only saved snapshots, with no external calls on read requests; `null` when no snapshot is available.
