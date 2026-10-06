# 信用建立（模拟）

留学生在当地通常没有信用记录。StudyFlow 把学生在平台内按时履约的记录整理成一份**内部准时记录档案**：用来解释"你的记录怎样"，适度调整权限限额，并可导出一份可验证的签名证明（例如给房东看）。它不是征信评分，不对接、不上报任何征信机构，所有数据都是模拟的。

## 记录来源

只统计本人的记录。时间窗口为 `as_of` 往前 365 天到 `as_of`，两端都包含。`as_of` 取演示时钟，未初始化钱包时取今天。已完成的记录按完成日期判断是否落在窗口内；未完成且已过期的记录无论多久以前都计入，直到处理为止。

| 来源 | 准时 | 逾期完成 | 未完成且已过期 |
|---|---|---|---|
| 借款分期（`LoanInstallment`） | `paid_on ≤ due_on` | `paid_on > due_on` | 未还且 `due_on <` 当前日期 |
| 账单付款（`Payment`，状态 settled / reconciled / reconciliation_exception） | 回执 `settled_on ≤ due_on` | `settled_on > due_on` | — |

后续的汇款订单（按时送达）通过同一个来源注册表接入。

## 等级

按顺序判断，取第一个满足的：

| 等级 | 条件 | 限额系数 |
|---|---|---|
| `AT_RISK` | 有未完成且已过期的记录，或逾期完成 ≥ 2 笔 | 0.5 |
| `GOOD` | 准时 ≥ 6 笔，且逾期完成 = 0 | 1.5 |
| `FAIR` | 准时 ≥ 3 笔，且逾期完成 ≤ 1 | 1.2 |
| `BUILDING` | 其他（包括没有任何记录） | 1.0 |

限额系数乘到 T2 动作的单笔、单日、单月限额上（见[权限分级](permissions.md)），由 `finance.credit.limit_multiplier(owner)` 实时计算。

## 接口（`/api/v2/`）

### `GET credit/profile/`
实时计算，不写入数据：
```json
{"data": {"level": "FAIR", "on_time": 4, "late": 0, "overdue": 0, "as_of": "2026-12-02",
  "limit_multiplier": "1.2",
  "factors": [{"code": "ON_TIME_RECORDS", "effect": "positive", "count": 4}],
  "next_level": {"level": "GOOD", "on_time_needed": 2},
  "evidence": [{"source": "loan_installment", "id": "...", "due_on": "...", "completed_on": "...", "status": "ON_TIME"}],
  "is_simulated": true, "disclaimer": "..."}}
```
`factors` 中 `ON_TIME_RECORDS`、`LATE_RECORDS`、`OVERDUE_RECORDS` 只在计数大于 0 时出现；`THIN_HISTORY` 只要准时记录少于 3 笔就出现，`count` 为当前准时笔数（可以是 0）。`code` 取值：
- `ON_TIME_RECORDS`：正面；
- `LATE_RECORDS`：负面；
- `OVERDUE_RECORDS`：负面；
- `THIN_HISTORY`：中性，准时少于 3 笔时出现。

`next_level` 按当前等级给出：
- `GOOD`：`null`。
- `FAIR`：`{"level": "GOOD", "on_time_needed", "late_records_must_age_out"}`。有逾期完成的记录时，后者为 true，表示还需等这些记录移出窗口。
- `AT_RISK`：`{"level": "BUILDING", "action"}`。有未完成且已过期的记录时，`action` 为 `RESOLVE_OVERDUE`；否则为 `WAIT_FOR_LATE_RECORDS_TO_AGE_OUT`。

### `POST credit/snapshots/`
需要 `Idempotency-Key`，无请求体字段（`{}`）。把当前的计算结果存成一份不可修改的 `CreditSnapshot`，返回快照记录。`GET credit/snapshots/` 列出本人的快照，`GET credit/snapshots/{id}/` 读取单份。

### `POST credit/statements/`
需要 `Idempotency-Key`，请求体 `{"snapshot_id": "<uuid>"}`，快照必须属于本人。返回签名证明：
```json
{"data": {"statement": "<signed string>", "expires_in_days": 90, "snapshot_id": "...", "level": "FAIR"}}
```
证明使用 `django.core.signing` 签名（salt `studyflow-credit-statement-v1`），内容只包括快照 id、持有人用户名、等级、三项计数、`as_of` 和签发时间，不含交易明细。

### `POST credit/statements/verify/`
公开接口，无需登录，请求体为 `{"statement": "..."}`。

- 签名有效、签发不超过 90 天（真实时间）、对应快照仍存在且与内容一致时，返回 `{"data": {"valid": true, ...证明内容, "is_simulated": true}}`。
- 否则返回 `{"data": {"valid": false, "reason": ...}}`，`reason` 为 `INVALID_SIGNATURE`、`EXPIRED` 或 `SNAPSHOT_MISMATCH`。

无论是否有效，HTTP 状态码都是 200。以下情况一律视为 `INVALID_SIGNATURE`：

- 没有 `statement` 字段，或值为 `null`、空字符串、超长文本；
- 签名内容不是对象；
- 字段集合与上面列出的证明内容不完全一致；
- 快照 id 不是 UUID。
