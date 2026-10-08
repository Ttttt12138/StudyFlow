# B/C 借贷契约联调

适配层 `studyflow_backend.c_adapter` 按需导入 C 0.2.0，核心业务、HTTP 启动和普通演示不要求安装 C。现有 C 的源码、v1/v2 schema 及状态枚举不修改。

| B 数据 | C 契约 | 规则 |
|---|---|---|
| 不可变报价与还款表 | `LoanQuote` | 本金、净到账、费用、利息、完整计划原值转换，不从解释文本解析金额 |
| 申请 | `ApplicationSnapshot` | 保留原状态；贷款结清后申请仍为 DISBURSED |
| 申请筹资来源 | `FundingSource` | `funding_id=borrowing:{application_id}`，`loan_quote_id` 引用报价 |
| 当前资料与其他贷款承诺 | `affordability/missing_inputs` | B 确定性计算；缺资料不得标 AFFORDABLE |
| 钱包聚合版本 | `state_version` | 在同一个数据库读快照中导出 |

`export_application(session, application_id, student_id, now)` 返回 `{quote, application, source, state_version}`；调用方必须从可信身份上下文提供 student_id，不能直接信任前端任意参数。

未放款时 `received=false`，预计到账日期未知，明确需要管理员模拟放款；拒绝或取消时可分配额度为零。放款后 `received=true`、`allocatable=0.00`，C 必须拒绝把这笔已进入余额的来源再次分配。不得把借款报价 ID 当成资金分配 ID。

`explain_demo(...)` 使用明确标记的合成预算：低/基准/高 `178200/190200/202200 THB`、缺口 `50000 THB`，`complete=false`。预算不由 B 计算，也不代表借款后实时资金缺口。本轮没有实现完整 `ReadinessBackendPort`、预算引擎、组合校验、任务租约或检查结果 outbox。

联调调用 `ReadinessAI.mock().generate_funding_candidates(context)`，核对 `loan_explanations[0].quote` 与 B 导出的报价完全相同。尚未完成 B 组合校验的候选保持 `PENDING`；收到资金后的重复分配候选应为 `INVALID`。这不构成完整 A/B/C readiness 验收，也不需要网络模型密钥。
