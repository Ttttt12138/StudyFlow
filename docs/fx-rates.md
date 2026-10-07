# 汇率接入

Django 通过 C 模块已有的 Frankfurter 适配器（`studyflow_ai.readiness.fx.FxAdapter`）获取参考汇率，用于生成按汇路定价的报价和估算外币余额的本币价值。Frankfurter v2 汇总的多家央行与官方机构参考价（2026-10-07 实测来源含 ECB、泰国央行 BOT、中国外汇交易中心 CFETS 等 41 家），按工作日更新，不是可成交的实时价；报价和响应中以 `rate_source`、`rate_date` 如实标注。汇款执行仍为模拟。

## 配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `STUDYFLOW_FX_LIVE` | `false` | `true` 时调用 Frankfurter；否则使用内置固定汇率（`fixture`），CI 和测试使用固定汇率 |
| `STUDYFLOW_FX_CACHE_SECONDS` | `900` | 同一货币对在该时间内复用已保存的汇率，不重复请求 |

固定汇率（`fixture`，每单位折合 THB）：USD 33.00、EUR 36.50、CNY 4.60、GBP 42.00、JPY 0.22；交叉汇率经 THB 换算。固定汇率模式不发起任何网络请求。这些数值只用于测试和演示，与市场价有偏差（2026-10-07 实测 CNY/THB 为 5.0187，固定值低约 8%），不得用于估算真实成本。

实测记录：`scripts/verify_live_fx.py` 对全部 4 个货币对取真实汇率，并按 12 条汇路各生成一份报价（事务内回滚），报告写入 `output/verification-live-fx.json`。2026-10-07 运行结果：4 个货币对均返回当日汇率、没有过期标记，12 份报价的手续费、点差和到账金额与公式手算一致。

## 数据

`FxRateSnapshot(base, quote, rate, rate_date, fetched_at, source, basis)`：每次成功获取保存一行（全局数据，非用户数据）。汇率日期距今超过 7 天视为过期（`STALE_FX_RATE`，与 C 模块规则一致）。

快照只在同一来源内复用：`STUDYFLOW_FX_LIVE=true` 时只读取 `frankfurter` 快照，否则只读取 `fixture` 快照；live 模式下，固定汇率报价也不能用于换汇或汇款（安全审查发现，在 live 部署上运行演示可能让固定汇率混入真实报价）。

获取顺序：缓存期内的最新快照 → 外部获取（成功则保存）→ 获取失败时退回最近一次快照并标记 `FX_FETCH_FAILED` → 没有任何快照时返回 503 `FX_RATE_UNAVAILABLE`。

## 接口（`/api/v2/`）

### `GET fx-rates/?base=CNY&quote=THB`
```json
{"data": {"base": "CNY", "quote": "THB", "rate": "4.6500000000", "rate_date": "2026-10-06",
  "fetched_at": "...", "source": "fixture", "stale": false, "issues": [], "is_reference_rate": true}}
```

### `POST fx-quotes/live/`
请求头 `Idempotency-Key`。`{"corridor_id": "<uuid>", "send_amount": "1000.00"}`
- 汇路必须启用，`send_amount` 在汇路上下限之间（`CORRIDOR_AMOUNT_OUT_OF_RANGE`），精度符合源币种。
- 成交汇率 = 中间价 ×（1 − `fx_margin_bps`/10000），保留 10 位小数；`sender_fee` = `fee_fixed` + `send_amount` × `fee_percent`，按源币种精度舍入；`receiver_fee` = 0；结算天数取自汇路；10 分钟后过期。
- 汇率过期（`STALE_FX_RATE`）或只能退回旧快照时拒绝生成报价（409）。
- 返回普通 `FXQuote` 记录（`quoted_amount` = `send_amount`），另含 `corridor_id`、`rate_source`、`mid_rate`、`rate_date`，以及按该金额计算的 `net_received`。只有这类报价能用于自有余额换汇和汇款订单。

### 余额估值
`GET demo/wallets/balances/` 中每个外币余额附带 `indicative_home_value` 和 `valuation`（`rate`、`rate_date`、`source`），只使用已保存的快照，不在读请求中发起外部调用；没有可用快照时为 `null`。
