# 汇款订单

学生可以从钱包里的某个币种余额，沿已配置的汇路向外汇款：汇给自己（到账后进入本人的目标币种余额），或汇给已核验的收款人（如学校或国内家人账户）。订单有完整的状态机、费用明细、按汇路的金额上下限，以及权限分级里的 T2/T3 检查。所有资金和通道都是模拟的。

与[自有余额换汇](multi-currency.md)的区别：换汇即时完成；汇款是跨境转账，有结算期，可能失败或状态不明，需要逐步跟踪。

## 状态机

```
CREATED ──submit──▶ SUBMITTED ──dispatched──▶ IN_TRANSIT ──delivered──▶ DELIVERED ──reconcile──▶ RECONCILED
   │                    │  └──delivered──────────────────────────────▶ DELIVERED
   ├─cancel─▶ CANCELLED  ├──failed──▶ REFUNDED（原币种退回）
   └─(报价过期)─▶ EXPIRED └──unknown──▶ UNKNOWN ──delivered/failed──▶ DELIVERED / REFUNDED
                         IN_TRANSIT 同样可 failed / unknown
```

| 动作 | 从状态 | 到状态 | 谁 |
|---|---|---|---|
| 创建 | — | CREATED | 学生（T1） |
| `cancel` | CREATED | CANCELLED | 学生 |
| `submit` | CREATED | SUBMITTED | 学生（T2 `remittance.submit`，超限为 T3） |
| `dispatched` | SUBMITTED | IN_TRANSIT | 运营（模拟通道回调） |
| `delivered` | SUBMITTED、IN_TRANSIT、UNKNOWN | DELIVERED | 运营 |
| `failed` | SUBMITTED、IN_TRANSIT、UNKNOWN | REFUNDED | 运营 |
| `unknown` | SUBMITTED、IN_TRANSIT | UNKNOWN | 运营 |
| `reconcile` | DELIVERED | RECONCILED | 学生 |
| 过期 | CREATED 且报价已过期 | EXPIRED | 任何对该订单的命令触发 |

补充规则：

- **重放**：订单已处于某动作的目标状态或之后的状态时，该动作视为重放，直接返回当前订单，不检查 `expected_version`，也不再入账。例如对 DELIVERED 或 RECONCILED 的订单再报 `delivered`，或对已提交的订单再次 `submit`。
- **报价占用**：报价一旦被订单占用（一对一），即使订单后来被取消或过期，也不能再用于其他订单、换汇或到账（`QUOTE_IN_USE`）。
- **外币不写快照**：源币种和目标币种都不是本币时，资金变化不会写入本币状态快照。
- **点差成本舍入**：`fx_margin_cost` 按源币种精度 ROUND_HALF_UP 舍入。

不在表中的转换一律拒绝（`INVALID_TRANSITION`），终态为 CANCELLED、EXPIRED、REFUNDED、RECONCILED。每次转换都检查 `expected_version`（不符返回 409），版本加一，写入不可修改的 `RemittanceStatusEvent`（从、到、操作人、时间、备注），并记审计。重复发送已生效的同一结果（例如对 DELIVERED 再报 `delivered`）返回当前订单，不重复入账。

## 资金

- **提交**：从源币种余额扣减 `send_amount`（含发送费），分录来源为 `remittance_order`，腿为 `debit`；报价在此时标记为已使用。源币种为本币时，还要求提交后的本币可用余额不低于快照的 `reserve`（`RESERVE_REQUIRED`）。
- **失败**：按原币种退回 `send_amount`（腿 `refund`），状态直接进入 REFUNDED，并记录 `failure_reason`。
- **送达**：收款人为 SELF 时，把 `receive_amount` 记入本人的目标币种余额（腿 `credit`）；收款人为外部账户时，钱包不再变化。
- 数据库约束保证每张订单每种腿最多一条分录。

## 费用与限额

订单只能用服务端定价的汇路报价创建（`POST fx-quotes/live/`），`send_amount` 等于报价的 `quoted_amount`。响应中的费用明细：

| 字段 | 含义 |
|---|---|
| `sender_fee` | 汇路固定费 + 百分比费，源币种 |
| `rate` / `mid_rate` | 成交汇率 / 参考中间价 |
| `fx_margin_cost` | 汇率点差折合的源币种成本 =（`send_amount` − `sender_fee`）×（`mid_rate` − `rate`）/ `mid_rate` |
| `total_cost` | `sender_fee` + `fx_margin_cost`，源币种 |
| `receive_amount` | 收款方到账金额，目标币种 |

提交时再次检查：汇路仍启用、金额在汇路上下限之内、余额足够（`INSUFFICIENT_BALANCE`）、收款人仍已核验（`BENEFICIARY_NOT_VERIFIED`），以及权限分级的单笔、单日、单月限额。

## 接口（`/api/v2/`，所有 POST 需 `Idempotency-Key`）

| 方法与路径 | 请求体 |
|---|---|
| `POST remittance-orders/` | `{"quote_id", "recipient": "SELF"|"BENEFICIARY", "beneficiary_id"?, "purpose": "tuition"|"living"|"family_support"|"other", "reference"?, "deadline"?}` |
| `GET remittance-orders/`、`GET remittance-orders/{id}/` | 详情包含 `history`（状态事件列表）和费用明细 |
| `POST remittance-orders/{id}/cancel/` | `{"expected_version"}` |
| `POST remittance-orders/{id}/submit/` | `{"expected_version"}`；请求头 `X-Step-Up-Token` |
| `POST remittance-orders/{id}/adapter-event/` | 运营：`{"outcome": "dispatched"|"delivered"|"failed"|"unknown", "expected_version", "note"?}` |
| `POST remittance-orders/{id}/reconcile/` | `{"expected_version"}` |

创建时的校验：
- 报价属于本人、服务端定价、未使用、未过期，带 `quoted_amount`。
- `BENEFICIARY` 必须提供本人名下、已核验的收款人；`SELF` 不能带 `beneficiary_id`。
- `deadline` 可选；如果提供，必须在演示时钟当天到之后 366 天之间（`DEADLINE_OUT_OF_RANGE`）。送达时记录 `delivered_on`（演示时钟日期），有 deadline 时得出 `on_time`。

推荐流程：先用 `fx-quotes/live/` 为同一币种对的各档汇路生成报价，用 `remittance-comparisons/` 比较，再用 `recommended_quote_id` 创建订单。

## 联动

- 状态为 REFUNDED 或 UNKNOWN 的订单进入 Review Queue，订单恢复正常后关闭对应条目。
- 汇给已核验收款人、有 deadline 且已送达的订单计入[信用建立](credit.md)的准时记录：`delivered_on ≤ deadline` 记为准时，否则记为逾期完成。汇给自己的订单不计入。
- 演示命令 `manage.py demo_remittance --runs 3` 走完整 HTTP 流程：汇路报价 → 比价 → 下单 → step-up 提交 → 通道回调 → 对账；另含一次失败退款和一次超限审批。
