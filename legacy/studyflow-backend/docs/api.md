# A 接入 B 借贷 API

所有业务路径前缀 `/api/v1`，所有响应标记 `simulated: true`。请求使用 `Authorization: Bearer <token>`；所有写请求还需 `Idempotency-Key: <unique-key>`。身份从令牌确定，学生请求不能传 `student_id`。

## 接口

| 方法与路径 | 角色 | 请求／用途 |
|---|---|---|
| POST `/loan-quotes` | 学生 | 本金、费率、费用、期限、首期日期；201 返回不可变报价与完整还款表 |
| GET `/loan-quotes` | 学生 | 本人报价分页 |
| GET `/loan-quotes/{id}` | 学生 | 报价及根据最新资料重算的偿还能力 |
| PUT `/affordability-profiles` | 学生 | `expected_version`、`months`；完整替换资料 |
| GET `/affordability-profiles` | 学生 | 当前资料；尚未填写时 `version=0` |
| POST `/loan-applications` | 学生 | `quote_id`；201 返回 DRAFT |
| GET `/loan-applications`、`/{id}` | 学生 | 本人申请列表／详情 |
| POST `/loan-applications/{id}/submit` | 学生 | `expected_version`；事务内提交并自动审核 |
| POST `/loan-applications/{id}/cancel` | 学生 | `expected_version`；取消未放款申请 |
| GET `/admin/loan-applications`、`/{id}` | 管理员 | 审核列表／详情，包含学生 ID |
| POST `/admin/loan-applications/{id}/review` | 管理员 | `expected_version`、`reason`；对 UNDER_REVIEW 重新执行同一审核规则 |
| POST `/admin/loan-applications/{id}/disburse` | 管理员 | `expected_version`；复查、放款、建立账单、入账 |
| GET `/loans`、`/{id}` | 学生 | 本人贷款和逐期账单，包含日期派生的逾期状态 |
| POST `/loans/{id}/repay` | 学生 | `expected_version`、`installment_number`；支付最早已到期未付账单全额 |
| GET `/wallet` | 学生 | 本人余额及钱包版本 |
| GET `/wallet/ledger` | 学生 | 不可变资金流水分页 |
| GET `/admin/wallets/{student_id}` | 管理员 | 充值前读取钱包版本 |
| POST `/admin/wallet-topups` | 管理员 | `student_id`、`amount`、`reason`、`expected_version` |

列表采用 `limit=20`、`offset=0`，limit 范围 1—100。响应为 `items/limit/offset/has_more/simulated`。本人的空列表返回 200，其他学生对象返回 404。

## 最小请求示例

借款测算：

```json
{"principal":"30600.00","annual_rate":"0","fees":"600.00","months":12,"first_due_date":"2026-11-01"}
```

日期示例对应固定演示时钟；真实 API 必须使用未来日期。返回净到账 `30000.00`、总利息 `0.00`、总还款 `30600.00`，12 期每期 `2550.00`。`repayments` 中每行包括 `number/due_date/principal/interest/amount/remaining_principal`。

资料示例（一整年需要 12 条，不能仅用此一条得到批准）：

```json
{"expected_version":0,"months":[{"month":"2026-11","income":"10000.00","living_expenses":"4000.00","existing_repayments":"1000.00"}]}
```

提交申请：`{"expected_version":1}`。资料不足时返回 `UNDER_REVIEW`，`assessment.missing_inputs` 指明缺少的月份和字段。资料不足不是“可承担”；资料完整但不足时 `shortfall_months` 标出压力月份。

放款响应为 `{application, loan, wallet, simulated}`。若复查不通过，仍返回 200，但 `application.state=UNDER_REVIEW`、`loan=null`、`wallet=null`，**不得显示放款成功**。成功以 `application.state=DISBURSED` 且 `loan` 存在为准。重复幂等请求复用原结果，不重复增加余额。

还款请求：`{"expected_version":1,"installment_number":1}`。金额由服务端账单决定，客户端不能提交自定金额。返回 `{loan,wallet,simulated}`；全部本金清偿后 `loan.status=CLOSED`。

## 错误和版本冲突

错误统一为 `{"error":{"code":"VERSION_CONFLICT"},"trace_id":"...","simulated":true}`，响应头带 `X-Trace-ID`。成功请求也有追踪头。401 带 Bearer challenge。不要从错误中解析数据库异常文本。

| HTTP | 主要错误码 | 客户端动作 |
|---|---|---|
| 401 / 403 / 404 | UNAUTHENTICATED / FORBIDDEN / NOT_FOUND | 检查身份与角色，不推测其他学生资源 |
| 422 | INVALID_INPUT / FIRST_DUE_DATE_NOT_FUTURE / INSTALLMENT_TOO_SMALL | 修正输入；金额用十进制字符串 |
| 409 | VERSION_CONFLICT | 重新 GET，再以新版本和新幂等键发起操作 |
| 409 | IDEMPOTENCY_CONFLICT | 同一个键不能用于不同请求 |
| 409 | QUOTE_ALREADY_USED / QUOTE_EXPIRED | 重新测算、新建申请 |
| 409 | INVALID_STATE / LOAN_CLOSED | 刷新申请或贷款，不继续旧动作 |
| 409 | INSTALLMENT_NOT_PAYABLE / INSTALLMENT_NOT_DUE | 检查账单顺序与到期日 |
| 409 | INSUFFICIENT_BALANCE | 不会部分扣款；补充模拟资金后重试 |
| 409 | CONSTRAINT_CONFLICT | 刷新状态，检查重复操作 |
| 503 / 500 | DATABASE_UNAVAILABLE / INTERNAL_ERROR | 保留幂等键重试，并记录 trace_id |

自动提交在一个事务中完成，`SUBMITTED` 作为审计事件保留；GET 通常直接读到审批结果。审批依据保存在申请中，之后更新资料不会暗中改写旧决定；放款时再审核。正式 HTTP 服务使用真实曼谷时间，演示及测试通过 Python 工厂注入时钟。
