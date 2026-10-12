# 多币种钱包与汇路

StudyFlow 的预算、借款和学费结算使用本币 THB。钱包可以同时持有多种币种的模拟余额，并按汇路和参考汇率在自有余额之间换汇。所有资金操作仍为模拟。

## 配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `STUDYFLOW_HOME_CURRENCY` | `THB` | 本币。FinancialState 快照、预算和借款都以本币计价。借款核心 B 只支持 THB，所以设为其他值时启动失败 |
| `STUDYFLOW_SUPPORTED_CURRENCIES` | `THB,USD,EUR,CNY,GBP,JPY,AUD,SGD,MYR` | 钱包、报价和汇路可用的币种。必须包含本币；小数位超过 2 的币种（如 KWD）启动时拒绝 |

金额精度按 ISO 4217（Babel）：JPY 0 位小数，其余 2 位。超出精度的金额被拒绝（`AMOUNT_PRECISION_INVALID`），不做静默舍入；换汇结果按目标币种精度 ROUND_HALF_UP。

## 数据模型

- `DemoWallet.balance`：本币余额（保持原字段，向后兼容）。数据库约束 `demo_wallet_balance_nonnegative`。
- `WalletBalance(owner, wallet, currency, balance)`：非本币余额，每个所有者每种币种一行（`wallet_balance_owner_currency_unique`），`balance ≥ 0`（`wallet_balance_nonnegative`）。本币永远不写入此表。
- `DemoLedgerEntry.currency`：分录币种，历史分录回填为 THB。不变量：对每个所有者和币种，分录金额之和 = 该币种余额（本币为 `DemoWallet.balance − opening_balance`，即开户余额不入账）。
- `CurrencyConversion`：一次自有余额换汇，引用唯一报价（`quote` 一对一，报价只能使用一次），产生两条分录：源币种负数、目标币种正数，二者 `conversion` 相同、币种不同（`ledger_conversion_leg_unique`）。不可修改（不可变触发器）。
- `Corridor`：全局汇路配置（非用户数据），字段 `code, provider, tier, source_currency, target_currency, enabled, min_amount, max_amount, fee_fixed, fee_percent, fx_margin_bps, settlement_min_days, settlement_days`。种子：CNY/USD/EUR→THB、THB→CNY，各 express / standard / economy。
- `FXQuote` 新增：`corridor`（可空）、`rate_source`（`manual` / `frankfurter` / `fixture`）、`mid_rate`、`rate_date`、`consumed_at`、`quoted_amount`。`target_currency` 可为任一支持币种（默认本币）。
- `FxRateSnapshot`：参考汇率快照，见 [汇率接入](fx-rates.md)。

### 报价的两类用途

| 报价来源 | 如何生成 | 可用于 |
|---|---|---|
| 手填（`manual`） | `POST fx-quotes/`，学生自填汇率和费用 | 只读估算：预算场景、比价；运营人员确认的资金到账 |
| 服务端定价（`frankfurter` / `fixture`） | `POST fx-quotes/live/`，按汇路、参考中间价和点差生成 | 以上全部，以及自有余额换汇 |

自有余额换汇只接受服务端定价的报价（`QUOTE_NOT_EXECUTABLE`）。否则学生可以用自定的汇率凭空制造余额。

## 余额唯一写入口

`finance.wallets.post(wallet, currency, amount, origin)` 是唯一改变余额的函数。它先锁定所有者的用户行（分录序号跨币种递增，必须串行），再锁定余额行，然后校验币种和精度，检查 `0 ≤ 新余额 ≤ 9999999999999999.99`（`INSUFFICIENT_BALANCE_OR_PRECISION`），按所有者递增 `sequence` 写分录。付款结算、资金到账、放款、还款、换汇全部经由它。

## 接口（均在 `/api/v2/` 下）

### `GET demo/wallets/balances/`
```json
{"data": {"home_currency": "THB", "balances": [
  {"currency": "THB", "balance": "1000.00", "available_balance": "900.00", "is_home": true},
  {"currency": "CNY", "balance": "500.00", "available_balance": "500.00", "is_home": false}
], "is_simulated": true}}
```
本币始终列出，外币只列出已有余额行的币种。本币可用余额 = 余额 − 处于 pending/unknown 状态的付款。每行还有 `indicative_home_value` 和 `valuation`（`rate`、`rate_date`、`source`、`stale`），只用已保存的汇率快照计算，读请求不会发起外部调用；没有快照时为 `null`。钱包未初始化时返回 400。

### `GET corridors/`
列出启用的汇路，可按 `?source_currency=CNY&target_currency=THB` 过滤。

### `POST fx-quotes/`（扩展）
`target_currency` 可选任一支持币种（默认本币），`source_currency ≠ target_currency`（`SAME_CURRENCY_QUOTE`）。可选 `corridor_id`：币种必须与汇路一致（`CORRIDOR_CURRENCY_MISMATCH`）且汇路启用（`CORRIDOR_DISABLED`）。费用精度：`sender_fee` 按源币种、`receiver_fee` 按目标币种。

### `POST funding-sources/{id}/receive/`（扩展，运营）
新增 `hold_in_source_currency`（默认 false）。为 true 时：资金来源币种必须不是本币（`HOLD_REQUIRES_FOREIGN_CURRENCY`）、不能附带 `fx_quote_id`（`HOLD_WITHOUT_QUOTE`），以原币种记入 `WalletBalance`，不追加本币快照事件（外币持有不计入本币现金流，换汇成本币时才计入）。其余检查（赞助确认、到账日期）不变。

### `POST conversions/`
请求头 `Idempotency-Key`。
```json
{"quote_id": "<uuid>", "source_amount": "500.00", "state_version": 7}
```
- 报价属于本人、未过期（`QUOTE_EXPIRED`）、未使用（`QUOTE_CONSUMED`），并且是服务端定价的汇路报价（`QUOTE_NOT_EXECUTABLE`）。
- 汇路仍启用（`CORRIDOR_DISABLED`），金额在汇路上下限之内（`CORRIDOR_AMOUNT_OUT_OF_RANGE`）。报价带 `quoted_amount` 时，换汇金额必须与它相等（`QUOTE_AMOUNT_MISMATCH`），因为百分比手续费是按这个金额算的。
- 金额精度按源币种；`source_amount > sender_fee`；结果 `(source_amount − sender_fee) × rate − receiver_fee > 0`，按目标币种精度舍入（`CONVERSION_NOT_POSITIVE`）。
- 源币种余额足够（`INSUFFICIENT_BALANCE`）。源为本币时还要求 `本币可用余额 − source_amount ≥ 快照 reserve`（`RESERVE_REQUIRED`）。
- `state_version` 必须是当前版本（否则 409）。目标为本币时追加收入事件 `conversion:<id>`；源为本币时追加支出事件 `conversion:<id>`；均带 `settled_sequence`，前缀 `conversion:` 为账本保留。
- 写 `CurrencyConversion`、两条分录，置报价 `consumed_at`，审计 `wallet.conversion_settled`。
- 响应 `data`：`id, quote_id, source_currency, source_amount, target_currency, target_amount, rate, sender_fee, receiver_fee, effective_on, debit_sequence, credit_sequence, is_simulated`。

### 报价只能结算一次
报价一旦被换汇或资金到账（`receive` 时带 `fx_quote_id`）使用，就不能再用于任何结算（`QUOTE_CONSUMED`）。预算场景和比价属于只读估算，仍可引用已使用的报价。

### 迁移
`0015_multicurrency` 不引用应用代码：汇路种子数据和默认值都在迁移文件内冻结。存在外币分录或换汇分录时拒绝回滚，因为旧结构无法表示这些数据。

## 不变量（测试必须覆盖）

1. 任意操作序列后，每个币种：分录之和 = 余额（本币减开户余额）；余额 ≥ 0。
2. 迁移：迁移前的本币余额、分录金额不变，历史分录币种为 THB。
3. 并发：同一用户并发换汇/付款不会产生负余额或重复使用报价。
4. 失败的命令不留下分录、余额变化或报价消耗。
